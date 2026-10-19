import { chromium, type Browser } from 'playwright';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FfeAdapter } from '@modules/carriers/adapters/ffe/ffe.adapter.js';
import { FfeConfiguration } from '@modules/carriers/adapters/ffe/ffe.config.js';

describe('FFE UI-driven tracking in real Chromium', () => {
  let adapter: FfeAdapter;
  let browser: Browser;
  let server: Server;
  const signal = new AbortController().signal;

  afterEach(async () => {
    await adapter?.onModuleDestroy();
    await browser?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function fixture(
    options: {
      missing?: boolean;
      partial?: boolean;
      expired?: boolean;
      expiredArchive?: boolean;
      timeoutFirst?: boolean;
      conflictingDom?: boolean;
    } = {},
  ) {
    const http = vi.fn();
    const calls: string[] = [];
    let expired = false;

    // Use real loopback redirects. Playwright route interception and the
    // adapter's CDP Fetch interception otherwise compete for redirected requests.
    server = createServer(async (request, response) => {
      const path = new URL(request.url!, 'http://fixture.test').pathname;
      calls.push(path);

      if (path === '/Account/Login') {
        if (request.method === 'POST') {
          request.resume();
          response.writeHead(302, { location: '/Customer' });
          response.end();
          return;
        }

        response.setHeader('content-type', 'text/html');
        response.end(
          '<form action="/Account/Login" method="post"><input id="UserName" name="UserName"><input id="Password" name="Password"><button>Login</button></form>',
        );
        return;
      }

      if (path === '/Customer/LoadShipmentTrackingData') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const reference = body.columns[0].search.value;

        if (options.timeoutFirst && reference === '001') return;
        if (options.expired && reference) expired = true;
        if (options.expiredArchive && body.archiveLimit === '365')
          expired = true;

        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            draw: body.draw,
            recordsTotal: expired ? 0 : 50,
            recordsFiltered:
              expired || options.missing ? (options.partial ? 30 : 0) : 2,
            data:
              expired || options.missing
                ? []
                : [
                    {
                      orderNumber: reference || '001',
                      shipmentStatus: 'Delivered',
                      apptPickupDate: '2026-10-01T00:00:00',
                      pickupDate: '2026-10-02T00:00:00',
                      deliveryDate: '2026-10-06T00:00:00',
                    },
                    {
                      orderNumber: reference || '001',
                      shipmentStatus: 'Scheduled',
                    },
                  ],
          }),
        );
        return;
      }

      if (expired && path === '/Customer/ShipmentTracking') {
        response.writeHead(302, { location: '/Account/Login' });
        response.end();
        return;
      }

      response.setHeader('content-type', 'text/html');
      response.end(
        path === '/Customer/ShipmentTracking'
          ? `<table id="shipmentTrackingDataTable"><tbody><tr><td>${options.conflictingDom ? 'Conflicting DOM status' : 'Loading'}</td></tr></tbody></table><input id="archive-toggle-value" value="90" type="hidden"><button id="archive-toggle-button" onclick="document.querySelector('#archive-toggle-value').value='365';search()">Archive 1 Year</button><input placeholder="Order# Search" onchange="search()"><script>let draw=0;function search(){return fetch('/Customer/LoadShipmentTrackingData',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draw:++draw,start:0,length:25,archiveLimit:document.querySelector('#archive-toggle-value').value,columns:[{data:'orderNumber',search:{value:document.querySelector('[placeholder="Order# Search"]').value}}]})});}search();</script>`
          : '<a href="/Customer/ShipmentTracking">Shipment Tracking</a>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const configuration = new FfeConfiguration({});
    vi.spyOn(configuration, 'read').mockReturnValue({
      origin,
      username: 'fixture',
      password: 'PRIVATE',
      executablePath: undefined,
    });

    adapter = new FfeAdapter(configuration, http, async () => {
      browser = await chromium.launch({ headless: true });
      return browser;
    });

    const session = await adapter.openSession({
      signal,
      fetchMode: 'browser',
      rateLimitPerMinute: null,
    });

    return { session, http, calls };
  }

  it('uses the one-year UI search and first exact JSON record, never DOM tracking text', async () => {
    const f = await fixture({ conflictingDom: true });

    expect(await f.session.read('001', signal)).toMatchObject({
      outcome: 'found',
      snapshot: {
        carrierStatus: 'Delivered',
        pickedUpOn: '2026-10-02',
        deliveredOn: '2026-10-06',
      },
    });
    expect(f.http).not.toHaveBeenCalled();
    expect(f.calls.some((path) => /XML|CSV/.test(path))).toBe(false);

    await f.session.close();

    expect(browser.isConnected()).toBe(false);
  });
  it.each([{ missing: true }, { missing: true, partial: true }])(
    'distinguishes complete authenticated absence from partial results: %j',
    async (options) => {
      const f = await fixture(options);

      expect(await f.session.read('001', signal)).toMatchObject({
        outcome: options.partial ? 'failed' : 'not_found',
        sourceData: null,
      });
    },
  );
  it.each([{ expired: true }, { expiredArchive: true }])(
    'invalidates the session when an empty JSON response conceals expired authentication: %j',
    async (options) => {
      const f = await fixture(options);

      expect(await f.session.read('001', signal)).toMatchObject({
        outcome: 'failed',
        reasonCode: 'FFE_AUTHENTICATION_FAILED',
        sourceData: null,
      });

      const count = f.calls.length;

      expect(await f.session.read('002', signal)).toMatchObject({
        outcome: 'failed',
        reasonCode: 'FFE_AUTHENTICATION_FAILED',
      });
      expect(f.calls).toHaveLength(count);
    },
  );
  it('closes the browser when a lookup is cancelled', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const pending = f.session.read('001', controller.signal);

    controller.abort();
    await expect(pending).rejects.toBeDefined();
    await f.session.close();

    expect(browser.isConnected()).toBe(false);
  });
  it('recovers a timed-out page without a second login or retrying the reference', async () => {
    const f = await fixture({ timeoutFirst: true });

    expect(await f.session.read('001', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'FFE_TIMEOUT',
      sourceData: null,
    });
    expect(await f.session.read('002', signal)).toMatchObject({
      outcome: 'found',
      snapshot: { carrierStatus: 'Delivered' },
    });
    expect(f.calls.filter((path) => path === '/Account/Login')).toHaveLength(2);
    expect(browser.isConnected()).toBe(true);
  }, 45000);
});
