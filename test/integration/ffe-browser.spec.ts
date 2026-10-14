import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FfeAdapter } from '@modules/carriers/adapters/ffe/ffe.adapter.js';
import { FfeConfiguration } from '@modules/carriers/adapters/ffe/ffe.config.js';

describe('FFE UI-driven tracking in real Chromium', () => {
  let adapter: FfeAdapter;
  let browser: Browser;
  const signal = new AbortController().signal;

  afterEach(async () => {
    await adapter?.onModuleDestroy();
    await browser?.close();
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

    adapter = new FfeAdapter(
      new FfeConfiguration({
        FFE_URL: 'https://www.ffeinc.com/Customer/ShipmentTracking',
        FFE_USERNAME: 'fixture',
        FFE_PASSWORD: 'PRIVATE',
      }),
      http,
      async () => {
        browser = await chromium.launch({ headless: true });

        const original = browser.newContext.bind(browser);

        browser.newContext = async (settings) => {
          const context = await original(settings);

          context.on('page', (page) => {
            void page.route('**/*', async (route) => {
              const request = route.request();
              const url = new URL(request.url());

              calls.push(url.pathname);

              if (url.pathname === '/Account/Login') {
                if (request.method() === 'POST') {
                  await route.fulfill({
                    status: 302,
                    headers: { location: '/Customer' },
                    body: '',
                  });

                  return;
                }

                await route.fulfill({
                  contentType: 'text/html',
                  body: '<form action="/Account/Login" method="post"><input id="UserName" name="UserName"><input id="Password" name="Password"><button>Login</button></form>',
                });

                return;
              }

              if (url.pathname === '/Customer/LoadShipmentTrackingData') {
                const body = request.postDataJSON();
                const reference = body.columns[0].search.value;

                if (options.timeoutFirst && reference === '001') return;

                if (options.expired && reference) expired = true;

                if (options.expiredArchive && body.archiveLimit === '365')
                  expired = true;

                await route.fulfill({
                  contentType: 'application/json',
                  body: JSON.stringify({
                    draw: expired ? 1 : body.draw,
                    recordsTotal: expired ? 0 : 50,
                    recordsFiltered:
                      expired || options.missing
                        ? options.partial
                          ? 30
                          : 0
                        : 2,
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
                });

                return;
              }

              if (expired && url.pathname === '/Customer/ShipmentTracking') {
                await route.fulfill({
                  status: 302,
                  headers: { location: '/Account/Login' },
                  body: '',
                });

                return;
              }

              const body =
                url.pathname === '/Customer/ShipmentTracking'
                  ? `<table id="shipmentTrackingDataTable"><tbody><tr><td>${options.conflictingDom ? 'Conflicting DOM status' : 'Loading'}</td></tr></tbody></table><input id="archive-toggle-value" value="90" type="hidden"><button id="archive-toggle-button" onclick="document.querySelector('#archive-toggle-value').value='365';search()">Archive 1 Year</button><input placeholder="Order# Search" onchange="search()"><script>let draw=0;function search(){return fetch('/Customer/LoadShipmentTrackingData',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draw:++draw,start:0,length:25,archiveLimit:document.querySelector('#archive-toggle-value').value,columns:[{data:'orderNumber',search:{value:document.querySelector('[placeholder="Order# Search"]').value}}]})});}search();</script>`
                  : '<a href="/Customer/ShipmentTracking">Shipment Tracking</a>';

              await route.fulfill({ contentType: 'text/html', body });
            });
          });

          return context;
        };

        return browser;
      },
    );

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
