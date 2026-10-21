import { AmazonAccountAccess } from './amazon-account-access.js';
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
    @Inject(AmazonAccountAccess)
    private readonly access: AmazonAccountAccess = new AmazonAccountAccess(),
  ) {}
  onModuleInit() {
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
    const work = await this.repository.claim();
    if (!work) return;
    let address = null;
    let release: (() => void) | undefined;
    try {
      if (work.code === 'amazon') release = this.access.acquire();
      address = await this.gateway.read(work.code);
    } catch {
      /* No raw provider diagnostics are persisted. */
    } finally {
      release?.();
    }
    await this.repository.finish(work, address);
  }
}
