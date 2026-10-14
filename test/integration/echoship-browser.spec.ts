import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EchoShipAdapter } from '@modules/carriers/adapters/echoship/echoship.adapter.js';
import { EchoShipConfiguration } from '@modules/carriers/adapters/echoship/echoship.config.js';

describe('EchoShip real Chromium with fully intercepted portal fixtures', () => {
  let adapter: EchoShipAdapter;
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
      unauthorized?: boolean;
    } = {},
  ) {
    const calls: string[] = [];
    const http = vi.fn();

    adapter = new EchoShipAdapter(
      new EchoShipConfiguration({
        ECHOSHIP_URL: 'https://echoship.com/login',
        ECHOSHIP_USERNAME: 'fixture',
        ECHOSHIP_PASSWORD: 'PRIVATE',
      }),
      http,
      async () => {
        browser = await chromium.launch({ headless: true });

        // Intercept at Page level so no fixture can reach the real portal.
        const original = browser.newContext.bind(browser);

        browser.newContext = async (settings) => {
          const context = await original(settings);

          context.on('page', (page) => {
            void page.route('**/*', async (route) => {
              const url = new URL(route.request().url());

              calls.push(url.pathname);

              if (url.pathname.startsWith('/api/')) {
                if (url.pathname === '/api/v1//customer') {
                  await route.fulfill({
                    status: 401,
                    contentType: 'application/json',
                    body: '{}',
                  });

                  return;
                }

                let data: unknown = {};

                if (url.pathname.includes('loadSummaries'))
                  data = {
                    results: options.missing ? [] : [{ id: 69451086 }],
                    totalRecordCount: options.partial
                      ? 20
                      : options.missing
                        ? 0
                        : 1,
                  };
                else if (url.pathname.endsWith('/tracking'))
                  data = [
                    {
                      id: 69451086,
                      typeName: 'Shipment enroute',
                      notes: 'Arrived at terminal',
                      createdDate: '2026-10-13T10:00:00',
                      modifiedDate: '2026-10-13T10:00:00',
                    },
                  ];
                else if (url.pathname.includes('/loads/'))
                  data = {
                    id: '69451086',
                    pickupDate: '2026-10-08T23:23:00-07:00',
                    deliveryByDate: '2026-10-15T08:00:00',
                  };

                await route.fulfill({
                  status:
                    options.unauthorized && url.pathname.endsWith('/tracking')
                      ? 401
                      : 200,
                  contentType: 'application/json',
                  body: JSON.stringify({ status: { code: 200 }, data }),
                });

                return;
              }

              let html = '<html><body>Quote</body></html>';

              if (url.pathname === '/' || url.pathname === '/login')
                html = `<script>fetch('/api/v1//customer')</script><input name="username"><input name="password"><button onclick="fetch('/api/v1//auth/signIn',{method:'POST'}).then(()=>location.href='/new-quote/ltl')">Login</button>`;

              if (url.pathname === '/shipments/all')
                html = `<input id="search-input"><div id="results"></div><script>
              fetch('/api//v3/customer/loadSummaries');
              document.querySelector('input').addEventListener('keyup',async event=>{const query=event.target.value;await fetch('/api//v3/customer/loadSummaries?searchQuery='+query);if(query==='69451086')document.querySelector('#results').innerHTML='<a href="/shipments/69451086">69451086</a>';});
            </script>`;

              if (url.pathname === '/shipments/69451086')
                html = `<script>Promise.all([fetch('/api/v1//loads/69451086'),fetch('/api/v1//loads/69451086/tracking')]).then(()=>{document.body.innerHTML='<load-schedule-summary>Picked Up Thu Oct 8</load-schedule-summary><div id="location-track-and-trace-div"><div id="show-hide-panel-toggle"><p class="panel-header-text">Conflicting browser status</p><p class="panel-header-text">Oct 13</p><p class="panel-header-text">Conflicting browser detail</p></div></div>';});</script>`;

              await route.fulfill({ contentType: 'text/html', body: html });
            });
          });

          return context;
        };

        return browser;
      },
    );

    const session = await adapter.openSession({
      signal,
      rateLimitPerMinute: null,
      fetchMode: 'browser',
    });

    return { session, calls, http };
  }

  it('uses navigation-observed API data when the rendered panel conflicts', async () => {
    const f = await fixture();

    expect(await f.session.read('69451086', signal)).toMatchObject({
      outcome: 'found',
      snapshot: {
        carrierStatus: 'Shipment enroute',
        pickedUpOn: '2026-10-08',
        estimatedDeliveryOn: '2026-10-15',
      },
      sourceData: {
        trackingEvent: {
          id: '69451086',
          typeName: 'Shipment enroute',
          notes: 'Arrived at terminal',
        },
      },
    });
    expect(f.http).not.toHaveBeenCalled();
    expect(f.calls[0]).toBe('/login');

    await f.session.close();

    expect(browser.isConnected()).toBe(false);
  });

  it.each([{ missing: true }, { missing: true, partial: true }])(
    'distinguishes confirmed absence from an incomplete search: %j',
    async (options) => {
      const f = await fixture(options);

      expect(await f.session.read('69451086', signal)).toMatchObject({
        outcome: options.partial ? 'failed' : 'not_found',
        sourceData: null,
      });
    },
  );

  it('does not re-login or make further portal reads after authentication rejection', async () => {
    const f = await fixture({ unauthorized: true });

    expect(await f.session.read('69451086', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'ECHOSHIP_AUTHENTICATION_FAILED',
    });

    const count = f.calls.length;

    expect(await f.session.read('69372728', signal)).toMatchObject({
      outcome: 'failed',
      reasonCode: 'ECHOSHIP_AUTHENTICATION_FAILED',
    });
    expect(f.calls).toHaveLength(count);
  });

  it('closes Chromium when a lookup is cancelled', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const reading = f.session.read('69451086', controller.signal);

    controller.abort();
    await expect(reading).rejects.toBeDefined();
    await f.session.close();

    expect(browser.isConnected()).toBe(false);
  });
});
