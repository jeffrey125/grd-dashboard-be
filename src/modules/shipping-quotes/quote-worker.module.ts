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
import { UnishippersShippingAdapter } from './unishippers-quote.adapter.js';

@Module({
  imports: [DatabaseModule, RuntimeConfigModule],
  providers: [
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
        const amazon = new AmazonShippingAdapter();
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
