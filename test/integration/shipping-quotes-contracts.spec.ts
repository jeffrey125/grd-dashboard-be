import { chromium, type Browser, type Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractFixtures } from '../fixtures/shipping-quotes/contracts.js';
import {
  runWithInteractiveVerification,
  summarizeQuote,
} from '../support/shipping-quotes/live-session.js';
import {
  AmazonContractHarness,
  UnishippersContractHarness,
} from '../support/shipping-quotes/playwright-harness.js';
import {
  ProviderAuthenticationChallenge,
  ProviderAuthenticationExpired,
  type ProviderCode,
  type QuoteInput,
} from '../support/shipping-quotes/provider-contracts.js';

type RequestCapture = {
  path: string;
  headerNames: string[];
  body: string;
};

type MockState = {
  provider: ProviderCode;
  origin: string;
  expireNext: boolean;
  challenge: boolean;
  sessionValid: boolean;
  alwaysExpire: boolean;
  checkStatus: number | undefined;
  loginCount: number;
  events: string[];
  calls: RequestCapture[];
  mutationPaths: string[];
};

const credentials = {
  email: 'fixture@example.test',
  password: 'fixture-password',
};

const domesticInput: QuoteInput = {
  originZip: '53125',
  destinationZip: '10118',
  length: 10,
  width: 8,
  height: 6,
  weight: 5,
  quantity: 1,
  country: 'US',
};

const canadaInput: QuoteInput = {
  ...domesticInput,
  destinationZip: 'H2Y 1C6',
  quantity: 1,
  country: 'CA',
};

function html(body: string) {
  return { status: 200, contentType: 'text/html', body };
}

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function amazonLoginPage(challenge: boolean) {
  return html(`<!doctype html>
    <form>
      <label>Email<input id="ap_email" type="email"></label>
      <button id="continue" type="button">Continue</button>
      <div id="password-panel" hidden>
        <label>Password<input id="ap_password" type="password"></label>
        <button id="sign-in" type="button">Sign in</button>
      </div>
    </form>
    <script>
      document.querySelector('#continue').onclick = () => {
        document.querySelector('#password-panel').hidden = false;
      };
      document.querySelector('#sign-in').onclick = async () => {
        document.cookie = 'fixture-session=amazon; Path=/';
        if (!${challenge}) await fetch('/fixture/sign-in', {method: 'POST'});
        location.href = '${challenge ? '/ap/cvf/request' : '/getstarted/progress?show=rates'}';
      };
    </script>`);
}

function amazonChallengePage() {
  return html(`<!doctype html>
    <title>Authentication required</title>
    <h1>Authentication required</h1>`);
}

function amazonQuotePage() {
  return html(`<!doctype html>
    <main>
      <input type="hidden" name="username" value="fixture-account">
      <button id="view" type="button">View</button>
      <button id="calculate" type="button" hidden>Calculate rates</button>
      <section role="dialog" id="calculator" hidden>
        <label>Origin postal code<input id="origin"></label>
        <label>Destination postal code<input id="destination"></label>
        <label>Length<input id="length"></label>
        <label>Width<input id="width"></label>
        <label>Height<input id="height"></label>
        <label>Weight<input id="weight"></label>
        <button id="estimate" type="button">Estimate rate</button>
      </section>
    </main>
    <script>
      let proposal;
      document.querySelector('#view').onclick = async () => {
        const response = await fetch('/hz/getLatestProposalSharedWithShipper', {headers:{'x-xsrf-token':'mock-xsrf-context'}});
        proposal = (await response.json()).rateCardProposal;
        document.querySelector('#view').hidden = true;
        document.querySelector('#calculate').hidden = false;
      };
      document.querySelector('#calculate').onclick = () => {
        document.querySelector('#calculator').hidden = false;
      };
      document.querySelector('#estimate').onclick = async () => {
        await fetch('/shipping-rates/getRates?merchantId='+proposal.merchantId+'&simulatedShipperId='+proposal.simulatedShipperId, {
          method:'POST',headers:{'content-type':'application/json','x-xsrf-token':'mock-xsrf-context'},
          body:JSON.stringify({originZip:document.querySelector('#origin').value,destinationZip:document.querySelector('#destination').value,
            length:Number(document.querySelector('#length').value),width:Number(document.querySelector('#width').value),height:Number(document.querySelector('#height').value),weight:Number(document.querySelector('#weight').value),serviceCode:'swa-us-mfn'})
        });
      };
    </script>`);
}

