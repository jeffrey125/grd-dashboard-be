# NestJS in-memory cache design

## Status

Approved v1 design for `grd-dashboard-be`. This document contains implementation examples; the packages are installed by the cache-infrastructure ticket rather than by the documentation task.

Use `@nestjs/cache-manager` with `cache-manager` and its default in-memory store. Do not configure Redis or another external store in v1.

Implemented in V1-006 with `@nestjs/cache-manager@12.0.1`,
`cache-manager@7.2.9`, and their resolved `keyv@5.6.0` dependency. See the
[implementation summary](implementation-summary/V1-006-implementation-summary.md).

The selected cache-manager default store disables Keyv serialization and retains
object references; it does not clone values. Treat cached objects as immutable.
The JSON-serializable-only rule below remains a feature contract, not runtime
serialization or validation. The underlying manager returns `undefined` for a
miss; the approved abstract service also normalizes a stored `null` to
`undefined`, while preserving `false`, `0`, and empty strings. Features needing
negative-result caching must define that behavior in their own ticket.

## Responsibilities

- `ApplicationCacheModule` configures one cache instance per Nest application context.
- `AbstractCacheService<TValue>` provides safe, namespaced cache operations for feature cache services.
- Each feature owns its cache namespace, TTL, cached value shape, invalidation points, and refresh behavior.
- Do not enable the HTTP `CacheInterceptor`; application services use cache operations explicitly.

The API and worker run in separate processes, so their caches are independent even though both import the same module:

```text
AppModule    -> API process memory
WorkerModule -> Worker process memory
```

## Folder structure

```text
src/
├── infrastructure/
│   └── cache/
│       ├── abstract-cache.service.ts
│       ├── abstract-cache.service.spec.ts
│       ├── application-cache.module.ts
│       ├── application-cache.module.spec.ts
│       └── cache.config.ts
└── modules/
    ├── carriers/
    │   ├── cache/
    │   │   └── carrier-cache.service.ts
    │   └── adapters/
    │       └── ups/
    │           └── ups-token.provider.ts
    ├── shipments/
    │   └── cache/
    │       └── shipment-cache.service.ts
    └── tracking/
        └── cache/
            └── tracking-cache.service.ts
```

Create a feature cache service only when that feature has a concrete cache use case. Do not create empty cache folders during scaffolding.

## Infrastructure files

### `cache.config.ts`

```ts
import type { CacheModuleOptions } from '@nestjs/cache-manager';

export const APPLICATION_CACHE_DEFAULT_TTL_MS = 60_000;

export const applicationCacheOptions = {
  ttl: APPLICATION_CACHE_DEFAULT_TTL_MS,
} satisfies CacheModuleOptions;
```

TTL values are milliseconds. Features should override the default per entry when the source data has a different lifetime.

### `application-cache.module.ts`

```ts
import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';

import { applicationCacheOptions } from './cache.config';

@Global()
@Module({
  imports: [CacheModule.register(applicationCacheOptions)],
  exports: [CacheModule],
})
export class ApplicationCacheModule {}
```

Import `ApplicationCacheModule` once in `AppModule` and once in `WorkerModule`. `@Global()` applies only inside the current Nest application context; it does not share memory between the API and worker processes.

### `application-cache.module.spec.ts`

```ts
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Cache } from 'cache-manager';

import { ApplicationCacheModule } from './application-cache.module';

describe('ApplicationCacheModule', () => {
  let testingModule: TestingModule;
  let cache: Cache;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [ApplicationCacheModule],
    }).compile();

    cache = testingModule.get<Cache>(CACHE_MANAGER);
  });

  afterEach(async () => {
    await cache.clear();
    await testingModule.close();
  });

  it('provides an in-memory cache', async () => {
    await cache.set('test:key', { value: 'cached' }, 60_000);

    await expect(cache.get('test:key')).resolves.toEqual({
      value: 'cached',
    });
  });
});
```

### `abstract-cache.service.ts`

