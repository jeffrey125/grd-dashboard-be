import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';
import { Subject, type Subscription, timer } from 'rxjs';
import { EventsSource, changeSchema, type LiveEvent } from './events.source.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';

interface ListenerClient {
  query(sql: string): Promise<unknown>;
  on(name: string, listener: (...args: never[]) => void): void;
  removeAllListeners(name: string): void;
  release(destroy?: boolean): void;
}

/** One dedicated PostgreSQL connection per API, shared by all SSE clients. */
@Injectable()
export class TypeOrmEventsSource
  extends EventsSource
  implements OnModuleDestroy
{
  readonly events = new Subject<LiveEvent>();
  private client?: ListenerClient;
  private connecting?: Promise<void>;
  private retry?: Subscription;
  private stopped = false;

  constructor(
    @Inject(DataSource) private readonly source: DataSource,
    @Inject(ProjectLogger) private readonly logger: ProjectLogger,
  ) {
    super();
  }

  start() {
    if (this.stopped || this.client || this.connecting || this.retry) return;

    this.connecting = this.connect().finally(() => {
      this.connecting = undefined;
    });
  }

  private async connect() {
    let client: ListenerClient | undefined;

    try {
      client = await (this.source.driver as PostgresDriver).master.connect();

      if (!client) throw new Error('Listener unavailable');

      if (this.stopped) {
        client.release(true);

        return;
      }

      this.client = client;
      client.on('error', () => {
        if (this.client === client) this.disconnected();
      });
      client.on('end', () => {
        if (this.client === client) this.disconnected();
      });
      client.on(
        'notification',
        (message: { channel: string; payload?: string }) => {
          if (message.channel !== 'grd_changes') return;

          try {
            const parsed = changeSchema.safeParse(
              JSON.parse(message.payload ?? ''),
            );

            if (parsed.success) this.events.next(parsed.data);
          } catch {
            /* Ignore invalid signals; HTTP remains authoritative. */
          }
        },
      );
      await client.query("SET application_name = 'grd-events'");
      await client.query('LISTEN grd_changes');

      if (!this.stopped && this.client === client)
        this.events.next({ type: 'resync' });
    } catch {
      this.disconnected();
    }
  }

  private disconnected() {
    const client = this.client;

    this.client = undefined;

    if (client) {
      client.removeAllListeners('notification');
      client.removeAllListeners('end');
      // Retain the error handler until the destroyed socket has finished closing.
      client.release(true);
    }

    if (this.stopped || this.retry) return;

    this.logger.warn(
      'events.listener.disconnected',
      'Live event listener unavailable; clients must resync',
    );
    this.events.next({ type: 'resync' });
    this.retry = timer(1000).subscribe(() => {
      this.retry = undefined;
      this.start();
    });
  }

  async onModuleDestroy() {
    this.stopped = true;
    this.retry?.unsubscribe();
    this.retry = undefined;
    this.events.complete();
    this.disconnected();
    await this.connecting;
  }
}