function unishippersLoginPage(challenge: boolean) {
  return html(`<!doctype html>
    <div role="alert">${challenge ? 'Additional verification required' : ''}</div>
    <div id="email-panel">
      <label>Email<input id="username" name="username" type="email"></label>
      <button id="continue-email" type="button">Continue</button>
    </div>
    <div id="password-panel" hidden>
      <label>Password<input id="password" type="password"></label>
      <button id="sign-in" type="button">Sign in</button>
    </div>
    <script>
      document.querySelector('#continue-email').onclick = () => {
        document.querySelector('#email-panel').hidden = true;
        document.querySelector('#password-panel').hidden = false;
      };
      document.querySelector('#sign-in').onclick = async () => {
        document.cookie = 'fixture-session=unishippers; Path=/';
        await fetch('/fixture/sign-in', {method: 'POST'});
        sessionStorage.setItem('access_token', 'mock-access-context');
        sessionStorage.setItem('session-token', 'mock-session-context');
        location.href = '/ship/small-package';
      };
    </script>`);
}

function unishippersQuotePage() {
  return html(`<!doctype html>
    <main>
      <label>Email<input type="email" id="contact-email" value="fixture-contact@example.test"></label>
      <button type="button" id="quick-quote">QUICK QUOTE</button>
      <input id="shippingDate" value="10/19/2026">
      <section role="dialog" id="quick-dialog" hidden>
        <label>Sender Zip<input id="senderZip"></label>
        <label>Delivery Zip<input id="deliveryZip"></label>
        <label>Length<input id="quick-length"></label>
        <label>Width<input id="quick-width"></label>
        <label>Height<input id="quick-height"></label>
        <label>Weight<input id="quick-weight"></label>
        <button type="button" id="get-quote">GET QUOTE</button>
      </section>
    </main>
    <script>
      const authHeaders = {'content-type':'application/json','authorization':'Bearer mock-access-context','x-session-token':'mock-session-context'};
      const profile = fetch('/svc/getUserProfileFlow', {method:'POST',headers:{authorization:authHeaders.authorization,'content-type':'application/json'},body:'{}'}).then(r=>r.json());
      profile.then(()=>fetch('/svc/getNotificationCountFlow',{method:'POST',headers:authHeaders,body:'{}'}));
      document.querySelector('#quick-quote').onclick = () => {
        document.querySelector('#quick-dialog').hidden = false;
      };
      document.querySelector('#get-quote').onclick = async () => {
        const account = await profile;
        const value = id => document.getElementById(id).value;
        await fetch('/svc/shopFlow', {
          method:'POST', headers:authHeaders,
          body:JSON.stringify({request:{productType:'SMALLPACK',mode:'ESTIMATE',shipment:{
            originAddress:{address:{postalCode:value('senderZip'),countryCode:'US'}},
            destinationAddress:{address:{postalCode:value('deliveryZip'),countryCode:'US'}},
            handlingUnitList:[{packagingType:'02',packagingTypeName:'Custom',
              billedDimension:{length:{value:value('quick-length'),unit:'in'},width:{value:value('quick-width'),unit:'in'},height:{value:value('quick-height'),unit:'in'},dimensionType:'NET'},
              weight:{value:value('quick-weight'),unit:'LB'}
            }]
          }},orgInfo:{namespace:account.response.orgUnit.namespace}})
        });
      };
    </script>`);
}

