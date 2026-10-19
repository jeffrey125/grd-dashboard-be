import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Bottleneck from 'bottleneck';
import {
  SENDER_DEFAULTS_REPOSITORY,
  type SenderDefaultsRepository,
} from './sender-defaults.repository.js';
import {
  type Address,
  type ProviderCode,
  providerCode,
} from './quote.schemas.js';

@Injectable()
export class SenderDefaultsService {
  private readonly queues = {
    amazon: new Bottleneck({
      maxConcurrent: 1,
      highWater: 5,
      strategy: Bottleneck.strategy.OVERFLOW,
    }),
    unishippers: new Bottleneck({
      maxConcurrent: 1,
      highWater: 5,
      strategy: Bottleneck.strategy.OVERFLOW,
    }),
  };
  private readonly inFlight = new Map<
    ProviderCode,
    Promise<{ address: Address; retrievedAt: string }>
  >();

  private readonly snapshots = new Map<
    string,
    {
      actorId: number;
      code: ProviderCode;
      address: Address;
      retrievedAt: string;
    }
  >();
  constructor(
    @Inject(SENDER_DEFAULTS_REPOSITORY)
    private readonly repository: SenderDefaultsRepository,
  ) {}
  async refresh(raw: string, actorId: number) {
    const parsed = providerCode.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Unknown provider');
    const code = parsed.data;
    try {
      let pending = this.inFlight.get(code);
      if (!pending) {
        pending = this.queues[code].schedule(async () => {
          const workId = await this.repository.enqueue(code);
          const deadline = Date.now() + 90000;
          while (Date.now() < deadline) {
            const result = await this.repository.result(code, workId);
            if (!result || result.state === 'failed')
              throw new Error('sender_refresh_failed');
            if (
              result.state === 'succeeded' &&
              result.address &&
              result.retrievedAt
            )
              return {
                address: result.address,
                retrievedAt: result.retrievedAt,
              };
            await delay(500);
          }
          throw new Error('sender_refresh_timeout');
        });
        this.inFlight.set(code, pending);
        void pending
          .finally(() => this.inFlight.delete(code))
          .catch(() => undefined);
      }
      const result = await pending;
      const refreshId = randomUUID();
      if (this.snapshots.size >= 2000) {
        const oldest = this.snapshots.keys().next().value;
        if (oldest) this.snapshots.delete(oldest);
      }
      this.snapshots.set(refreshId, { actorId, code, ...result });
      return { refreshId, ...result };
    } catch {
      throw new ServiceUnavailableException(
        'Sender refresh unavailable; enter an explicit sender',
      );
    }
  }

  resolve(id: string, code: ProviderCode, actorId: number) {
    const snapshot = this.snapshots.get(id);
    if (!snapshot || snapshot.code !== code || snapshot.actorId !== actorId)
      throw new BadRequestException(
        'Refresh sender defaults again or enter an explicit sender',
      );
    return {
      code,
      address: snapshot.address,
      retrievedAt: snapshot.retrievedAt,
      mode: 'account_default' as const,
    };
  }
}
