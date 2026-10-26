import { RuntimeFeatures } from '@config/runtime-features.module.js';
import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ProviderAdminRepository,
  type ReadinessWork,
  type ReadinessFailure,
} from './provider-admin.repository.js';

export interface ReadinessAdapter {
  readiness(mode: ReadinessWork['mode']): Promise<void>;
  close(): Promise<void>;
}
export const READINESS_ADAPTERS = Symbol('READINESS_ADAPTERS');
export type ReadinessAdapters = (
  code: ReadinessWork['code'],
) => ReadinessAdapter;

@Injectable()
export class ProviderReadinessWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private pending?: Promise<void>;
  private adapter?: ReadinessAdapter;

  constructor(
    @Inject(ProviderAdminRepository)
    private readonly repository: ProviderAdminRepository,
    @Inject(READINESS_ADAPTERS) private readonly adapters: ReadinessAdapters,
    @Inject(RuntimeFeatures)
    private readonly features: Pick<RuntimeFeatures, 'quoteComparisonEnabled'>,
  ) {}

  onModuleInit() {
    if (!this.features.quoteComparisonEnabled) return;
    this.schedule();
  }

  private schedule() {
    this.timer = setTimeout(() => {
      this.pending = this.runOnce()
        .catch(() => undefined)
        .finally(() => {
          if (!this.stopped) this.schedule();
        });
    }, 1000);
    this.timer.unref();
  }

  async runOnce() {
    if (!this.features.quoteComparisonEnabled) return;
    const work = await this.repository.claim();
    if (!work) return;
    const adapter = this.adapters(work.code);
    this.adapter = adapter;
    let failure: ReadinessFailure | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        adapter.readiness(work.mode),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            failure = 'readiness_timeout';
            reject(new Error('readiness_timeout'));
          }, 75000);
        }),
      ]);
    } catch {
      failure ??= 'readiness_failed';
    } finally {
      clearTimeout(timer);
      await adapter.close().catch(() => undefined);
      this.adapter = undefined;
    }
    if (!this.stopped) await this.repository.finish(work, failure);
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.adapter?.close();
    await this.pending;
  }
}