async function handleMockRoute(route: Route, state: MockState): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());

  if (url.origin !== state.origin) {
    await route.abort();
    return;
  }

  const body = request.postData() ?? '';
  const headerNames = Object.keys(request.headers()).map((name) =>
    name.toLowerCase(),
  );

  if (url.pathname === '/fixture/sign-in') {
    state.sessionValid = true;
    state.loginCount += 1;
    state.events.push('login');
    await route.fulfill({ status: 204 });
    return;
  }

  if (
    state.checkStatus !== undefined &&
    (url.pathname === '/getstarted/progress' ||
      url.pathname === '/ship/small-package')
  ) {
    const status = state.checkStatus;
    state.checkStatus = undefined;
    state.events.push('check');
    await route.fulfill(json(status, { code: 'FIXTURE_SESSION_CHECK' }));
    return;
  }

  if (url.pathname === '/hz/getLatestProposalSharedWithShipper') {
    await route.fulfill(
      json(200, {
        rateCardProposal: {
          merchantId: 'merchant-from-bootstrap',
          simulatedShipperId: 'proposal-from-bootstrap',
        },
      }),
    );
    return;
  }
  if (url.pathname === '/svc/getNotificationCountFlow') {
    await route.fulfill(
      json(200, { clientStatus: { success: true }, response: { count: 0 } }),
    );
    return;
  }

  if (state.provider === 'amazon') {
    if (url.pathname === '/ap/signin') {
      state.events.push('login-page');
      await route.fulfill(amazonLoginPage(state.challenge));
      return;
    }

    if (url.pathname === '/ap/cvf/request') {
      await route.fulfill(amazonChallengePage());
      return;
    }

    if (url.pathname === '/getstarted/progress') {
      state.events.push('check');
      if (
        state.sessionValid &&
        request.headers().cookie?.includes('fixture-session=amazon')
      )
        await route.fulfill(amazonQuotePage());
      else {
        state.events.push('login-page');
        await route.fulfill(amazonLoginPage(state.challenge));
      }
      return;
    }

    if (url.pathname === '/shipping-rates/getRates') {
      state.events.push('action');
      state.calls.push({ path: url.pathname, headerNames, body });
      if (state.expireNext || state.alwaysExpire || !state.sessionValid) {
        state.expireNext = false;
        state.sessionValid = false;
        await route.fulfill(json(401, { code: 'AUTHENTICATION_EXPIRED' }));
        return;
      }

      const payload = JSON.parse(body) as { destinationZip?: string };
      if (!payload.destinationZip)
        await route.fulfill(
          json(400, { code: 'INVALID_DESTINATION_POSTAL_CODE' }),
        );
      else if (!/^\d{5}$/.test(payload.destinationZip))
        await route.fulfill(json(422, { code: 'UNSUPPORTED_ROUTE' }));
      else
        await route.fulfill(
          json(200, {
            totalCharge: { unit: 'USD', value: 13.81 },
            shippingCharges: [
              { chargeCode: 'BASE_CHARGE', value: 7.83 },
              { chargeCode: 'DELIVERY_AREA_SURCHARGE', value: 3.56 },
              { chargeCode: 'FUEL_SURCHARGE', value: 2.42 },
            ],
          }),
        );
      return;
    }
  }

  if (url.pathname === '/svc/getUserProfileFlow') {
    await route.fulfill(
      json(state.sessionValid ? 200 : 401, {
        clientStatus: { success: state.sessionValid },
        response: { orgUnit: { namespace: 'namespace-from-bootstrap' } },
      }),
    );
    return;
  }

  if (state.provider === 'unishippers') {
    if (url.pathname === '/ship/small-package') {
      state.events.push('check');
      if (
        state.sessionValid &&
        request.headers().cookie?.includes('fixture-session=unishippers')
      )
        await route.fulfill(unishippersQuotePage());
      else {
        state.events.push('login-page');
        await route.fulfill(unishippersLoginPage(state.challenge));
      }
      return;
    }

    if (url.pathname === '/svc/shopFlow') {
      state.events.push('action');
      state.calls.push({ path: url.pathname, headerNames, body });
      if (state.expireNext || state.alwaysExpire || !state.sessionValid) {
        state.expireNext = false;
        state.sessionValid = false;
        await route.fulfill(json(401, { code: 'AUTHENTICATION_EXPIRED' }));
        return;
      }

      const payload = JSON.parse(body) as {
        request?: {
          mode?: string;
          shipment?: {
            originAddress?: { address?: { postalCode?: string } };
            destinationAddress?: { address?: { countryCode?: string } };
            handlingUnitList?: Array<{
              packagingType?: string;
              billedDimension?: unknown;
              weight?: unknown;
            }>;
          };
        };
        orgInfo?: { namespace?: string };
      };
      const shipment = payload.request?.shipment;
      if (shipment?.originAddress?.address?.postalCode === 'INVALID')
        await route.fulfill(
          json(422, {
            clientStatus: {
              fieldMap: { 'AddressV3.Company Name': ['ERR_TOO_LONG'] },
            },
          }),
        );
      else if (shipment?.destinationAddress?.address?.countryCode === 'CA')
        await route.fulfill(json(422, { code: 'UNSUPPORTED_ROUTE' }));
      else if (
        payload.request?.mode !== 'ESTIMATE' ||
        payload.orgInfo?.namespace !== 'namespace-from-bootstrap' ||
        !shipment?.handlingUnitList?.every(
          (unit) =>
            unit.billedDimension && unit.weight && unit.packagingType === '02',
        )
      )
        await route.fulfill(
          json(400, { code: 'INVALID_NATIVE_QUOTE_CONTRACT' }),
        );
      else
        await route.fulfill(
          json(200, {
            clientStatus: { success: true },
            response: {
              offerList: [
                {
                  totalOfferPrice: {
                    value:
                      shipment.handlingUnitList.length === 2 ? 24.16 : 12.08,
                    unit: 'USD',
                  },
                  primaryVendor: { scac: 'UPS' },
                  offeredProductList: shipment.handlingUnitList.map(() => ({
                    shopRQShipment: {
                      timeInTransit: {
                        serviceDescription: 'UPS Ground',
                        transitDays: 2,
                      },
                      handlingUnitList: [{ quantity: 1 }],
                    },
                  })),
                  expirationDate: '2026-10-24 00:00:00',
                },
              ],
            },
          }),
        );
      return;
    }
  }

  if (url.pathname.includes('save') || url.pathname.includes('address'))
    state.mutationPaths.push(url.pathname);

  await route.abort();
}

