import { createServer, type Server } from 'node:http';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FfeAdapter } from '@modules/carriers/adapters/ffe/ffe.adapter.js';
import { FfeConfiguration } from '@modules/carriers/adapters/ffe/ffe.config.js';

describe('FFE sessions against native HTTP fixtures', () => {
  let server: Server;
  let adapter: FfeAdapter;
  let mode: string;
  let cookies: Array<string | undefined>;
  let calls: string[];
  let requests: Array<Record<string, unknown>>;
  const signal = new AbortController().signal;
  beforeEach(async () => {
    mode = 'normal';
    cookies = [];
    calls = [];
    requests = [];
    server = createServer(async (request, response) => {
      calls.push(`${request.method} ${request.url}`);
      cookies.push(request.headers.cookie);
      let body = '';
      for await (const chunk of request) body += String(chunk);
      response.setHeader('content-type', 'text/html');
      if (request.url === '/Account/Login') {
        if (request.method === 'GET') {
          response.setHeader('set-cookie', 'ANTI=fixture; Path=/; HttpOnly');
          response.end(
            '<form action="/Account/Login" method="POST"><input value="token&amp;value" name="__RequestVerificationToken"></form>',
          );
          return;
        }
        const form = new URLSearchParams(body);
        if (
          !request.headers.cookie?.includes('ANTI=fixture') ||
          form.get('__RequestVerificationToken') !== 'token&value' ||
          form.get('Password') !== 'PRIVATE'
        ) {
          response.writeHead(400);
          response.end('PRIVATE');
          return;
        }
        response.writeHead(302, {
          location: '/Customer',
          'set-cookie': 'USERID=first; Path=/; HttpOnly',
        });
        response.end();
        return;
      }
      if (request.url === '/Customer/ShipmentTracking') {
        if (
          mode === 'expired' ||
          !request.headers.cookie?.includes('USERID=')
        ) {
          response.writeHead(302, { location: '/Account/Login' });
          response.end();
          return;
        }
        response.setHeader('set-cookie', 'USERID=rotated; Path=/; HttpOnly');
        response.end('<table id="shipmentTrackingDataTable"></table>');
        return;
      }
      response.setHeader('content-type', 'application/json');
      const parsed = JSON.parse(body);
      requests.push(parsed);
      if (mode === 'redirect') {
        response.writeHead(302, {
          location: 'https://example.invalid/private',
        });
        response.end();
        return;
      }
      if (mode === 'html') {
        response.setHeader('content-type', 'text/html');
        response.end('<input id="UserName">PRIVATE');
        return;
      }
      if (mode === 'large') {
        response.end(' '.repeat(4 * 1024 * 1024 + 1));
        return;
      }
      if (mode === 'trickle') {
        response.write(' ');
        const timer = setInterval(() => response.write(' '), 50);
        response.on('close', () => clearInterval(timer));
        return;
      }
      if (mode === 'expired') {
        response.end(
          JSON.stringify({
            draw: 1,
            recordsFiltered: 0,
            recordsTotal: 0,
            data: [],
          }),
        );
        return;
      }
      const reference = parsed.columns[0].search.value;
      const row = {
        orderNumber: reference,
        shipmentStatus: 'Scheduled',
        apptPickupDate: '2026-10-01T00:00:00',
        pickupAddress1: 'PRIVATE',
      };
      let data: unknown[] = [row];
      let filtered = 1;
      if (mode === 'missing') {
        data = [];
        filtered = 0;
      }
      if (mode === 'partial') {
        data = [];
        filtered = 10;
      }
      if (mode === 'paged') {
        data =
          parsed.start === 0
            ? [{ orderNumber: 'PARTIAL-OTHER', shipmentStatus: 'Moving' }]
            : [row];
        filtered = 2;
      }
      if (mode === 'duplicates') {
        data = [
          row,
          {
            ...row,
            shipmentStatus: 'Delivered',
            deliveryDate: '2026-10-10T00:00:00',
          },
        ];
        filtered = 2;
      }
      if (mode === 'malformed') {
        data = [{ ...row, shipmentStatus: { secret: 'PRIVATE' } }];
      }
      if (mode === 'cap') {
        data = [
          { orderNumber: `OTHER-${parsed.start}`, shipmentStatus: 'Moving' },
        ];
        filtered = 1000;
      }
      response.end(
        JSON.stringify({
          draw: mode === 'wrong-draw' ? 999 : String(parsed.draw),
          recordsTotal: 1000,
          recordsFiltered: filtered,
          data,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing fixture address');
    const native = axios.getAdapter('http');
    adapter = new FfeAdapter(
      new FfeConfiguration({
        FFE_URL: 'https://www.ffeinc.com/Customer/ShipmentTracking',
        FFE_USERNAME: 'fixture',
        FFE_PASSWORD: 'PRIVATE',
      }),
      (config) =>
        native({ ...config, baseURL: `http://127.0.0.1:${address.port}` }),
    );
  });
  afterEach(async () => {
    await adapter?.onModuleDestroy();
    server?.closeAllConnections();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const open = () =>
    adapter.openSession({
      signal,
      fetchMode: 'request',
      rateLimitPerMinute: null,
    });
  it('pairs the login token with cookies, rotates auth cookies and starts the next run fresh', async () => {
    const session = await open();
    expect(await session.read('001', signal)).toMatchObject({
      outcome: 'found',
    });
    expect(cookies).toEqual([
      undefined,
      'ANTI=fixture',
      'ANTI=fixture; USERID=first',
      'ANTI=fixture; USERID=rotated',
    ]);
    expect(requests[0]).toMatchObject({
      archiveLimit: '365',
      length: 100,
      start: 0,
    });
    await session.close();
    await open();
    expect(cookies[4]).toBeUndefined();
    expect(await session.read('001', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'FFE_SESSION_CLOSED',
    });
  });
  it.each(['missing', 'paged', 'duplicates'])(
    'handles %s without XML or whole-account retrieval',
    async (selected) => {
      const session = await open();
      mode = selected;
      const result = await session.read('001', signal);
      expect(result).toMatchObject(
        selected === 'missing'
          ? { outcome: 'not_found', sourceData: null }
          : { outcome: 'found', snapshot: { carrierStatus: 'Scheduled' } },
      );
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      if (selected === 'paged')
        expect(requests.map((row) => row.start)).toEqual([0, 1]);
      expect(calls.some((path) => /XML|CSV/.test(path))).toBe(false);
    },
  );
  it('does not mistake logged-out HTTP 200 empty JSON for absence or re-login afterward', async () => {
    const session = await open();
    mode = 'expired';
    expect(await session.read('001', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'FFE_AUTHENTICATION_FAILED',
      sourceData: null,
    });
    const count = calls.length;
    expect(await session.read('002', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'FFE_AUTHENTICATION_FAILED',
    });
    expect(calls).toHaveLength(count);
  });
  it.each([
    'partial',
    'malformed',
    'wrong-draw',
    'html',
    'large',
    'redirect',
    'cap',
  ])('fails %s without not-found or leaking raw evidence', async (selected) => {
    const session = await open();
    mode = selected;
    const result = await session.read('001', signal);
    expect(result).toMatchObject({ outcome: 'failed', sourceData: null });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(requests).toHaveLength(selected === 'cap' ? 10 : 1);
  });
  it('allows the next shipment after an isolated malformed record', async () => {
    const session = await open();
    mode = 'malformed';
    expect(await session.read('001', signal)).toMatchObject({
      outcome: 'failed',
    });
    mode = 'normal';
    expect(await session.read('002', signal)).toMatchObject({
      outcome: 'found',
    });
  });
  it('honors lookup cancellation and clears the session', async () => {
    const session = await open();
    mode = 'trickle';
    const controller = new AbortController();
    const pending = session.read('001', controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toBeDefined();
    await session.close();
  });
  it('enforces a total deadline even when a socket continuously receives bytes', async () => {
    const session = await open();
    mode = 'trickle';
    const start = Date.now();
    expect(await session.read('001', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'FFE_TIMEOUT',
    });
    expect(Date.now() - start).toBeLessThan(35_000);
    expect(requests).toHaveLength(1);
  }, 40_000);
});
