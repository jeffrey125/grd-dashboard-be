import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { expect, it, vi } from 'vitest';
import { EncryptedAmazonSessionStore } from './amazon-session.store.js';
import { AmazonVerificationBrowser } from './amazon-verification.browser.js';
import { AmazonVerificationBridge } from './amazon-verification.bridge.js';

it('lets a human control a challenge, blocks account navigation, then verifies and persists the session without rates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staff-amazon-'));
  const store = new EncryptedAmazonSessionStore(
    directory,
    join(directory, 'key'),
    'fixture@example.test',
  );
  let context: BrowserContext;
  let browser: Browser;
  let solved = false;
  let rateCalls = 0;
  const recovery = new AmazonVerificationBrowser(store, async () => {
    browser = await chromium.launch({ headless: true });
    const create = browser.newContext.bind(browser);
    vi.spyOn(browser, 'newContext').mockImplementation(async (options) => {
      context = await create(options);
      await context.setOffline(true);
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/getstarted/progress') {
          if (!solved) {
            await route.fulfill({
              contentType: 'text/html',
              body: '<script>location.replace("https://www.amazon.com/ap/cvf/request")</script>',
            });
            return;
          }
          await route.fulfill({
            contentType: 'text/html',
            body: '<label>Origin postal<input></label><script>fetch("/hz/getLatestProposalSharedWithShipper",{method:"POST",headers:{"x-xsrf-token":"fixture"}})</script>',
          });
        } else if (url.pathname === '/ap/cvf/request') {
          await route.fulfill({
            contentType: 'text/html',
            body: `<div>PRIVATE ACCOUNT HEADER</div><div id="cvf-page-content" style="width:400px;height:200px"><p>Solve this puzzle</p><input aria-label="Answer"><button onclick="fetch('/ap/cvf/verify',{method:'POST'}).then(()=>location.href='https://ship.amazon.com/getstarted/progress')">Verify</button><a href="https://www.amazon.com/account">Account</a></div>`,
          });
        } else if (url.pathname === '/ap/cvf/verify') {
          solved = true;
          await route.fulfill({
            status: 200,
            headers: {
              'set-cookie':
                'session-id=human-verified; Domain=.amazon.com; Path=/; Secure; HttpOnly',
            },
            body: 'ok',
          });
        } else if (url.pathname === '/hz/getLatestProposalSharedWithShipper') {
          await route.fulfill({
            json: {
              rateCardProposal: {
                merchantId: 'fixture',
                simulatedShipperId: 'fixture',
              },
            },
          });
        } else if (url.pathname === '/shipping-rates/getRates') {
          rateCalls++;
          await route.fulfill({ json: {} });
        } else await route.abort();
      });
      return context;
    });
    return browser;
  });
  try {
    await store.initialize();
    await recovery.start();
    const view = await recovery.view();
    expect(view.verified).toBe(false);
    if (view.verified || 'preparing' in view)
      throw new Error('Expected fixture challenge');
    expect(view.width).toBe(400);
    expect(Buffer.from(view.image, 'base64').subarray(1, 4).toString()).toBe(
      'PNG',
    );
    const repeated = await recovery.view();
    if (repeated.verified || 'preparing' in repeated)
      throw new Error('Expected repeated fixture challenge');
    expect(repeated.frame).toBe(view.frame);
    await expect(
      recovery.act({
        type: 'click',
        x: 0.5,
        y: 0.5,
        frame: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow('stale_frame');
    const page = context!.pages()[0]!;
    const area = (await page.locator('#cvf-page-content').boundingBox())!;
    const anchor = (await page
      .getByRole('link', { name: 'Account' })
      .boundingBox())!;
    await expect(
      recovery.act({
        type: 'click',
        x: (anchor.x + 2 - area.x) / area.width,
        y: (anchor.y + 2 - area.y) / area.height,
        frame: view.frame,
      }),
    ).rejects.toThrow('unsupported');
    const fresh = await recovery.view();
    if (fresh.verified || 'preparing' in fresh)
      throw new Error('Expected challenge');
    const input = (await page.getByRole('textbox').boundingBox())!;
    await recovery.act({
      type: 'click',
      x: (input.x + 3 - area.x) / area.width,
      y: (input.y + 3 - area.y) / area.height,
      frame: fresh.frame,
    });
    const typing = await recovery.view();
    if (typing.verified || 'preparing' in typing)
      throw new Error('Expected challenge');
    await recovery.act({
      type: 'text',
      text: 'fixture answer',
      frame: typing.frame,
    });
    expect(await page.getByRole('textbox').inputValue()).toBe('fixture answer');
    await page.evaluate(() =>
      fetch('/shipping-rates/getRates', { method: 'POST' }).catch(
        () => undefined,
      ),
    );
    expect(rateCalls).toBe(0);
    const submit = await recovery.view();
    if (submit.verified || 'preparing' in submit)
      throw new Error('Expected challenge');
    const button = (await page
      .getByRole('button', { name: 'Verify', exact: true })
      .boundingBox())!;
    await recovery.act({
      type: 'click',
      x: (button.x + 3 - area.x) / area.width,
      y: (button.y + 3 - area.y) / area.height,
      frame: submit.frame,
    });
    await page.waitForURL('https://ship.amazon.com/getstarted/progress');
    expect(await recovery.view()).toEqual({ verified: true });
    await context!.addCookies([
      {
        name: 'captcha-provider',
        value: 'discard',
        domain: '.arkoselabs.com',
        path: '/',
        secure: true,
      },
    ]);
    await recovery.save();
    expect(
      (await store.load())?.cookies.some((cookie) =>
        cookie.domain.endsWith('arkoselabs.com'),
      ),
    ).toBe(false);
    expect(
      (await store.load())?.cookies.some(
        (cookie) => cookie.value === 'human-verified',
      ),
    ).toBe(true);
    expect(rateCalls).toBe(0);
    await recovery.close();
    expect(browser!.isConnected()).toBe(false);
  } finally {
    await recovery.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it('fails closed when a challenge contains password fields or an unrecognized page', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staff-amazon-private-'));
  const store = new EncryptedAmazonSessionStore(
    directory,
    join(directory, 'key'),
    'fixture@example.test',
  );
  const recovery = new AmazonVerificationBrowser(store, async () => {
    const browser = await chromium.launch({ headless: true });
    const create = browser.newContext.bind(browser);
    vi.spyOn(browser, 'newContext').mockImplementation(async (options) => {
      const context = await create(options);
      await context.setOffline(true);
      await context.route('**/*', (route) =>
        new URL(route.request().url()).pathname === '/ap/cvf/request'
          ? route.fulfill({
              contentType: 'text/html',
              body: '<div id="cvf-page-content"><input type="password" value="secret"></div>',
            })
          : route.fulfill({
              contentType: 'text/html',
              body: '<script>location.replace("https://www.amazon.com/ap/cvf/request")</script>',
            }),
      );
      return context;
    });
    return browser;
  });
  try {
    await store.initialize();
    await recovery.start();
    await expect(recovery.view()).rejects.toThrow('unsupported');
    await expect(recovery.save()).rejects.toThrow('expired');
  } finally {
    await recovery.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('transports only validated commands through an owner-only Unix socket and cleans up', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staff-amazon-socket-'));
  const socket = join(directory, 'worker.sock');
  const server = new AmazonVerificationBridge(socket);
  const client = new AmazonVerificationBridge(socket);
  const identity = {
    owner: 'staff:1',
    actorExternalId: '11111111-1111-4111-8111-111111111111',
    comparisonId: '22222222-2222-4222-8222-222222222222',
    attemptId: '33333333-3333-4333-8333-333333333333',
  };
  const handler = vi.fn(async () => ({
    id: identity.attemptId,
    state: 'preparing' as const,
    expiresAt: new Date().toISOString(),
  }));
  try {
    await server.listen(handler);
    expect((await stat(socket)).mode & 0o777).toBe(0o600);
    expect(
      await client.send({ ...identity, operation: 'start' }),
    ).toMatchObject({ state: 'preparing' });
    await expect(
      client.send({ ...identity, operation: 'navigate' } as never),
    ).rejects.toThrow('unavailable');
    expect(handler).toHaveBeenCalledTimes(1);
    await server.close();
    await expect(
      client.send({ ...identity, operation: 'start' }),
    ).rejects.toThrow('unavailable');
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
