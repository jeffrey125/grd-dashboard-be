import { RuntimeFeatures } from '@config/runtime-features.module.js';
import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { BrowserSenderDefaults } from './browser-sender-defaults.js';
import {
  SENDER_DEFAULTS_REPOSITORY,
  type SenderDefaultsRepository,
} from './sender-defaults.repository.js';

@Injectable()
export class SenderDefaultsWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(
    @Inject(SENDER_DEFAULTS_REPOSITORY)
    private readonly repository: SenderDefaultsRepository,
    @Inject(BrowserSenderDefaults)
    private readonly gateway: Pick<BrowserSenderDefaults, 'read'>,
    @Inject(RuntimeFeatures)
    private readonly features: Pick<RuntimeFeatures, 'quoteComparisonEnabled'>,
  ) {}
  onModuleInit() {
    if (!this.features.quoteComparisonEnabled) return;
    this.schedule();
  }
  private schedule() {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch(() => undefined)
        .finally(() => {
          if (!this.stopped) this.schedule();
        });
    }, 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  async runOnce() {
    if (!this.features.quoteComparisonEnabled) return;
    const work = await this.repository.claim();
    if (!work) return;
    let address = null;
    try {
      address = await this.gateway.read(work.code);
    } catch {
      /* No raw provider diagnostics are persisted. */
    }
    await this.repository.finish(work, address);
  }
}
