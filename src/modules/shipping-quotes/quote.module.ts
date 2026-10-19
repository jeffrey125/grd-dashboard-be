import { SenderDefaultsService } from './sender-defaults.service.js';
import { senderDefaultsRepositoryProvider } from './typeorm-sender-defaults.repository.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { QuoteController } from './quote.controller.js';
import { QuoteService } from './quote.service.js';
import { quoteRepositoryProvider } from './typeorm-quote.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [QuoteController],
  providers: [
    QuoteService,
    quoteRepositoryProvider,
    SenderDefaultsService,
    senderDefaultsRepositoryProvider,
  ],
})
export class QuoteModule {}
