import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeConfiguration } from '@config/configuration.js';
import { databaseTls } from './database-tls.js';

// A database-local, two-int advisory lock. Never reuse the auth/quote lock keys.
export const WORKER_LOCK_NAMESPACE = 1793318400;
export const WORKER_LOCK_ID = 1;

/** Dedicated session: never return an owned lock to a connection pool. */
export class WorkerOwnership {
  private readonly client: pg.Client;
  private state: 'waiting' | 'held' | 'lost' | 'closed' = 'waiting';
  private heartbeat?: ReturnType<typeof setTimeout>;

  constructor(
    database: RuntimeConfiguration['database'],
    private readonly onLost: () => void,
  ) {
    this.client = new pg.Client({
      host: database.host,
      port: database.port,
      database: database.database,
      user: database.username,
      password: database.password,
      ssl: databaseTls(database.sslMode, database.sslCaFile),
      application_name: 'grd-worker-ownership',
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 1000,
    });
    this.client.on('error', () => this.lost());
    this.client.on('end', () => this.lost());
  }

  async acquire(signal: AbortSignal, onWaiting: () => void): Promise<void> {
    signal.throwIfAborted();
    await this.client.connect();
    let reportedWaiting = false;

    while (this.state === 'waiting') {
      signal.throwIfAborted();
      const result = await this.client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [WORKER_LOCK_NAMESPACE, WORKER_LOCK_ID],
      );
      signal.throwIfAborted();
      if (this.state !== 'waiting')
        throw new Error('Worker ownership connection unavailable');

      if (result.rows[0].acquired) {
        this.state = 'held';
        this.monitor();

        return;
      }

      if (!reportedWaiting) {
        onWaiting();
        reportedWaiting = true;
      }

      await delay(1000, undefined, { signal });
    }

    throw new Error('Worker ownership connection unavailable');
  }

  // The process entrypoint retains ownership until process exit, including all
  // shutdown hooks. Explicit close is only safe when no worker work can remain.
  async close(): Promise<void> {
    this.state = 'closed';
    clearTimeout(this.heartbeat);
    await this.client.end();
  }

  private monitor() {
    this.heartbeat = setTimeout(() => {
      void this.client
        .query<{ held: boolean }>(
          `SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND pid = pg_backend_pid()
              AND classid = $1::oid AND objid = $2::oid AND objsubid = 2
              AND granted
          ) AS held`,
          [WORKER_LOCK_NAMESPACE, WORKER_LOCK_ID],
        )
        .then((result) => {
          if (!result.rows[0].held) this.lost();
          if (this.state === 'held') this.monitor();
        })
        .catch(() => this.lost());
    }, 2000);
    this.heartbeat.unref();
  }

  private lost() {
    if (this.state === 'lost' || this.state === 'closed') return;
    const owned = this.state === 'held';
    this.state = 'lost';
    clearTimeout(this.heartbeat);
    if (owned) this.onLost();
  }
}
