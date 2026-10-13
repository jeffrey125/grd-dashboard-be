import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios';
import { ApplicationCacheModule } from '@infrastructure/cache/application-cache.module.js';
import { UpsModule } from './ups.module.js';
import { UpsAdapter } from './ups.adapter.js';
import { UpsTokenProvider } from './ups-token.provider.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { LoggingModule } from '@infrastructure/logging/logging.module.js';
import { testEnvironment } from '@test/support/environment.js';
import { UPS_HTTP_ADAPTER } from './ups.client.js';

const reference = '1Z999AA10123456784';
const body = {
  trackResponse: {
    shipment: [
      {
        package: [
          {
            trackingNumber: reference,
            currentStatus: { description: 'In Transit' },
          },
        ],
      },
    ],
  },
};

describe('UPS adapter with mocked HTTP and clock', () => {
  let module: TestingModule;
  let adapter: UpsAdapter;
  let calls: { at: number; config: InternalAxiosRequestConfig }[];
  let respond: AxiosAdapter;
  let logs: string[];

  async function createModule() {
    module = await Test.createTestingModule({
      imports: [
        ApplicationCacheModule,
        UpsModule,
        LoggingModule.forRoot('worker', {
          write: (line) => {
            logs.push(line);
          },
        }),
      ],
    })
      .overrideProvider(UPS_HTTP_ADAPTER)
      .useValue(async (config: InternalAxiosRequestConfig) => {
        calls.push({ at: Date.now(), config });
        return respond(config);
      })
      .compile();
    adapter = module.get(UpsAdapter);
  }

  function response(
    config: InternalAxiosRequestConfig,
    data: unknown,
    status = 200,
    headers = {},
  ) {
    const result = {
      config,
      data,
      status,
      headers: { 'content-type': 'application/json', ...headers },
      statusText: String(status),
    };
    if (status >= 400)
      throw new AxiosError(
        'UNSAFE_PROVIDER_ERROR',
        undefined,
        config,
        undefined,
        result,
      );
    return result;
  }

  // Move timers and Date together: changing Date alone breaks Bottleneck's clock.
  async function finish<T>(promise: Promise<T>): Promise<T> {
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let tick = 0; !settled && tick < 1000; tick++)
      await vi.advanceTimersByTimeAsync(1000);
    if (!settled)
      throw new Error('UPS operation did not settle within fake-time bound');
    return promise;
  }

  beforeEach(async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
    vi.stubEnv('LOG_LEVEL', 'debug');
    logs = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    vi.stubEnv('UPS_ENVIRONMENT', 'production');
    vi.stubEnv('UPS_CLIENT_ID', 'fixture-client');
    vi.stubEnv('UPS_CLIENT_SECRET', 'fixture-secret');
    calls = [];
    respond = async (config) =>
      response(
        config,
        config.url?.includes('/oauth/token')
          ? { access_token: 'token', expires_in: '3600' }
          : body,
      );
    await createModule();
  });
  afterEach(async () => {
    if (module) await finish(module.close());
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('maps a lookup and shares a cached OAuth token and request quota across sessions', async () => {
    const signal = new AbortController().signal;
    for (let index = 0; index < 2; index++) {
      const session = await finish(
        adapter.openSession({ signal, rateLimitPerMinute: 10 }),
      );
      expect(await finish(session.read(reference, signal))).toMatchObject({
        outcome: 'found',
        snapshot: { carrierStatus: 'In Transit' },
      });
      await session.close();
    }
    expect(calls.map(({ config }) => config.method)).toEqual([
      'post',
      'get',
      'get',
    ]);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(6000);
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(6000);
    expect(calls[1]!.config.headers.Authorization).toBe('Bearer token');
    expect(calls[1]!.config.params).toEqual({
      locale: 'en_US',
      returnSignature: false,
      returnMilestones: false,
      returnPOD: false,
    });
  });

  it('deduplicates concurrent token refreshes and recovers after cache loss', async () => {
    const signal = new AbortController().signal;
    await finish(adapter.openSession({ signal, rateLimitPerMinute: 10 }));
    const tokens = module.get(UpsTokenProvider);
    expect(
      await finish(
        Promise.all([
          tokens.token(signal),
          tokens.token(signal),
          tokens.token(signal),
        ]),
      ),
    ).toEqual(['token', 'token', 'token']);
    expect(calls).toHaveLength(1);
    await module.get<Cache>(CACHE_MANAGER).clear();
    expect(await finish(tokens.token(signal))).toBe('token');
    expect(calls).toHaveLength(2);
  });

  it('retries transient tracking failures twice, consuming capacity and unique transaction IDs', async () => {
    respond = async (config) =>
      response(
        config,
        config.method === 'post'
          ? { access_token: 'token', expires_in: 3600 }
          : {},
        config.method === 'post' ? 200 : 503,
      );
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(session.read(reference, signal))).toMatchObject({
      outcome: 'failed',
      retryable: true,
      reasonCode: 'UPS_UNAVAILABLE',
    });
    expect(calls).toHaveLength(4);
    expect(
      new Set(calls.map(({ config }) => config.headers.get('transId'))).size,
    ).toBe(4);
    for (let index = 1; index < calls.length; index++)
      expect(calls[index]!.at - calls[index - 1]!.at).toBeGreaterThanOrEqual(
        6000,
      );
  });

  it('immediately fails a long Retry-After and suppresses other sessions until it expires', async () => {
    let tracking = 0;
    respond = async (config) => {
      if (config.method === 'post')
        return response(config, { access_token: 'token', expires_in: 3600 });
      return ++tracking === 1
        ? response(config, {}, 429, { 'retry-after': '120' })
        : response(config, body);
    };
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    const first = await finish(session.read(reference, signal));
    expect(first).toMatchObject({
      outcome: 'failed',
      retryable: true,
      reasonCode: 'UPS_RATE_LIMITED',
      message: 'UPS temporarily unavailable. Tracking will retry later.',
    });
    expect(Date.now() - calls.at(-1)!.at).toBeLessThan(1000);
    await session.close();
    const next = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(next.read(reference, signal))).toEqual(first);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await finish(next.read(reference, signal))).toMatchObject({
      outcome: 'found',
    });
    expect(calls).toHaveLength(3);
  });

  it('refreshes one rejected token and bounds a repeated 401 without exposing provider errors', async () => {
    let auth = 0;
    respond = async (config) =>
      config.method === 'post'
        ? response(config, {
            access_token: `token-${++auth}`,
            expires_in: 3600,
          })
        : response(config, {}, 401);
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    const result = await finish(session.read(reference, signal));
    expect(result).toMatchObject({
      outcome: 'failed',
      reasonCode: 'UPS_AUTHENTICATION_FAILED',
      retryable: false,
    });
    expect(calls.map(({ config }) => config.method)).toEqual([
      'post',
      'get',
      'post',
      'get',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/UNSAFE|fixture-secret|token-/);
    const diagnostics = logs
      .map((line) => JSON.parse(line))
      .filter((line) => line.event === 'ups.request.failed');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      component: 'ups.tracking',
      errorStatus: 401,
    });
    expect(logs.join('')).not.toMatch(
      /UNSAFE|fixture-secret|fixture-client|token-/,
    );
  });

  it('treats OAuth 404 as authentication failure and only tracking 404 as not found', async () => {
    respond = async (config) => response(config, {}, 404);
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(session.read(reference, signal))).toMatchObject({
      outcome: 'failed',
      reasonCode: 'UPS_AUTHENTICATION_FAILED',
    });
    expect(calls).toHaveLength(1);
    expect(logs.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ component: 'ups.oauth', errorStatus: 404 }),
    );
    respond = async (config) =>
      config.method === 'post'
        ? response(config, { access_token: 'token', expires_in: 3600 })
        : response(config, {}, 404);
    expect(await finish(session.read(reference, signal))).toEqual({
      outcome: 'not_found',
      sourceData: null,
    });
    expect(calls).toHaveLength(3);
  });

  it.each([
    ['production', 100, 6000, 30],
    ['cie', 10, 12000, 60],
    ['production', 2, 30000, 30],
    ['cie', null, 12000, 60],
  ] as const)(
    'caps %s requests configured at %s RPM',
    async (environment, rpm, gap, interval) => {
      await finish(module.close());
      vi.stubEnv('UPS_ENVIRONMENT', environment);
      await createModule();
      expect(adapter.minimumIntervalMinutes).toBe(interval);
      const signal = new AbortController().signal;
      const session = await finish(
        adapter.openSession({ signal, rateLimitPerMinute: rpm }),
      );
      for (let index = 0; index < 6; index++)
        await finish(session.read(reference, signal));
      for (let index = 1; index < calls.length; index++)
        expect(calls[index]!.at - calls[index - 1]!.at).toBeGreaterThanOrEqual(
          gap,
        );
      expect(calls[0]!.config.url).toContain(
        environment === 'cie' ? 'wwwcie.ups.com' : 'onlinetools.ups.com',
      );
    },
  );

  it('does not reset the preceding minute quota when the database rate changes', async () => {
    const signal = new AbortController().signal;
    const first = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    await finish(first.read(reference, signal));
    const previous = calls.at(-1)!.at;
    const next = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 1 }),
    );
    await finish(next.read(reference, signal));
    expect(calls.at(-1)!.at - previous).toBeGreaterThanOrEqual(60_000);
  });

  it.each(['30', 'Tue, 13 Oct 2026 00:00:40 GMT'])(
    'honors a short Retry-After: %s',
    async (header) => {
      let tracking = 0;
      respond = async (config) => {
        if (config.method === 'post')
          return response(config, { access_token: 'token', expires_in: 3600 });
        return ++tracking === 1
          ? response(config, {}, 429, { 'retry-after': header })
          : response(config, body);
      };
      const signal = new AbortController().signal;
      const session = await finish(
        adapter.openSession({ signal, rateLimitPerMinute: 10 }),
      );
      expect(await finish(session.read(reference, signal))).toMatchObject({
        outcome: 'found',
      });
      expect(calls).toHaveLength(3);
      if (header === '30')
        expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(30_000);
      else expect(calls[2]!.at).toBeGreaterThanOrEqual(Date.parse(header));
    },
  );

  it.each([408, 429, 500, 502])(
    'bounds retries for HTTP %s',
    async (status) => {
      respond = async (config) =>
        config.method === 'post'
          ? response(config, { access_token: 'token', expires_in: 3600 })
          : response(config, {}, status, { 'retry-after': 'garbage' });
      const signal = new AbortController().signal;
      const session = await finish(
        adapter.openSession({ signal, rateLimitPerMinute: 10 }),
      );
      expect(await finish(session.read(reference, signal))).toMatchObject({
        outcome: 'failed',
        retryable: true,
      });
      expect(calls).toHaveLength(4);
    },
  );

  it('bounds OAuth retries and recovers on the next lookup after refresh failure', async () => {
    respond = async (config) => response(config, {}, 503);
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(session.read(reference, signal))).toMatchObject({
      outcome: 'failed',
      retryable: true,
    });
    expect(calls).toHaveLength(2);
    respond = async (config) =>
      response(
        config,
        config.method === 'post'
          ? { access_token: 'recovered', expires_in: 3600 }
          : body,
      );
    expect(await finish(session.read(reference, signal))).toMatchObject({
      outcome: 'found',
    });
  });

  it.each(['ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT'])(
    'retries %s without leaking transport diagnostics',
    async (code) => {
      respond = async (config) => {
        if (config.method === 'post')
          return response(config, { access_token: 'token', expires_in: 3600 });
        throw new AxiosError('UNSAFE_PROVIDER_ERROR', code, config);
      };
      const signal = new AbortController().signal;
      const session = await finish(
        adapter.openSession({ signal, rateLimitPerMinute: 10 }),
      );
      expect(await finish(session.read(reference, signal))).toMatchObject({
        outcome: 'failed',
        retryable: true,
      });
      expect(calls).toHaveLength(4);
    },
  );

  it('aborts a hung physical request after 15 seconds and exhausts only two tracking retries', async () => {
    respond = async (config) =>
      config.method === 'post'
        ? response(config, { access_token: 'token', expires_in: 3600 })
        : new Promise(() => {});
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(session.read(reference, signal))).toMatchObject({
      outcome: 'failed',
      reasonCode: 'UPS_TIMEOUT',
      retryable: true,
    });
    expect(calls).toHaveLength(4);
    expect(calls.slice(1).every(({ config }) => config.signal?.aborted)).toBe(
      true,
    );
  });

  it.each(['123', 'x'.repeat(35), '\u0000invalid'])(
    'rejects invalid lookup references before OAuth or tracking',
    async (invalid) => {
      const signal = new AbortController().signal;
      const session = await finish(
        adapter.openSession({ signal, rateLimitPerMinute: 10 }),
      );
      expect(await finish(session.read(invalid, signal))).toMatchObject({
        outcome: 'failed',
        reasonCode: 'INVALID_TRACKING_REFERENCE',
        retryable: false,
      });
      expect(calls).toHaveLength(0);
    },
  );

  it('refreshes before provider expiry and recovers from a corrupt cached token', async () => {
    const signal = new AbortController().signal;
    await finish(adapter.openSession({ signal, rateLimitPerMinute: 10 }));
    const tokens = module.get(UpsTokenProvider);
    const started = Date.now();
    await finish(tokens.token(signal));
    await vi.advanceTimersByTimeAsync(started + 3_539_000 - Date.now());
    await finish(tokens.token(signal));
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await finish(tokens.token(signal));
    expect(calls).toHaveLength(2);
    await module.get<Cache>(CACHE_MANAGER).set('ups:oauth-token:production', {
      accessToken: null,
      expiresAt: Date.now() + 100_000,
    });
    await finish(tokens.token(signal));
    expect(calls).toHaveLength(3);
  });

  it('deduplicates rejected-token refresh and ignores a late rejection of the older token', async () => {
    let auth = 0;
    respond = async (config) =>
      response(config, { access_token: `token-${++auth}`, expires_in: 3600 });
    const signal = new AbortController().signal;
    await finish(adapter.openSession({ signal, rateLimitPerMinute: 10 }));
    const tokens = module.get(UpsTokenProvider);
    expect(await finish(tokens.token(signal))).toBe('token-1');
    expect(
      await finish(
        Promise.all([
          tokens.token(signal, 'token-1'),
          tokens.token(signal, 'token-1'),
        ]),
      ),
    ).toEqual(['token-2', 'token-2']);
    expect(await finish(tokens.token(signal, 'token-1'))).toBe('token-2');
    expect(calls).toHaveLength(2);
  });

  it.each([
    { access_token: 'token', expires_in: 0 },
    { access_token: '', expires_in: 3600 },
    { access_token: 'token', expires_in: null },
    { access_token: 'token', expires_in: 'Infinity' },
  ])('does not cache malformed OAuth responses', async (body) => {
    respond = async (config) => response(config, body);
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(session.read(reference, signal))).toMatchObject({
      outcome: 'failed',
      reasonCode: 'UPS_INVALID_TOKEN_RESPONSE',
    });
    expect(calls).toHaveLength(1);
  });

  it('cancels one token waiter without cancelling a shared refresh needed by another', async () => {
    const cancelled = new AbortController();
    const signal = new AbortController().signal;
    await finish(adapter.openSession({ signal, rateLimitPerMinute: 10 }));
    const tokens = module.get(UpsTokenProvider);
    const first = tokens.token(cancelled.signal);
    const second = tokens.token(signal);
    const rejected = expect(first).rejects.toThrow(
      'This operation was aborted',
    );
    cancelled.abort();
    await rejected;
    expect(await finish(second)).toBe('token');
    expect(calls).toHaveLength(1);
  });

  it('cancels a queued lookup promptly and never sends it later', async () => {
    const controller = new AbortController();
    const session = await finish(
      adapter.openSession({ signal: controller.signal, rateLimitPerMinute: 1 }),
    );
    const read = session.read(reference, controller.signal);
    const rejected = expect(read).rejects.toThrow('This operation was aborted');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(1);
  });

  it('cancels an active HTTP lookup when its session closes', async () => {
    respond = async (config) =>
      config.method === 'post'
        ? response(config, { access_token: 'token', expires_in: 3600 })
        : new Promise(() => {});
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    const read = session.read(reference, signal);
    const rejected = expect(read).rejects.toThrow('This operation was aborted');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(2);
    await session.close();
    await rejected;
    expect(calls[1]!.config.signal?.aborted).toBe(true);
  });

  it.each([
    ['UPS_ENVIRONMENT', 'wrong'],
    ['UPS_CLIENT_ID', ''],
    ['UPS_CLIENT_SECRET', ' '],
  ])(
    'validates %s without revealing credentials or making requests',
    async (key, value) => {
      await finish(module.close());
      vi.stubEnv(key, value);
      await createModule();
      expect(() => adapter.validateConfiguration()).toThrow(
        'UPS requires a valid environment, client ID, and client secret.',
      );
      expect(calls).toHaveLength(0);
    },
  );

  it('rejects unexpected content types even when the body resembles tracking JSON', async () => {
    respond = async (config) =>
      config.method === 'post'
        ? response(config, { access_token: 'token', expires_in: 3600 })
        : response(config, body, 200, { 'content-type': 'text/html' });
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(session.read(reference, signal))).toMatchObject({
      outcome: 'failed',
      reasonCode: 'UPS_INVALID_RESPONSE',
    });
  });

  it('classifies malformed tracking payloads as technical failures', async () => {
    respond = async (config) =>
      response(
        config,
        config.method === 'post'
          ? { access_token: 'token', expires_in: 3600 }
          : { unsafe: 'PRIVATE_PAYLOAD' },
      );
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    expect(await finish(session.read(reference, signal))).toEqual({
      outcome: 'failed',
      reasonCode: 'UPS_INVALID_RESPONSE',
      retryable: true,
      message: 'UPS returned an invalid tracking response.',
      sourceData: null,
    });
    expect(calls).toHaveLength(2);
  });
});
