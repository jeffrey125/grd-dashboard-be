import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { BrowserSenderDefaults } from './browser-sender-defaults.js';
import { SenderDefaultsWorker } from './sender-defaults.worker.js';
import { senderDefaultsRepositoryProvider } from './typeorm-sender-defaults.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    senderDefaultsRepositoryProvider,
    BrowserSenderDefaults,
    SenderDefaultsWorker,
  ],
})
export class SenderDefaultsWorkerModule {}
