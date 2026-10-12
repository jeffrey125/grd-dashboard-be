import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationCacheModule } from './application-cache.module.js';

@Injectable()
class CacheConsumer {
  constructor(@Inject(CACHE_MANAGER) readonly cache: Cache) {}
}

@Module({ providers: [CacheConsumer], exports: [CacheConsumer] })
class ConsumerModule {}

describe('ApplicationCacheModule', () => {
  afterEach(() => vi.useRealTimers());

  it('expires entries after the configured 60-second default', async () => {
    vi.useFakeTimers();
    const module = await Test.createTestingModule({
      imports: [ApplicationCacheModule],
    }).compile();
    try {
      const cache = module.get<Cache>(CACHE_MANAGER);
      await cache.set('default-ttl', 'cached');
      vi.advanceTimersByTime(59_999);
      await expect(cache.get('default-ttl')).resolves.toBe('cached');
      vi.advanceTimersByTime(2);
      await expect(cache.get('default-ttl')).resolves.toBeUndefined();
    } finally {
      await module.close();
    }
  });

  it('provides a global in-memory cache to another module', async () => {
    const module = await Test.createTestingModule({
      imports: [ApplicationCacheModule, ConsumerModule],
    }).compile();
    try {
      const { cache } = module.get(CacheConsumer);
      await cache.set('test:item', { value: 'cached' });
      await expect(cache.get('test:item')).resolves.toEqual({
        value: 'cached',
      });
      await expect(cache.get('missing')).resolves.toBeUndefined();
    } finally {
      await module.close();
    }
  });
});
