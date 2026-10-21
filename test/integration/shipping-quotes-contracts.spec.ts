import { chromium, type Browser, type Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractFixtures } from '../fixtures/shipping-quotes/contracts.js';
import { summarizeQuote } from '../support/shipping-quotes/live-session.js';
import { UnishippersContractHarness } from '../support/shipping-quotes/playwright-harness.js';
import type { QuoteInput } from '../support/shipping-quotes/provider-contracts.js';

type RequestCapture = {
  path: string;
  headerNames: string[];
  body: string;
};

type MockState = {
  origin: string;
  expireNext: boolean;
  challenge: boolean;
  sessionValid: boolean;
  alwaysExpire: boolean;
  loginCount: number;
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

function loginPage(challenge: boolean) {
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

function quotePage() {
  return html(`<!doctype html>
    <main>
      <label>Email<input type="email" value="fixture-contact@example.test"></label>
      <button type="button" id="quick-quote">QUICK QUOTE</button>
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
      const profile = fetch('/svc/getUserProfileFlow', {method:'POST',headers:{authorization:authHeaders.authorization,'x-session-token':authHeaders['x-session-token'],'content-type':'application/json'},body:'{}'}).then(r=>r.json());
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
    await route.fulfill({ status: 204 });
    return;
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
  if (url.pathname === '/ship/small-package') {
    if (
      state.sessionValid &&
      request.headers().cookie?.includes('fixture-session=unishippers')
    )
      await route.fulfill(quotePage());
    else await route.fulfill(loginPage(state.challenge));
    return;
  }
  if (url.pathname === '/svc/shopFlow') {
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
      await route.fulfill(json(422, { code: 'INVALID_ORIGIN' }));
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
      await route.fulfill(json(400, { code: 'INVALID_NATIVE_CONTRACT' }));
    else
      await route.fulfill(
        json(200, {
          clientStatus: { success: true },
          response: {
            offerList: [
              {
                totalOfferPrice: {
                  value: shipment.handlingUnitList.length === 2 ? 24.16 : 12.08,
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
  if (url.pathname.includes('save') || url.pathname.includes('address'))
    state.mutationPaths.push(url.pathname);
  await route.abort();
}

async function createFixture(
  browser: Browser,
  options: {
    expireNext?: boolean;
    challenge?: boolean;
    authenticated?: boolean;
    alwaysExpire?: boolean;
  } = {},
) {
  const origin = 'https://unishippers.test';
  const state: MockState = {
    origin,
    expireNext: options.expireNext ?? false,
    challenge: options.challenge ?? false,
    sessionValid: options.authenticated ?? false,
    alwaysExpire: options.alwaysExpire ?? false,
    loginCount: 0,
    calls: [],
    mutationPaths: [],
  };
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => handleMockRoute(route, state));
  if (options.authenticated)
    await context.addCookies([
      { name: 'fixture-session', value: 'unishippers', url: origin },
    ]);
  const page = await context.newPage();
  const harness = new UnishippersContractHarness(origin);
  return { context, page, harness, state };
}

describe('myUnishippers provider contract fixtures', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('keeps every sanitized myUnishippers scenario', () => {
    expect(contractFixtures).toHaveLength(5);
    expect(
      new Set(contractFixtures.map((fixture) => fixture.scenario)),
    ).toEqual(
      new Set([
        'domestic-success',
        'validation-error',
        'authentication-expiry',
        'unsupported-route',
      ]),
    );
    expect(JSON.stringify(contractFixtures)).not.toMatch(
      /fixture-(?:access|session)-token|fixture-password/i,
    );
  });

  it('logs in and reaches browser mode with semantic locators', async () => {
    const fixture = await createFixture(browser);
    try {
      const diagnostics = await fixture.harness.login(
        fixture.page,
        credentials,
      );
      const result = await fixture.harness.browserQuote(
        fixture.page,
        domesticInput,
        credentials,
      );

      expect(diagnostics).toMatchObject({
        provider: 'unishippers',
        challengeDetected: false,
        finalPath: '/ship/small-package',
      });
      expect(result.status).toBe(200);
      expect(result.identifiers).toEqual({
        namespace: 'namespace-from-bootstrap',
      });
      expect(fixture.state.calls).toHaveLength(1);
      expect(fixture.state.mutationPaths).toEqual([]);
    } finally {
      await fixture.context.close();
    }
  });

  it('submits one native handling unit per physical package', async () => {
    const fixture = await createFixture(browser, { authenticated: true });
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
      expect(fixture.state.calls[0]!.headerNames).toEqual(
        expect.arrayContaining(['authorization', 'x-session-token']),
      );
      expect(summarizeQuote('unishippers', result).services).toMatchObject([
        {
          carrier: 'UPS',
          service: 'UPS Ground',
          total: { value: 24.16, unit: 'USD' },
          packageCount: 2,
        },
      ]);
    } finally {
      await fixture.context.close();
    }
  });

  it('relogs once after an expired request and does not loop', async () => {
    const fixture = await createFixture(browser, {
      authenticated: true,
      expireNext: true,
    });
    try {
      const result = await fixture.harness.requestQuote(
        fixture.page,
        domesticInput,
        credentials,
      );

      expect(result.status).toBe(200);
      expect(fixture.state.calls).toHaveLength(2);
      expect(fixture.state.loginCount).toBe(1);
    } finally {
      await fixture.context.close();
    }

    const exhausted = await createFixture(browser, {
      authenticated: true,
      alwaysExpire: true,
    });
    try {
      await expect(
        exhausted.harness.requestQuote(
          exhausted.page,
          domesticInput,
          credentials,
        ),
      ).rejects.toMatchObject({ name: 'ProviderAuthenticationExpired' });
      expect(exhausted.state.calls).toHaveLength(2);
      expect(exhausted.state.loginCount).toBe(1);
    } finally {
      await exhausted.context.close();
    }
  });

  it('fails closed for inputs the selected mode cannot represent', async () => {
    const fixture = await createFixture(browser, { authenticated: true });
    try {
      await expect(
        fixture.harness.browserQuote(
          fixture.page,
          { ...domesticInput, quantity: 2 },
          credentials,
        ),
      ).rejects.toMatchObject({ name: 'ProviderContractBlocker' });
      expect(
        (
          await fixture.harness.requestQuote(
            fixture.page,
            canadaInput,
            credentials,
          )
        ).status,
      ).toBe(422);
      expect(fixture.state.mutationPaths).toEqual([]);
    } finally {
      await fixture.context.close();
    }
  });
});
