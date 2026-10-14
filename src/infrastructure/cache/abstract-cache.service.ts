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
