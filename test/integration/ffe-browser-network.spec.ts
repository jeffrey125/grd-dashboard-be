import { createServer, type Server, type RequestListener } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FfeBrowserNetwork } from '@modules/carriers/adapters/ffe/ffe.browser-network.js';
import { CarrierRequestLimiter } from '@modules/carriers/adapters/carrier-request-limiter.js';

describe('FFE Chromium network enforcement on real sockets', () => {
  let browser: Browser;
  let network: FfeBrowserNetwork;
  let limiter: CarrierRequestLimiter;
  const servers: Server[] = [];

  afterEach(async () => {
    network?.close();
    await browser?.close();
    await limiter?.close();

    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function listen(handler: RequestListener) {
    const server = createServer(handler);

    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function setup(origin: string, rpm: number | null = null) {
    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage();

    limiter = new CarrierRequestLimiter();
    network = new FfeBrowserNetwork(
      {
        settings: {
          origin,
          username: 'fixture',
          password: 'PRIVATE',
          executablePath: undefined,
        },
        limiter,
        rpm,
        signal: new AbortController().signal,
      },
      () => {
        void browser.close();
      },
    );
    await network.attach(page, new AbortController().signal);

    return page;
  }

  it.each([307, 308])(
    'blocks credential-bearing off-origin redirect %i before the destination receives it',
    async (status) => {
      let received = 0;
      const external = await listen((_req, res) => {
        received++;
        res.end('unexpected');
      });
      const origin = await listen((req, res) => {
        if (req.method === 'POST') {
          res.writeHead(status, { location: external + '/capture' });
          res.end();
        } else {
          res.setHeader('content-type', 'text/html');
          res.end(
            '<form action="/Account/Login" method="post"><input name="Password" value="PRIVATE"><button>Login</button></form>',
          );
        }
      });
      const page = await setup(origin);

      await page.goto(origin + '/Account/Login');
      await page
        .getByRole('button')
        .click()
        .catch(() => undefined);
      await expect
        .poll(() => network.failure?.code)
        .toBe('FFE_UNTRUSTED_REDIRECT');

      expect(received).toBe(0);
    },
  );
  it('paces both physical requests in an allowed same-origin login redirect', async () => {
    const origin = await listen((req, res) => {
      if (req.url === '/Account/Login')
        res.writeHead(302, { location: '/Customer' });

      res.end('OK');
    });
    const page = await setup(origin);
    const pace = vi.spyOn(limiter, 'run');

    await page.goto(origin + '/Account/Login');

    expect(pace).toHaveBeenCalledTimes(2);
    expect(network.failure).toBeUndefined();
  });
  it('blocks optional third-party fetch without closing the tracking browser', async () => {
    let received = 0;
    const external = await listen((_req, res) => {
      received++;
      res.end('unexpected');
    });
    const origin = await listen((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        `<script>fetch('${external}/telemetry').catch(()=>document.title='blocked')</script>`,
      );
    });
    const page = await setup(origin);

    await page.goto(origin);
    await expect.poll(() => page.title()).toBe('blocked');

    expect(received).toBe(0);
    expect(network.failure).toBeUndefined();
    expect(browser.isConnected()).toBe(true);
  });
  it('uses one 30-second deadline across delayed headers and a streaming body', async () => {
    const origin = await listen((_req, res) => {
      const delayed = setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('<html>');
      }, 15000);
      const stream = setInterval(() => {
        if (res.headersSent) res.write(' ');
      }, 1000);

      res.on('close', () => {
        clearTimeout(delayed);
        clearInterval(stream);
      });
    });
    const page = await setup(origin);
    const started = Date.now();

    await page
      .goto(origin + '/Customer/ShipmentTracking', { timeout: 40000 })
      .catch(() => undefined);

    expect(network.failure?.code).toBe('FFE_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(35000);

    await expect.poll(() => browser.isConnected()).toBe(false);
  }, 40000);
  it('excludes real one-RPM redirect queue time from browser and physical deadlines', async () => {
    const origin = await listen((req, res) => {
      if (req.url === '/Account/Login')
        res.writeHead(302, { location: '/Customer' });

      res.end('OK');
    });
    const page = await setup(origin, 1);
    const started = Date.now();

    await network.wait(page.goto(origin + '/Account/Login', { timeout: 0 }));

    expect(Date.now() - started).toBeGreaterThanOrEqual(59000);
    expect(network.failure).toBeUndefined();
  }, 75000);
});
