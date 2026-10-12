# V1-006: Add the in-memory cache infrastructure

## Status

Depends on V1-003.

## Objective

Implement the approved process-local Nest cache module and abstract feature cache service without Redis or cross-process assumptions.

## Required reading

- [`../cache-design.md`](../cache-design.md) in full
- [`../architecture.md`](../architecture.md), Cache section

## Scope

- Install the approved `@nestjs/cache-manager` and `cache-manager` packages.
- Implement `ApplicationCacheModule`, configuration, `AbstractCacheService<TValue>`, and their tests.
- Import the global module once in `AppModule` and once in `WorkerModule`.
- Keep feature cache services out until their owning tickets have concrete use cases.

## Acceptance criteria

- API and worker each receive an independent in-memory cache.
- Namespaces and identifiers cannot be empty; identifiers are safely encoded.
- TTLs are positive integer milliseconds; never-expiring entries are rejected by the abstract service.
- The base service exposes `get`, `set`, and feature-scoped `invalidate`, not global `clear`.
- Cache values and misses follow the selected cache-manager version's documented behavior.
- No Redis, `cacheable`, external store, HTTP `CacheInterceptor`, or shared-cache claim is added.

## Verification

Run cache unit tests covering registration, namespacing, get/set/invalidate, invalid identifiers, and invalid TTL; then typecheck and build.
