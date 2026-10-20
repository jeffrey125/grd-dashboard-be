import { describe, expect, it, vi } from 'vitest';
import { ProviderReadinessWorker } from './provider-readiness.worker.js';
import type {
  ProviderAdminRepository,
  ReadinessWork,
} from './provider-admin.repository.js';

const work: ReadinessWork = { id: 'test', code: 'amazon', mode: 'browser' };

describe('Provider readiness worker', () => {
  it('runs the proposed mode and persists only an allowlisted failure', async () => {
    const finish = vi.fn();
    const repository = {
      claim: async () => work,
      finish,
    } as unknown as ProviderAdminRepository;
    const adapter = {
      readiness: vi
        .fn()
        .mockRejectedValue(new Error('cookie=secret; token=secret')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    await new ProviderReadinessWorker(repository, () => adapter).runOnce();
    expect(adapter.readiness).toHaveBeenCalledWith('browser');
    expect(adapter.close).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(work, 'readiness_failed');
    expect(JSON.stringify(finish.mock.calls)).not.toContain('secret');
  });

  it('closes timed-out readiness sessions before finishing', async () => {
    vi.useFakeTimers();
    const finish = vi.fn();
    const repository = {
      claim: async () => work,
      finish,
    } as unknown as ProviderAdminRepository;
    const adapter = {
      readiness: () => new Promise<void>(() => {}),
      close: vi.fn().mockResolvedValue(undefined),
    };
    try {
      const worker = new ProviderReadinessWorker(repository, () => adapter);
      const run = worker.runOnce();
      await vi.advanceTimersByTimeAsync(75000);
      await run;
      expect(adapter.close).toHaveBeenCalledOnce();
      expect(finish).toHaveBeenCalledWith(work, 'readiness_timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});
