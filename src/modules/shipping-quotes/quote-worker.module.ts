import {
  ProviderReadinessWorker,
  READINESS_ADAPTERS,
} from './provider-readiness.worker.js';
import { ProviderAdminRepository } from './provider-admin.repository.js';
import { TypeOrmProviderAdminRepository } from './typeorm-provider-admin.repository.js';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { RuntimeConfigModule } from '@config/config.module.js';
import type { RuntimeConfiguration } from '@config/configuration.js';
import { QuoteExecutionRepository } from './quote-execution.repository.js';
import { TypeOrmQuoteExecutionRepository } from './typeorm-quote-execution.repository.js';
import {
  QUOTE_ADAPTERS,
  QuoteWorker,
  type QuoteAdapters,
} from './quote.worker.js';
import { FixtureQuoteAdapter } from './fixture-quote.adapter.js';
import { AmazonShippingAdapter } from './amazon-quote.adapter.js';
import { amazonSessionStore } from './amazon-session.store.js';
import { UnishippersShippingAdapter } from './unishippers-quote.adapter.js';

@Module({
  imports: [DatabaseModule, RuntimeConfigModule],
  providers: [
    {
      provide: ProviderAdminRepository,
      inject: [DataSource],
      useFactory: (source: DataSource) =>
        new TypeOrmProviderAdminRepository(source),
    },
    {
      provide: READINESS_ADAPTERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const runtime = config.getOrThrow<RuntimeConfiguration>('runtime');
        return (code: string) =>
          runtime.quoteDemo
            ? {
                readiness: async () => {
                  throw new Error('Live readiness unavailable in demo mode');
                },
                close: async () => {},
              }
            : code === 'amazon'
              ? new AmazonShippingAdapter({
                  sessionStore: amazonSessionStore(),
                })
              : new UnishippersShippingAdapter();
      },
    },
    ProviderReadinessWorker,
    {
      provide: QuoteExecutionRepository,
      inject: [DataSource],
      useFactory: (source: DataSource) =>
        new TypeOrmQuoteExecutionRepository(source),
    },
    {
      provide: QUOTE_ADAPTERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): QuoteAdapters => {
        const runtime = config.getOrThrow<RuntimeConfiguration>('runtime');
        const amazon = new AmazonShippingAdapter({
          sessionStore: amazonSessionStore(),
        });
        const unishippers = new UnishippersShippingAdapter();
        return (code) =>
          runtime.quoteDemo
            ? new FixtureQuoteAdapter(runtime.quoteScenarios[code])
            : code === 'amazon'
              ? amazon
              : code === 'unishippers'
                ? unishippers
                : undefined;
      },
    },
    QuoteWorker,
  ],
})
export class QuoteWorkerModule {}
