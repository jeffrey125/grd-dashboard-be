import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbstractCacheService } from './abstract-cache.service.js';
import { ApplicationCacheModule } from './application-cache.module.js';

class TestCacheService<TValue> extends AbstractCacheService<TValue> {
  constructor(
    cache: Cache,
    protected readonly namespace = 'test:item',
    protected readonly defaultTtlMs = 60_000,
  ) {
    super(cache);
  }
}

describe('AbstractCacheService', () => {
  let module: TestingModule;
  let cache: Cache;
  let service: TestCacheService<{ value: string }>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ApplicationCacheModule],
    }).compile();
    cache = module.get<Cache>(CACHE_MANAGER);
    service = new TestCacheService(cache);
  });

  afterEach(async () => {
    await module.close();
    vi.useRealTimers();
  });

  it('expires entries using feature-default and overridden millisecond TTLs', async () => {
    vi.useFakeTimers();

    const shortLived = new TestCacheService(cache, 'test:short', 100);

    await shortLived.set('default', { value: 'default' });
    await shortLived.set('override', { value: 'override' }, 1);
    await expect(shortLived.get('override')).resolves.toEqual({
      value: 'override',
    });

    vi.advanceTimersByTime(2);
    await expect(shortLived.get('override')).resolves.toBeUndefined();
    await expect(shortLived.get('default')).resolves.toEqual({
      value: 'default',
    });
    vi.advanceTimersByTime(99);
    await expect(shortLived.get('default')).resolves.toBeUndefined();
  });

  it.each([false, 0, '', null])(
    'preserves falsy values and normalizes null to a miss (%j)',
    async (value) => {
      const values = new TestCacheService<typeof value>(cache);

      await values.set('value', value);

      if (value === null) {
        await expect(values.get('value')).resolves.toBeUndefined();
      } else {
        await expect(values.get('value')).resolves.toBe(value);
      }
    },
  );

  it('retains object references like the selected default in-memory store', async () => {
    const value = { value: 'original' };

    await service.set('123', value);
    value.value = 'mutated';

    const retrieved = await service.get('123');

    expect(retrieved).toBe(value);
    expect(retrieved).toEqual({ value: 'mutated' });

    retrieved!.value = 'mutated again';
    await expect(service.get('123')).resolves.toEqual({
      value: 'mutated again',
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid explicit and feature-default TTL %s without overwriting a value',
    async (ttl) => {
      await service.set('123', { value: 'original' });

      const invalidDefault = new TestCacheService(cache, 'test:item', ttl);

      await expect(
        service.set('123', { value: 'invalid' }, ttl),
      ).rejects.toThrow(
        'Cache TTL must be a positive integer in milliseconds.',
      );
      await expect(
        invalidDefault.set('123', { value: 'invalid' }),
      ).rejects.toThrow(RangeError);
      await expect(service.get('123')).resolves.toEqual({ value: 'original' });
    },
  );

  it('stores, reads, and invalidates only the requested entry', async () => {
    await expect(service.get('123')).resolves.toBeUndefined();
    await service.set('123', { value: 'cached' });
    await service.set('456', { value: 'other' });
    await expect(service.get('123')).resolves.toEqual({ value: 'cached' });

    await service.invalidate('123');
    await service.invalidate('missing');
    await expect(service.get('123')).resolves.toBeUndefined();
    await expect(service.get('456')).resolves.toEqual({ value: 'other' });

    expect('clear' in service).toBe(false);
  });

  it('trims keys and encodes identifiers without colliding with other namespaces', async () => {
    const other = new TestCacheService<{ value: string }>(cache, 'test:item:a');
    const padded = new TestCacheService<{ value: string }>(
      cache,
      ' test:item ',
    );

    await service.set('a:b', { value: 'colon' });
    await service.set('a%3Ab', { value: 'literal escape' });
    await service.set('貨物 /?#', { value: 'unicode' });
    await other.set('b', { value: 'other namespace' });

    await expect(padded.get(' a:b ')).resolves.toEqual({ value: 'colon' });
    await expect(service.get('a%3Ab')).resolves.toEqual({
      value: 'literal escape',
    });
    await expect(service.get('貨物 /?#')).resolves.toEqual({
      value: 'unicode',
    });
    await service.invalidate('a:b');
    await expect(other.get('b')).resolves.toEqual({ value: 'other namespace' });
  });

  it.each(['', ' \t\n '])(
    'rejects blank identifiers and namespaces (%j) for every operation',
    async (blank) => {
      const invalidNamespace = new TestCacheService(cache, blank);

      for (const operation of [
        () => service.get(blank),
        () => service.set(blank, { value: 'invalid' }),
        () => service.invalidate(blank),
      ]) {
        await expect(operation()).rejects.toThrow(
          'Cache identifier must not be empty.',
        );
      }

      for (const operation of [
        () => invalidNamespace.get('123'),
        () => invalidNamespace.set('123', { value: 'invalid' }),
        () => invalidNamespace.invalidate('123'),
      ]) {
        await expect(operation()).rejects.toThrow(
          'Cache namespace must not be empty.',
        );
      }
    },
  );
});