```ts
import type { Cache } from 'cache-manager';

export abstract class AbstractCacheService<TValue> {
  protected abstract readonly namespace: string;
  protected abstract readonly defaultTtlMs: number;

  protected constructor(private readonly cache: Cache) {}

  async get(identifier: string): Promise<TValue | undefined> {
    const value = await this.cache.get<TValue>(this.createKey(identifier));
    return value ?? undefined;
  }

  async set(
    identifier: string,
    value: TValue,
    ttlMs: number = this.defaultTtlMs,
  ): Promise<void> {
    this.assertValidTtl(ttlMs);
    await this.cache.set(this.createKey(identifier), value, ttlMs);
  }

  async invalidate(identifier: string): Promise<void> {
    await this.cache.del(this.createKey(identifier));
  }

  protected createKey(identifier: string): string {
    const namespace = this.namespace.trim();
    const normalizedIdentifier = identifier.trim();

    if (!namespace) {
      throw new Error('Cache namespace must not be empty.');
    }

    if (!normalizedIdentifier) {
      throw new Error('Cache identifier must not be empty.');
    }

    return `${namespace}:${encodeURIComponent(normalizedIdentifier)}`;
  }

  private assertValidTtl(ttlMs: number): void {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new RangeError(
        'Cache TTL must be a positive integer in milliseconds.',
      );
    }
  }
}
```

The base class deliberately does not expose `clear()`. A feature must not clear entries owned by other features. It also rejects TTL `0`, avoiding accidental never-expiring entries in the process-local cache.

The abstract class does not implement source loading or concurrent-refresh suppression. Those rules are feature-specific: for example, `UpsTokenProvider` owns OAuth expiry, its safety margin, and its in-flight refresh promise.

## Example feature service

### `shipment-cache.service.ts`

```ts
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

import { AbstractCacheService } from '../../../infrastructure/cache/abstract-cache.service';

export interface CachedShipment {
  externalId: string;
  trackingReference: string;
  monitoringStatus: 'active' | 'paused' | 'completed';
}

@Injectable()
export class ShipmentCacheService extends AbstractCacheService<CachedShipment> {
  protected readonly namespace = 'shipments:shipment';
  protected readonly defaultTtlMs = 60_000;

  constructor(@Inject(CACHE_MANAGER) cache: Cache) {
    super(cache);
  }
}
```

Usage:

```ts
const cached = await shipmentCache.get(externalId);
await shipmentCache.set(externalId, shipment);
await shipmentCache.invalidate(externalId);
```

Use the cache-aside pattern: read the cache, load from the repository on a miss, then cache the result. After a successful database mutation, invalidate the relevant entry. PostgreSQL remains authoritative.

## Example abstract-class test

### `abstract-cache.service.spec.ts`

```ts
import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Cache } from 'cache-manager';

import { AbstractCacheService } from './abstract-cache.service';

interface TestValue {
  value: string;
}

@Injectable()
class TestCacheService extends AbstractCacheService<TestValue> {
  protected readonly namespace = 'test:item';
  protected readonly defaultTtlMs = 60_000;

  constructor(@Inject(CACHE_MANAGER) cache: Cache) {
    super(cache);
  }
}

describe('AbstractCacheService', () => {
  let testingModule: TestingModule;
  let service: TestCacheService;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [CacheModule.register()],
      providers: [TestCacheService],
    }).compile();

    service = testingModule.get(TestCacheService);
  });

  afterEach(async () => {
    const cache = testingModule.get<Cache>(CACHE_MANAGER);
    await cache.clear();
    await testingModule.close();
  });

  it('stores, reads, and invalidates one namespaced entry', async () => {
    await service.set('123', { value: 'cached' });
    await expect(service.get('123')).resolves.toEqual({ value: 'cached' });

    await service.invalidate('123');
    await expect(service.get('123')).resolves.toBeUndefined();
  });

  it('rejects an empty identifier', async () => {
    await expect(service.get('  ')).rejects.toThrow(
      'Cache identifier must not be empty.',
    );
  });

  it('rejects a non-positive TTL', async () => {
    await expect(service.set('123', { value: 'cached' }, 0)).rejects.toThrow(
      'Cache TTL must be a positive integer in milliseconds.',
    );
  });
});
```

## Key conventions

Use `<module>:<resource>:<encoded-identifier>`:

```text
shipments:shipment:550e8400-e29b-41d4-a716-446655440000
carriers:carrier:ups
ups:oauth-token:production
tracking:run:6a39f...
```

Namespaces must be unique and feature-owned. Cache only JSON-serializable values. Do not cache TypeORM entity instances, credentials, raw Carrier payloads, browser objects, database connections, or request-scoped objects.

## V1 limitations

- The default in-memory store is process-local and is cleared on restart.
- API and worker cache entries are not shared.
- The default store has no project-configured hard LRU size limit; use bounded key cardinality and finite TTLs.
- Cache invalidation is best effort; correctness must never depend on a cache entry.
- Multiple worker replicas require a separate decision about shared caching and distributed rate limiting.

Do not add `cacheable`, Redis, or another store package without a concrete requirement and explicit dependency approval.
