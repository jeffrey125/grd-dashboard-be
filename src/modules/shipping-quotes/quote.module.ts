import { RuntimeFeaturesModule } from '@config/runtime-features.module.js';
import { DataSource } from 'typeorm';
import { ProviderAdminController } from './provider-admin.controller.js';
import { ProviderAdminRepository } from './provider-admin.repository.js';
import { TypeOrmProviderAdminRepository } from './typeorm-provider-admin.repository.js';
import { SenderDefaultsService } from './sender-defaults.service.js';
import { senderDefaultsRepositoryProvider } from './typeorm-sender-defaults.repository.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { EventsModule } from '@modules/events/events.module.js';
import { AuthModule } from '@modules/auth/auth.module.js';
import { QuoteEventsController } from './quote-events.controller.js';
import { QuoteController } from './quote.controller.js';
import { QuoteService } from './quote.service.js';
import { quoteRepositoryProvider } from './typeorm-quote.repository.js';

@Module({
  imports: [RuntimeFeaturesModule, DatabaseModule, EventsModule, AuthModule],
  controllers: [
    ProviderAdminController,
    QuoteController,
    QuoteEventsController,
  ],
  providers: [
    {
      provide: ProviderAdminRepository,
      inject: [DataSource],
      useFactory: (source: DataSource) =>
        new TypeOrmProviderAdminRepository(source),
    },
    QuoteService,
    quoteRepositoryProvider,
    SenderDefaultsService,
    senderDefaultsRepositoryProvider,
  ],
})
export class QuoteModule {}
