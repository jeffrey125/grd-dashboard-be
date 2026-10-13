import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { setTimeout as allowNetworkIO } from 'node:timers/promises';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { Test, type TestingModule } from '@nestjs/testing';
import { ApplicationCacheModule } from '@infrastructure/cache/application-cache.module.js';
import { UpsModule } from '@modules/carriers/adapters/ups/ups.module.js';
import { UpsAdapter } from '@modules/carriers/adapters/ups/ups.adapter.js';
import { UPS_HTTP_ADAPTER } from '@modules/carriers/adapters/ups/ups.client.js';
import { LoggingModule } from '@infrastructure/logging/logging.module.js';
import { testEnvironment } from '@test/support/environment.js';

describe('UPS native HTTP transport against a local fixture server', () => {
  let server: Server;
  let module: TestingModule;
  let adapter: UpsAdapter;
  let trackResponse: (response: ServerResponse) => void;
  let requests: {
    url: string;
    authorization: string | undefined;
    body: string;
  }[];

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
    for (let tick = 0; !settled && tick < 2000; tick++) {
      await vi.advanceTimersByTimeAsync(100);
      await allowNetworkIO(2);
    }
    if (!settled) throw new Error('HTTP fixture did not finish');
    return promise;
  }

  beforeEach(async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
    vi.stubEnv('LOG_LEVEL', 'silent');
    requests = [];
    vi.stubEnv('UPS_ENVIRONMENT', 'production');
    vi.stubEnv('UPS_CLIENT_ID', 'fixture-client');
    vi.stubEnv('UPS_CLIENT_SECRET', 'fixture-secret');
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({
          url: request.url!,
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString(),
        });
        response.setHeader('Content-Type', 'application/json');
        if (request.url?.includes('/oauth/token'))
          response.end(
            JSON.stringify({ access_token: 'fixture-token', expires_in: 3600 }),
          );
        else trackResponse(response);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing fixture port');
    const origin = `http://127.0.0.1:${address.port}`;
    const nativeTransport = axios.getAdapter('http');
    module = await Test.createTestingModule({
      imports: [
        ApplicationCacheModule,
        UpsModule,
        LoggingModule.forRoot('worker'),
      ],
    })
      .overrideProvider(UPS_HTTP_ADAPTER)
      .useValue((config: InternalAxiosRequestConfig) =>
        nativeTransport({
          ...config,
          url: `${origin}${new URL(config.url!).pathname}`,
          proxy: false,
        }),
      )
      .compile();
    adapter = module.get(UpsAdapter);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(async () => {
    if (module) await finish(module.close());
    vi.useRealTimers();
    server?.closeAllConnections();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  async function lookup() {
    const signal = new AbortController().signal;
    const session = await finish(
      adapter.openSession({ signal, rateLimitPerMinute: 10 }),
    );
    return finish(session.read('FOUND001', signal));
  }

  it('sends OAuth Basic credentials, Bearer tracking authorization, and privacy query flags', async () => {
    trackResponse = (response) =>
      response.end(
        JSON.stringify({
          trackResponse: {
            shipment: [
              {
                package: [
                  {
                    trackingNumber: 'FOUND001',
                    currentStatus: { description: 'Moving' },
                  },
                ],
              },
            ],
          },
        }),
      );
    expect(await lookup()).toMatchObject({ outcome: 'found' });
    expect(requests[0]).toEqual({
      url: '/security/v1/oauth/token',
      authorization: `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`,
      body: 'grant_type=client_credentials',
    });
    expect(requests[1]!.authorization).toBe('Bearer fixture-token');
    expect(
      new URL(requests[1]!.url, 'http://fixture').searchParams.get(
        'returnSignature',
      ),
    ).toBe('false');
    expect(
      new URL(requests[1]!.url, 'http://fixture').searchParams.get('returnPOD'),
    ).toBe('false');
  });

  it.each(['oversized', 'malformed'])(
    'rejects %s JSON before persistence without retrying it',
    async (mode) => {
      trackResponse = (response) =>
        response.end(
          mode === 'oversized'
            ? JSON.stringify({ data: 'x'.repeat(1_048_576) })
            : '{invalid-json',
        );
      expect(await lookup()).toMatchObject({
        outcome: 'failed',
        reasonCode: 'UPS_INVALID_RESPONSE',
        sourceData: null,
      });
      expect(requests).toHaveLength(2);
    },
  );

  it('does not follow a redirect carrying authorization', async () => {
    trackResponse = (response) => {
      response.statusCode = 302;
      response.setHeader('Location', '/redirect-target');
      response.end('{}');
    };
    expect(await lookup()).toEqual({
      outcome: 'failed',
      reasonCode: 'UPS_UNAVAILABLE',
      retryable: false,
      message: 'UPS tracking could not be completed.',
      sourceData: null,
    });
    expect(requests).toHaveLength(2);
  });
});
