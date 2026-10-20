import { describe, expect, it, vi } from 'vitest';
import { SenderDefaultsService } from './sender-defaults.service.js';
import type { SenderDefaultsRepository } from './sender-defaults.repository.js';

const address = {
  name: 'Warehouse',
  street: '1 Example St',
  city: 'Walworth',
  division: 'WI',
  postalCode: '53125',
  country: 'US',
};

describe('Sender default freshness', () => {
  it('accepts a current refresh and rejects it at fifteen minutes', async () => {
    const start = Date.parse('2026-10-20T10:00:00Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    const repository = {
      enqueue: async () => 'work',
      result: async () => ({
        state: 'succeeded',
        address,
        retrievedAt: new Date(start).toISOString(),
      }),
    } as unknown as SenderDefaultsRepository;
    const service = new SenderDefaultsService(repository);
    try {
      const refreshed = await service.refresh('amazon', 1);
      expect(service.resolve(refreshed.refreshId, 'amazon', 1).address).toEqual(
        address,
      );
      now.mockReturnValue(start + 15 * 60 * 1000);
      expect(() => service.resolve(refreshed.refreshId, 'amazon', 1)).toThrow(
        'Refresh sender defaults again',
      );
    } finally {
      now.mockRestore();
    }
  });
});
