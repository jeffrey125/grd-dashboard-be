import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { expect, it, vi } from 'vitest';
import { AmazonShippingAdapter } from './amazon-quote.adapter.js';
import { EncryptedAmazonSessionStore } from './amazon-session.store.js';
import { executeQuote } from './quote-executor.js';
import type { LeasedQuote } from './quote-execution.repository.js';

it('uses an operator-verified encrypted session across fresh Chromium instances and stops on re-verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'amazon-browser-fixture-'));
  const store = new EncryptedAmazonSessionStore(
    directory,
    join(directory, 'key'),
    'fixture@example.test',
  );
  const browsers: Browser[] = [];
  let bootstrapCount = 0;
  let rateCount = 0;
  let challenged = false;
  const origin = 'https://ship.amazon.com';
  const setupRoutes = async (context: BrowserContext) => {
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.href === 'https://www.amazon.com/ap/cvf/request') {
        await route.fulfill({
          contentType: 'text/html',
          body: '<p>Solve this puzzle to protect your account</p>',
        });
      } else if (url.origin !== origin) {
        await route.abort();
      } else if (url.pathname === '/getstarted/progress') {
        expect(request.headers().cookie).toContain(
          'session-id=fixture-session',
        );
        if (challenged) {
          await route.fulfill({
            status: 302,
            headers: { location: 'https://www.amazon.com/ap/cvf/request' },
          });
          return;
        }
        const token = `fixture-token-${++bootstrapCount}`;
        await route.fulfill({
          contentType: 'text/html',
          body: `<label>Origin postal<input /></label><script>fetch('/hz/getLatestProposalSharedWithShipper', {method:'POST',headers:{'x-xsrf-token':'${token}'}})</script>`,
        });
      } else if (url.pathname === '/hz/getLatestProposalSharedWithShipper') {
        await route.fulfill({
          json: {
            rateCardProposal: {
              merchantId: 'fixture-merchant',
              simulatedShipperId: 'fixture-proposal',
            },
          },
        });
      } else if (url.pathname === '/shipping-rates/getRates') {
        expect(request.headers().cookie).toContain(
          'session-id=fixture-session',
        );
        expect(request.headers()['x-xsrf-token']).toBe(
          `fixture-token-${bootstrapCount}`,
        );
        rateCount++;
        await route.fulfill({
          json: {
            totalCharge: { unit: 'USD', value: '13.81' },
            shippingCharges: [
              {
                chargeCode: 'BASE_CHARGE',
                charge: { unit: 'USD', value: '13.81' },
              },
            ],
          },
        });
      } else {
        await route.abort();
      }
    });
  };
  const launch = async () => {
    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const newContext = browser.newContext.bind(browser);
    vi.spyOn(browser, 'newContext').mockImplementation(async (options) => {
      const context = await newContext(options);
      await setupRoutes(context);
      return context;
    });
    return browser;
  };
  const address = {
    name: 'Fixture',
    street: '1 Example St',
    city: 'Walworth',
    division: 'WI',
    postalCode: '53125',
    country: 'US' as const,
  };
  const job: LeasedQuote = {
    id: 'fixture',
    requestId: 'fixture',
    accountId: 1,
    owner: 'fixture',
    code: 'amazon',
    mode: 'request',
    enabled: true,
    reloginCount: 0,
    sender: { code: 'amazon', mode: 'explicit', retrievedAt: null, address },
    input: {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      shipDate: '2099-10-19',
      destination: { ...address, postalCode: '10118' },
      providers: [
        {
          code: 'amazon',
          sender: { mode: 'explicit', address },
          options: { signature: 'none', insurance: null },
        },
      ],
      packageGroups: [
        {
          quantity: 1,
          units: 'imperial',
          length: '10',
          width: '8',
          height: '6',
          weight: '5',
          customsItems: [],
        },
      ],
    },
  };

  try {
    await store.initialize();
    const operator = await launch();
    const context = await operator.newContext();
    await context.addCookies([
      {
        name: 'session-id',
        value: 'fixture-session',
        domain: '.amazon.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
      },
    ]);
    const verifier = new AmazonShippingAdapter({
      context,
      manualAuthentication: true,
    });
    await verifier.verifySession();
    expect(rateCount).toBe(0);
    await store.save(await context.storageState());
    await operator.close();

    const adapter = new AmazonShippingAdapter({ launch, sessionStore: store });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await executeQuote(
        job,
        adapter,
        new AbortController().signal,
        5000,
      );
      expect(result.outcome).toBe('success');
      expect(result.quotes[0]?.total).toBe('13.810000');
    }
    expect(rateCount).toBe(2);
    expect(bootstrapCount).toBe(3);
    await adapter.readiness('request');
    await adapter.close();
    expect(rateCount).toBe(2);
    challenged = true;
    expect(
      await executeQuote(job, adapter, new AbortController().signal, 5000),
    ).toMatchObject({
      outcome: 'failed',
      reason: 'verification_required',
      relogins: 0,
    });
    expect(rateCount).toBe(2);
    await store.revoke();
    expect(
      await executeQuote(job, adapter, new AbortController().signal, 5000),
    ).toMatchObject({ reason: 'verification_required' });
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
