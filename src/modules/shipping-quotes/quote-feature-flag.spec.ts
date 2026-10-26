import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { QuoteWorker } from './quote.worker.js';
import type { QuoteExecutionRepository } from './quote-execution.repository.js';
import type { ProviderAdminRepository } from './provider-admin.repository.js';
import { ProviderReadinessWorker } from './provider-readiness.worker.js';
import { SenderDefaultsWorker } from './sender-defaults.worker.js';
import type { SenderDefaultsRepository } from './sender-defaults.repository.js';

afterEach(() => vi.useRealTimers());

describe('quote background feature flag', () => {
  it.each([false, true])(
    'only claims work when enabled=%s',
    async (quoteComparisonEnabled) => {
      vi.useFakeTimers();
      const features = { quoteComparisonEnabled };
      const quoteClaim = vi.fn(async () => null);
      const readinessClaim = vi.fn(async () => null);
      const defaultsClaim = vi.fn(async () => null);
      const adapters = vi.fn();
      const read = vi.fn();
      const workers = [
        new QuoteWorker(
          { claim: quoteClaim } as unknown as QuoteExecutionRepository,
          adapters,
          {} as ProjectLogger,
          features,
        ),
        new ProviderReadinessWorker(
          { claim: readinessClaim } as unknown as ProviderAdminRepository,
          adapters,
          features,
        ),
        new SenderDefaultsWorker(
          { claim: defaultsClaim } as unknown as SenderDefaultsRepository,
          { read },
          features,
        ),
      ];

      try {
        for (const worker of workers) worker.onModuleInit();
        await vi.advanceTimersByTimeAsync(1100);
        for (const claim of [quoteClaim, readinessClaim, defaultsClaim])
          expect(claim).toHaveBeenCalledTimes(quoteComparisonEnabled ? 1 : 0);

        for (const worker of workers) await worker.runOnce();
        for (const claim of [quoteClaim, readinessClaim, defaultsClaim])
          expect(claim).toHaveBeenCalledTimes(quoteComparisonEnabled ? 2 : 0);
        expect(adapters).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
      } finally {
        const closing = Promise.all(
          workers.map((worker) => worker.onModuleDestroy()),
        );
        await vi.runAllTimersAsync();
        await closing;
      }
    },
  );
});
