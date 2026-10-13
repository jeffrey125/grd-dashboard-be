import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AbstractCacheService } from '@infrastructure/cache/abstract-cache.service.js';
import { UpsClient } from './ups.client.js';
import { UpsConfiguration } from './ups.config.js';
import { UpsFailure } from './ups.failure.js';
import { upsOAuthSchema } from './ups.schemas.js';
import { waitFor } from './ups.async.js';

interface Token {
  accessToken: string;
  expiresAt: number;
}

@Injectable()
export class UpsTokenProvider
  extends AbstractCacheService<Token>
  implements OnModuleDestroy
{
  protected readonly namespace = 'ups:oauth-token';
  protected readonly defaultTtlMs = 60_000;
  private inFlight?: Promise<string>;
  private readonly stopped = new AbortController();
  private cacheHealthy = true;

  constructor(
    @Inject(CACHE_MANAGER) cache: Cache,
    @Inject(UpsClient) private readonly client: UpsClient,
    @Inject(UpsConfiguration) private readonly configuration: UpsConfiguration,
  ) {
    super(cache);
  }

  async token(signal: AbortSignal, rejectedToken?: string): Promise<string> {
    signal.throwIfAborted();
    if (this.inFlight) {
      const value = await waitFor(this.inFlight, signal);
      if (value !== rejectedToken) return value;
    }
    this.inFlight ??= this.load(rejectedToken).finally(() => {
      this.inFlight = undefined;
    });
    return waitFor(this.inFlight, signal);
  }

  private async load(rejectedToken?: string): Promise<string> {
    const key = this.configuration.read().environment;
    let cached: Token | undefined;
    try {
      if (this.cacheHealthy) cached = await this.get(key);
    } catch {
      this.cacheHealthy = false;
    }
    if (
      cached &&
      typeof cached.accessToken === 'string' &&
      cached.accessToken.length > 0 &&
      !/\s/.test(cached.accessToken) &&
      Number.isFinite(cached.expiresAt) &&
      cached.expiresAt > Date.now() &&
      cached.accessToken !== rejectedToken
    )
      return cached.accessToken;
    try {
      if (this.cacheHealthy) await this.invalidate(key);
    } catch {
      this.cacheHealthy = false;
    }
    const started = Date.now();
    const result = upsOAuthSchema.safeParse(
      await this.client.oauth(this.stopped.signal),
    );
    if (!result.success)
      throw new UpsFailure(
        'UPS_INVALID_TOKEN_RESPONSE',
        true,
        'UPS returned an invalid authentication response.',
      );
    const ttl = Math.max(
      1,
      Math.floor(
        (result.data.expires_in - Math.min(60, result.data.expires_in * 0.1)) *
          1000,
      ),
    );
    const remaining = started + ttl - Date.now();
    try {
      if (this.cacheHealthy && remaining > 0)
        await this.set(
          key,
          { accessToken: result.data.access_token, expiresAt: started + ttl },
          remaining,
        );
    } catch {
      this.cacheHealthy = false;
    }
    return result.data.access_token;
  }

  onModuleDestroy(): void {
    this.stopped.abort();
  }
}