async function createFixture(
  browser: Browser,
  provider: ProviderCode,
  options: {
    expireNext?: boolean;
    challenge?: boolean;
    authenticated?: boolean;
    checkStatus?: number;
    alwaysExpire?: boolean;
    origin?: string;
  } = {},
) {
  const origin =
    options.origin ??
    (provider === 'amazon'
      ? 'https://amazon.test'
      : 'https://unishippers.test');
  const state: MockState = {
    provider,
    origin,
    expireNext: options.expireNext ?? false,
    challenge: options.challenge ?? false,
    sessionValid: options.authenticated ?? false,
    alwaysExpire: options.alwaysExpire ?? false,
    checkStatus: options.checkStatus,
    loginCount: 0,
    events: [],
    calls: [],
    mutationPaths: [],
  };
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => handleMockRoute(route, state));
  if (options.authenticated) {
    await context.addCookies([
      {
        name: 'fixture-session',
        value: provider,
        url: origin,
      },
    ]);
  }
  const page = await context.newPage();
  const harness =
    provider === 'amazon'
      ? new AmazonContractHarness(origin)
      : new UnishippersContractHarness(origin);

  return { context, page, harness, state };
}

describe('SQ-V1-001 provider contract fixtures', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('covers every sanitized scenario for both providers', () => {
    expect(contractFixtures).toHaveLength(10);
    for (const provider of ['amazon', 'unishippers'] as const) {
      expect(
        new Set(
          contractFixtures
            .filter((fixture) => fixture.provider === provider)
            .map((fixture) => fixture.scenario),
        ),
      ).toEqual(
        new Set([
          'domestic-success',
          'validation-error',
          'authentication-expiry',
          'unsupported-route',
        ]),
      );
    }

    expect(JSON.stringify(contractFixtures)).not.toMatch(
      /fixture-(?:access|session)-token|fixture-password/i,
    );
  });

  it.each([
    ['amazon', new AmazonContractHarness('https://amazon.test')],
    ['unishippers', new UnishippersContractHarness('https://unishippers.test')],
  ] as const)(
    '%s logs in and reaches browser mode with semantic locators',
    async (_provider, harness) => {
      const fixture = await createFixture(browser, harness.provider);
      try {
        const diagnostics = await harness.login(fixture.page, credentials);
        const result = await harness.browserQuote(
          fixture.page,
          domesticInput,
          credentials,
        );

        expect(diagnostics).toMatchObject({
          provider: harness.provider,
          challengeDetected: false,
          finalPath:
            harness.provider === 'amazon'
              ? '/getstarted/progress'
              : '/ship/small-package',
        });
        expect(result.status).toBe(200);
        expect(result.identifiers).toEqual(
          harness.provider === 'amazon'
            ? {
                merchantId: 'merchant-from-bootstrap',
                proposalId: 'proposal-from-bootstrap',
              }
            : {
                namespace: 'namespace-from-bootstrap',
              },
        );
        expect(fixture.state.calls).toHaveLength(1);
        expect(fixture.state.mutationPaths).toEqual([]);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it('fails fast when the Unishippers landing page never renders authentication controls', async () => {
    const origin = 'https://unishippers-no-login.test';
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname === '/ship/small-package') {
        await route.fulfill(
          html('<!doctype html><title>myUnishippers</title><main></main>'),
        );
        return;
      }
      await route.abort();
    });
    const page = await context.newPage();
    const harness = new UnishippersContractHarness(origin);

    try {
      await expect(harness.login(page, credentials)).rejects.toMatchObject({
        name: 'ProviderContractBlocker',
        provider: 'unishippers',
        message: expect.stringContaining(
          'neither a login form nor authenticated account context',
        ),
      });
      expect(await page.url()).toBe(`${origin}/ship/small-package`);
    } finally {
      await context.close();
    }
  });

  it.each([
    ['amazon', new AmazonContractHarness('https://amazon.test')],
    ['unishippers', new UnishippersContractHarness('https://unishippers.test')],
  ] as const)(
    '%s performs request mode inside the authenticated page',
    async (_provider, harness) => {
      const fixture = await createFixture(browser, harness.provider);
      try {
        await harness.login(fixture.page, credentials);
        const result = await harness.requestQuote(
          fixture.page,
          domesticInput,
          credentials,
        );

        expect(result.status).toBe(200);
        expect(fixture.state.calls[0]?.headerNames).toContain('cookie');
        expect(fixture.state.calls[0]?.headerNames).not.toContain(
          'x-codex-secret',
        );
        expect(fixture.state.calls[0]?.body).not.toContain('fixture-password');
        expect(fixture.state.calls[0]?.body).not.toContain(
          'mock-access-context',
        );
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each([
    ['amazon', new AmazonContractHarness('https://amazon.test')],
    ['unishippers', new UnishippersContractHarness('https://unishippers.test')],
  ] as const)(
    '%s relogs in once after authentication expiry',
    async (_provider, harness) => {
      const fixture = await createFixture(browser, harness.provider, {
        expireNext: true,
      });
      try {
        await harness.login(fixture.page, credentials);
        const result = await harness.requestQuote(
          fixture.page,
          domesticInput,
          credentials,
        );

        expect(result.status).toBe(200);
        expect(fixture.state.calls).toHaveLength(2);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each([
    ['amazon', new AmazonContractHarness('https://amazon.test')],
    ['unishippers', new UnishippersContractHarness('https://unishippers.test')],
  ] as const)(
    '%s detects an authentication challenge without logging credentials',
    async (_provider, harness) => {
      const fixture = await createFixture(browser, harness.provider, {
        challenge: true,
      });
      try {
        await expect(
          harness.login(fixture.page, credentials),
        ).rejects.toBeInstanceOf(ProviderAuthenticationChallenge);
      } finally {
        await fixture.context.close();
      }
    },
  );

  const actionCases = (['amazon', 'unishippers'] as const).flatMap((provider) =>
    (['requestQuote', 'browserQuote'] as const).map((mode) => ({
      provider,
      mode,
    })),
  );

  it.each(actionCases)(
    '$provider $mode reuses a valid session without login',
    async ({ provider, mode }) => {
      const fixture = await createFixture(browser, provider, {
        authenticated: true,
      });
      try {
        const result = await fixture.harness[mode](
          fixture.page,
          domesticInput,
          credentials,
        );
        expect(result.status).toBe(200);
        expect(fixture.state.loginCount).toBe(0);
        expect(fixture.state.events[0]).toBe('check');
        expect(fixture.state.events.at(-1)).toBe('action');
        expect(fixture.state.calls).toHaveLength(1);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each(actionCases)(
    '$provider $mode authenticates before the first action',
    async ({ provider, mode }) => {
      const fixture = await createFixture(browser, provider);
      try {
        const result = await fixture.harness[mode](
          fixture.page,
          domesticInput,
          credentials,
        );
        expect(result.status).toBe(200);
        expect(fixture.state.loginCount).toBe(1);
        expect(
          fixture.state.events.filter((event) => event === 'login-page'),
        ).toHaveLength(1);
        expect(fixture.state.events.indexOf('check')).toBeLessThan(
          fixture.state.events.indexOf('login'),
        );
        expect(fixture.state.events.indexOf('login')).toBeLessThan(
          fixture.state.events.indexOf('action'),
        );
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each(actionCases)(
    '$provider $mode checks again and reauthenticates a revoked session',
    async ({ provider, mode }) => {
      const fixture = await createFixture(browser, provider, {
        authenticated: true,
      });
      try {
        await fixture.harness[mode](fixture.page, domesticInput, credentials);
        // A cached page and cookie remain, but the provider has revoked the session.
        fixture.state.sessionValid = false;
        fixture.state.events.length = 0;
        const result = await fixture.harness[mode](
          fixture.page,
          domesticInput,
          credentials,
        );
        expect(result.status).toBe(200);
        expect(fixture.state.loginCount).toBe(1);
        expect(fixture.state.events[0]).toBe('check');
        expect(fixture.state.events.indexOf('login')).toBeLessThan(
          fixture.state.events.indexOf('action'),
        );
        expect(fixture.state.calls).toHaveLength(2);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each(actionCases)(
    '$provider $mode stops after one relogin if authentication expires again',
    async ({ provider, mode }) => {
      const fixture = await createFixture(browser, provider, {
        authenticated: true,
        alwaysExpire: true,
      });
      try {
        await expect(
          fixture.harness[mode](fixture.page, domesticInput, credentials),
        ).rejects.toBeInstanceOf(ProviderAuthenticationExpired);
        expect(fixture.state.loginCount).toBe(1);
        expect(fixture.state.calls).toHaveLength(2);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each(actionCases)(
    '$provider $mode blocks the action when authentication requires verification',
    async ({ provider, mode }) => {
      const fixture = await createFixture(browser, provider, {
        challenge: true,
      });
      try {
        await expect(
          fixture.harness[mode](fixture.page, domesticInput, credentials),
        ).rejects.toBeInstanceOf(ProviderAuthenticationChallenge);
        expect(fixture.state.calls).toHaveLength(0);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each(
    actionCases.flatMap((entry) =>
      [401, 403].map((status) => ({ ...entry, status })),
    ),
  )(
    '$provider $mode authenticates before acting when the session check returns $status',
    async ({ provider, mode, status }) => {
      const fixture = await createFixture(browser, provider, {
        checkStatus: status,
      });
      try {
        const result = await fixture.harness[mode](
          fixture.page,
          domesticInput,
          credentials,
        );
        expect(result.status).toBe(200);
        expect(fixture.state.loginCount).toBe(1);
        expect(fixture.state.events.indexOf('login')).toBeLessThan(
          fixture.state.events.indexOf('action'),
        );
        expect(fixture.state.calls).toHaveLength(1);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it.each(actionCases)(
    '$provider $mode stops without submitting credentials or actions when the session check is unavailable',
    async ({ provider, mode }) => {
      const fixture = await createFixture(browser, provider, {
        checkStatus: 503,
      });
      try {
        await expect(
          fixture.harness[mode](fixture.page, domesticInput, credentials),
        ).rejects.toMatchObject({ name: 'ProviderContractBlocker' });
        expect(fixture.state.loginCount).toBe(0);
        expect(fixture.state.calls).toHaveLength(0);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it('submits explicit native units and keeps the provider whole-shipment total', async () => {
    const fixture = await createFixture(browser, 'unishippers', {
      authenticated: true,
    });
    try {
      const result = await fixture.harness.requestQuote(
        fixture.page,
        { ...domesticInput, quantity: 2 },
        credentials,
      );
      const payload = JSON.parse(fixture.state.calls[0]!.body);
      expect(payload.request.mode).toBe('ESTIMATE');
      expect(payload.orgInfo).toEqual({
        namespace: 'namespace-from-bootstrap',
      });
      expect(payload.request.shipment.handlingUnitList).toHaveLength(2);
      expect(
        payload.request.shipment.handlingUnitList[0].billedDimension.length,
      ).toEqual({ value: '10', unit: 'in' });
      expect(payload.request.shipment.handlingUnitList[0].weight).toEqual({
        value: '5',
        unit: 'LB',
      });
      expect(fixture.state.calls[0]!.body).not.toContain('companyName');
      expect(fixture.state.calls[0]!.headerNames).toEqual(
        expect.arrayContaining(['authorization', 'x-session-token']),
      );
      const summary = summarizeQuote('unishippers', result);
      expect(summary.services).toMatchObject([
        {
          carrier: 'UPS',
          service: 'UPS Ground',
          total: { value: 24.16, unit: 'USD' },
          packageCount: 2,
        },
      ]);
      expect(JSON.stringify(summary)).not.toContain('namespace-from-bootstrap');
      expect(JSON.stringify(summary)).not.toContain('mock-session-context');
      const invalidBody = {
        ...(result.body as object),
        clientStatus: { success: false },
      };
      expect(
        summarizeQuote('unishippers', { ...result, body: invalidBody })
          .serviceCount,
      ).toBe(0);
      expect(fixture.state.mutationPaths).toEqual([]);
    } finally {
      await fixture.context.close();
    }
  });

  it('projects only allowlisted quote fields from provider responses', () => {
    const result = {
      status: 200,
      endpointPath: '/svc/shopFlow',
      requestHeaderNames: ['authorization'],
      identifiers: { namespace: 'private-fixture-namespace' },
      body: {
        clientStatus: { success: true },
        response: {
          contact: { email: 'private-contact@example.test' },
          offerList: [
            {
              totalOfferPrice: { value: 24.16, unit: 'USD' },
              primaryVendor: {
                scac: 'UPS',
                contact: 'private-fixture-contact',
              },
              offeredProductList: [
                {
                  shopRQShipment: {
                    timeInTransit: { serviceDescription: 'UPS Ground' },
                    handlingUnitList: [{ quantity: 2 }],
                    originAddress: { accountId: 'private-fixture-account' },
                  },
                },
              ],
            },
          ],
        },
      },
    };
    const summary = summarizeQuote('unishippers', result);
    expect(summary.services[0]).toMatchObject({
      carrier: 'UPS',
      service: 'UPS Ground',
      packageCount: 2,
      total: { value: 24.16, unit: 'USD' },
    });
    expect(JSON.stringify(summary)).not.toContain('private-');
    const amazonSummary = summarizeQuote('amazon', {
      ...result,
      body: {
        totalCharge: { value: 13.81, unit: 'USD' },
        account: 'private-fixture-account',
        contact: 'private-fixture-contact',
      },
    });
    expect(amazonSummary.total).toEqual({ value: 13.81, unit: 'USD' });
    expect(JSON.stringify(amazonSummary)).not.toContain('private-');
  });

  it('rejects multiple packages in the single-package Quick Quote browser dialog without fallback', async () => {
    const fixture = await createFixture(browser, 'unishippers', {
      authenticated: true,
    });
    try {
      await expect(
        fixture.harness.browserQuote(
          fixture.page,
          { ...domesticInput, quantity: 2 },
          credentials,
        ),
      ).rejects.toMatchObject({ name: 'ProviderContractBlocker' });
      expect(fixture.state.calls).toHaveLength(0);
    } finally {
      await fixture.context.close();
    }
  });

  it.each(['amazon', 'unishippers'] as const)(
    '%s does not guess missing bootstrap context',
    async (provider) => {
      const fixture = await createFixture(browser, provider, {
        authenticated: true,
      });
      const path =
        provider === 'amazon'
          ? '/hz/getLatestProposalSharedWithShipper'
          : '/svc/getUserProfileFlow';
      await fixture.context.route(`**${path}`, (route) =>
        route.fulfill(
          json(200, {
            clientStatus: { success: true },
            response: { orgUnit: {} },
            rateCardProposal: {},
          }),
        ),
      );
      try {
        await expect(
          fixture.harness.requestQuote(
            fixture.page,
            domesticInput,
            credentials,
          ),
        ).rejects.toMatchObject({ name: 'ProviderContractBlocker' });
        expect(fixture.state.calls).toHaveLength(0);
        expect(fixture.state.loginCount).toBe(0);
      } finally {
        await fixture.context.close();
      }
    },
  );

  it('resumes a verified Amazon session in the same page without submitting credentials again', async () => {
    const fixture = await createFixture(browser, 'amazon', {
      challenge: true,
      origin: 'https://ship.amazon.com',
    });
    let verificationRequests = 0;
    let navigation = Promise.resolve();
    try {
      const originalContext = fixture.page.context();
      const result = await runWithInteractiveVerification(
        fixture.page,
        'amazon',
        () =>
          fixture.harness.requestQuote(
            fixture.page,
            domesticInput,
            credentials,
          ),
        {
          timeoutMs: 2_000,
          onRequired: () => {
            verificationRequests += 1;
            // Only the fixture simulates the user completing verification.
            fixture.state.sessionValid = true;
            fixture.state.challenge = false;
            navigation = fixture.page
              .goto(`${fixture.state.origin}/getstarted/progress?show=rates`)
              .then(() => undefined);
          },
        },
      );
      await navigation;
      expect(result.status).toBe(200);
      expect(verificationRequests).toBe(1);
      expect(fixture.page.context()).toBe(originalContext);
      expect(fixture.state.loginCount).toBe(0);
      expect(fixture.state.calls).toHaveLength(1);
    } finally {
      await fixture.context.close();
    }
  });

  it('times out manual verification without running a quote action', async () => {
    const fixture = await createFixture(browser, 'amazon');
    try {
      await expect(
        runWithInteractiveVerification(
          fixture.page,
          'amazon',
          async () => {
            throw new ProviderAuthenticationChallenge('amazon');
          },
          { timeoutMs: 20, onRequired: () => undefined },
        ),
      ).rejects.toMatchObject({ name: 'ProviderContractBlocker' });
      expect(fixture.state.calls).toHaveLength(0);
    } finally {
      await fixture.context.close();
    }
  });

  it('classifies validation and unsupported route responses without mode fallback', async () => {
    const amazon = await createFixture(browser, 'amazon');
    const unishippers = await createFixture(browser, 'unishippers');
    try {
      await amazon.harness.login(amazon.page, credentials);
      await unishippers.harness.login(unishippers.page, credentials);

      expect(
        (
          await amazon.harness.requestQuote(
            amazon.page,
            {
              ...domesticInput,
              destinationZip: '',
            },
            credentials,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await amazon.harness.requestQuote(
            amazon.page,
            canadaInput,
            credentials,
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await unishippers.harness.requestQuote(
            unishippers.page,
            {
              ...domesticInput,
              originZip: 'INVALID',
            },
            credentials,
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await unishippers.harness.requestQuote(
            unishippers.page,
            canadaInput,
            credentials,
          )
        ).status,
      ).toBe(422);
      expect(amazon.state.calls).toHaveLength(2);
      expect(unishippers.state.calls).toHaveLength(2);
      expect(amazon.state.mutationPaths).toEqual([]);
      expect(unishippers.state.mutationPaths).toEqual([]);
    } finally {
      await Promise.all([amazon.context.close(), unishippers.context.close()]);
    }
  });
});
