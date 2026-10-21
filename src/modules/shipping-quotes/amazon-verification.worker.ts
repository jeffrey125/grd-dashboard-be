import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { AmazonAccountAccess } from './amazon-account-access.js';
import { AmazonVerificationBridge } from './amazon-verification.bridge.js';
import { AmazonVerificationBrowser } from './amazon-verification.browser.js';
import { AmazonVerificationManager } from './amazon-verification.manager.js';
import { amazonSessionStore } from './amazon-session.store.js';
import { VerificationError } from './amazon-verification.contract.js';

@Injectable()
export class AmazonVerificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly bridge = new AmazonVerificationBridge();
  private manager?: AmazonVerificationManager;

  constructor(
    @Inject(AmazonAccountAccess) private readonly access: AmazonAccountAccess,
    @Inject(ProjectLogger) private readonly logger: ProjectLogger,
  ) {}

  async onModuleInit() {
    if (!process.env.AMAZON_VERIFICATION_SOCKET) return;
    const store = amazonSessionStore();
    if (!store || process.env.QUOTE_DEMO_MODE === 'true')
      throw new VerificationError('unavailable');
    this.manager = new AmazonVerificationManager(
      this.access,
      () => new AmazonVerificationBrowser(store),
      this.logger,
    );
    try {
      await this.bridge.listen((command) => this.manager!.command(command));
    } catch (error) {
      await this.manager.close();
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.bridge.close();
    await this.manager?.close();
  }
}
