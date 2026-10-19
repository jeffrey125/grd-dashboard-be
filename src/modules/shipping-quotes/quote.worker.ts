import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { QuoteExecutionRepository } from './quote-execution.repository.js';
import { executeQuote, type QuoteAdapter } from './quote-executor.js';
import type { ProviderCode } from './quote.schemas.js';

export const QUOTE_ADAPTERS = Symbol('QUOTE_ADAPTERS');

export type QuoteAdapters = (code: ProviderCode) => QuoteAdapter | undefined;

@Injectable()
export class QuoteWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private readonly shutdown = new AbortController();
  private readonly active = new Set<Promise<void>>();
  private scanning?: Promise<void>;

  constructor(
    @Inject(QuoteExecutionRepository)
    private readonly jobs: QuoteExecutionRepository,
    @Inject(QUOTE_ADAPTERS) private readonly adapters: QuoteAdapters,
    @Inject(ProjectLogger) private readonly logger: ProjectLogger,
  ) {}

  onModuleInit() {
    this.schedule();
  }

  private schedule() {
    this.timer = setTimeout(() => {
      this.scanning = this.runOnce()
        .catch(() => {
          this.logger.error(
            'quotes.worker.failed',
            'Quote worker scan failed; durable leases remain recoverable',
          );
        })
        .finally(() => {
          if (!this.shutdown.signal.aborted) this.schedule();
        });
    }, 1000);
    this.timer.unref();
  }

  async runOnce() {
    while (!this.shutdown.signal.aborted && this.active.size < 2) {
      const job = await this.jobs.claim(120000);

      if (!job) return;

      const task = executeQuote(
        job,
        this.adapters(job.code),
        this.shutdown.signal,
        90000,
        () => this.jobs.reserveRelogin(job),
      )
        .then(async (result) => {
          if (!this.shutdown.signal.aborted)
            await this.jobs.finish(job, result);
        })
        .catch(() => {
          this.logger.error(
            'quotes.execution.failed',
            'Quote persistence failed; lease recovery will resume work',
          );
        })
        .finally(() => {
          this.active.delete(task);
        });
      this.active.add(task);
    }
  }

  async onModuleDestroy() {
    this.shutdown.abort();
    clearTimeout(this.timer);
    await this.scanning;
    await Promise.all(this.active);
  }
}
