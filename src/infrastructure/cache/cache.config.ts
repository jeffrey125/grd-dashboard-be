import type { CacheModuleOptions } from '@nestjs/cache-manager';

export const APPLICATION_CACHE_DEFAULT_TTL_MS = 60_000;

export const applicationCacheOptions = {
  ttl: APPLICATION_CACHE_DEFAULT_TTL_MS,
} satisfies CacheModuleOptions;
