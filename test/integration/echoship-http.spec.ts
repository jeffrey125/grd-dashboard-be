import { createServer, type Server } from 'node:http';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EchoShipAdapter } from '@modules/carriers/adapters/echoship/echoship.adapter.js';
import { EchoShipConfiguration } from '@modules/carriers/adapters/echoship/echoship.config.js';

describe('EchoShip cookie sessions against native HTTP fixtures', () => {
  let server: Server;
  let adapter: EchoShipAdapter;
  let cookies: Array<string | undefined>;
  let authorization: Array<string | undefined>;
  let mode: 'normal' | 'redirect' | 'large' | 'html' | 'trickle';
  const signal = new AbortController().signal;

  beforeEach(async () => {
    cookies = [];
    authorization = [];
    mode = 'normal';
    server = createServer((request, response) => {
      cookies.push(request.headers.cookie);
      authorization.push(request.headers.authorization);
      response.setHeader('content-type', 'application/json');

      if (request.url!.endsWith('signIn')) {
        response.setHeader('set-cookie', 'AuthToken=one; Path=/; HttpOnly');
        response.end(JSON.stringify({ status: { code: 200 }, data: {} }));

        return;
      }

      if (!request.headers.cookie) {
        response.writeHead(401);
        response.end('{}');

        return;
      }

      response.setHeader('set-cookie', 'AuthToken=two; Path=/; HttpOnly');

      if (mode === 'trickle') {
        response.write(' ');

        const stream = setInterval(() => response.write(' '), 50);

        response.on('close', () => clearInterval(stream));

        return;
      }

      if (mode === 'redirect') {
        response.writeHead(302, { location: '/private' });
        response.end();

        return;
      }

      if (mode === 'large') {
        response.end(' '.repeat(4 * 1024 * 1024 + 1));

        return;
      }

      if (mode === 'html') {
        response.setHeader('content-type', 'text/html');
        response.end('<form>PRIVATE</form>');

        return;
      }

      const data = request.url!.includes('loadSummaries')
        ? { results: [{ id: 69451086 }], totalRecordCount: 1 }
        : request.url!.endsWith('/tracking')
          ? [
              {
                id: 69451086,
                typeName: 'Moving',
                createdDate: '2026-10-13T10:00:00',
                modifiedDate: '2026-10-13T10:00:00',
              },
            ]
          : { id: '69451086', pickupDate: '2026-10-08T16:23:00' };

      response.end(JSON.stringify({ status: { code: 200 }, data }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );

    const address = server.address();

    if (!address || typeof address === 'string')
      throw new Error('Missing fixture address');

    const origin = `http://127.0.0.1:${address.port}`;
    const native = axios.getAdapter('http');

    adapter = new EchoShipAdapter(
      new EchoShipConfiguration({
        ECHOSHIP_URL: 'https://echoship.com',
        ECHOSHIP_USERNAME: 'fixture',
        ECHOSHIP_PASSWORD: 'PRIVATE',
      }),
      (config) => native({ ...config, baseURL: origin }),
    );
  });
  afterEach(async () => {
    await adapter?.onModuleDestroy();
    server?.closeAllConnections();

    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rotates cookies, limits Basic credentials to sign-in, and isolates the next run', async () => {
    const session = await adapter.openSession({
      signal,
      rateLimitPerMinute: null,
      fetchMode: 'request',
    });

    expect(await session.read('69451086', signal)).toMatchObject({
      outcome: 'found',
    });

    await session.close();

    const next = await adapter.openSession({
      signal,
      rateLimitPerMinute: null,
      fetchMode: 'request',
    });

    await next.close();

    expect(cookies).toEqual([
      undefined,
      'AuthToken=one',
      'AuthToken=two',
      'AuthToken=two',
      'AuthToken=two',
      undefined,
      'AuthToken=one',
    ]);
    expect(authorization[0]).toMatch(/^Basic /);
    expect(authorization.slice(1, 5)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it.each(['redirect', 'large', 'html'] as const)(
    'rejects %s without retries or leaking response data',
    async (failure) => {
      const session = await adapter.openSession({
        signal,
        rateLimitPerMinute: null,
        fetchMode: 'request',
      });

      mode = failure;

      const result = await session.read('69451086', signal);

      expect(result).toMatchObject({ outcome: 'failed', sourceData: null });
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(cookies).toHaveLength(3);
    },
  );

  it('bounds total response duration even while bytes keep arriving', async () => {
    const session = await adapter.openSession({
      signal,
      rateLimitPerMinute: null,
      fetchMode: 'request',
    });

    mode = 'trickle';

    const started = Date.now();

    expect(await session.read('69451086', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'ECHOSHIP_TIMEOUT',
    });
    expect(Date.now() - started).toBeLessThan(35_000);
    expect(cookies).toHaveLength(3);
  }, 40_000);
});
