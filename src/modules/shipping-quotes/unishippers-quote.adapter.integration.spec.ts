import { chromium, type Browser, type Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LeasedQuote } from './quote-execution.repository.js';
import type { Address, QuoteInput } from './quote.schemas.js';
import { UnishippersShippingAdapter } from './unishippers-quote.adapter.js';

const origin = 'http://unishippers.fixture';
const address = {
  name: 'Fixture Sender',
  street: '1 Example Street',
  city: 'Walworth',
  division: 'WI',
  postalCode: '53125',
  country: 'US',
} as const satisfies Address;
const destination: Address = {
  ...address,
  name: 'Fixture Receiver',
  city: 'New York',
  division: 'NY',
  postalCode: '10118',
};

type FixtureState = {
  shopRequests: Array<Record<string, unknown>>;
  mutations: string[];
  loadUnsafeWrite?: boolean;
  unsafeWrite?: boolean;
};

function json(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function pageHtml(state: FixtureState): string {
  return `<!doctype html><html><body>
    <button id="quick-quote">Quick Quote</button>
    <section id="quick-quote-modal" hidden>
      <input id="senderZip" />
      <input id="deliveryZip" />
      <input id="quick-quote-length-input" />
      <input id="ups-package-type-width-input" />
      <input id="ups-package-type-height-input" />
      <input id="ups-package-type-weight-input" />
      <button id="quickQuoteButton">GET QUOTE</button>
    </section>
    <script>
      const headers = {'content-type':'application/json','authorization':'fixture-auth','x-session-token':'fixture-token'};
      ${state.loadUnsafeWrite ? "void fetch('/svc/loadWrite', {method:'POST', headers, body:'{}'}).catch(() => {});" : ''}
      document.querySelector('#quick-quote').onclick = () => document.querySelector('#quick-quote-modal').hidden = false;
      document.querySelector('#quickQuoteButton').onclick = async () => {
        const value = selector => document.querySelector(selector).value;
        ${state.unsafeWrite ? "void fetch('/svc/unexpectedWrite', {method:'POST', headers, body:'{}'}).catch(() => {});" : ''}
        await fetch('/svc/shopFlow', {method:'POST', headers, body:JSON.stringify({
          request:{productType:'SMALLPACK',mode:'ESTIMATE',shipment:{
            originAddress:{address:{postalCode:value('#senderZip'),countryCode:'US'}},
            destinationAddress:{address:{postalCode:value('#deliveryZip'),countryCode:'US'}},
            handlingUnitList:[{billedDimension:{
              length:{value:value('#quick-quote-length-input'),unit:'in'},
              width:{value:value('#ups-package-type-width-input'),unit:'in'},
              height:{value:value('#ups-package-type-height-input'),unit:'in'},
              dimensionType:'NET'},weight:{value:value('#ups-package-type-weight-input'),unit:'LB'},packagingType:'02'}]
          }},orgInfo:{namespace:'fixture-namespace'}})
        });
      };
    </script>
  </body></html>`;
}

async function handleRoute(route: Route, state: FixtureState): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== origin) {
    await route.abort();
    return;
  }
  if (url.pathname === '/ship/small-package') {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: pageHtml(state),
    });
    return;
  }
  if (url.pathname === '/svc/shopFlow') {
    const body = JSON.parse(request.postData() ?? '{}') as Record<
      string,
      unknown
    >;
    state.shopRequests.push(body);
    const shipment = (
      body.request as {
        shipment: {
          handlingUnitList: Array<{
            billedDimension: { length: { value: string } };
          }>;
        };
      }
    ).shipment;
    const amount =
      shipment.handlingUnitList[0]?.billedDimension.length.value === '20'
        ? 20
        : 12.08;
    await route.fulfill(
      json(200, {
        clientStatus: { success: true },
        response: {
          offerList: [
            {
              totalOfferPrice: { value: amount, unit: 'USD' },
              primaryVendor: { scac: 'UPS' },
              offeredProductList: [
                {
                  shopRQShipment: {
                    timeInTransit: {
                      serviceDescription: 'UPS Ground',
                      transitDays: 2,
                      scac: 'UPS',
                    },
                    handlingUnitList: [{ quantity: 1 }],
                    charges: [
                      {
                        description: 'SMALL PACKAGE FREIGHT',
                        customerPrice: { value: amount, unit: 'USD' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    );
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
    state.mutations.push(url.pathname);
  await route.abort();
}

type PackageGroup = QuoteInput['packageGroups'][number];

function group(
  quantity = 1,
  overrides: Partial<PackageGroup> = {},
): PackageGroup {
  return {
    quantity,
    units: 'imperial',
    length: '10',
    width: '8',
    height: '6',
    weight: '5',
    customsItems: [],
    ...overrides,
  };
}

function makeJob(
  mode: 'request' | 'browser',
  groups: PackageGroup[],
): LeasedQuote {
  return {
    id: 'attempt-1',
    requestId: 'request-1',
    accountId: 1,
    owner: 'owner-1',
    code: 'unishippers',
    mode,
    enabled: true,
    reloginCount: 0,
    sender: {
      code: 'unishippers',
      mode: 'explicit',
      retrievedAt: null,
      address,
    },
    input: {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      shipDate: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
      }).format(new Date()),
      destination,
      providers: [
        {
          code: 'unishippers',
          sender: { mode: 'explicit', address },
          options: { signature: 'none', insurance: null },
        },
      ],
      packageGroups: groups,
    },
  };
}

describe('myUnishippers Quick Quote adapter', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  async function fixture(overrides: Partial<FixtureState> = {}) {
    const state: FixtureState = {
      shopRequests: [],
      mutations: [],
      ...overrides,
    };
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', (route) => handleRoute(route, state));
    return { context, state };
  }

  it.each(['request', 'browser'] as const)(
    'checks %s readiness without requesting a rate',
    async (mode) => {
      const testFixture = await fixture({ loadUnsafeWrite: true });
      const adapter = new UnishippersShippingAdapter({
        origin,
        context: testFixture.context,
      });
      try {
        await adapter.readiness(mode);
        expect(testFixture.state.shopRequests).toEqual([]);
        expect(testFixture.state.mutations).toEqual([]);
      } finally {
        await adapter.close();
        await testFixture.context.close();
      }
    },
  );

  it('blocks provider writes attempted during initial page load', async () => {
    const testFixture = await fixture({ loadUnsafeWrite: true });
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    try {
      await expect(
        adapter.quote(
          makeJob('browser', [group()]),
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ outcome: 'success' });
      expect(testFixture.state.mutations).toEqual([]);
    } finally {
      await adapter.close();
      await testFixture.context.close();
    }
  });

  it.each(['request', 'browser'] as const)(
    'captures Quick Quote and replays distinct groups in %s mode',
    async (mode) => {
      const testFixture = await fixture();
      const adapter = new UnishippersShippingAdapter({
        origin,
        context: testFixture.context,
      });
      const job = makeJob(mode, [group(2), group(1, { length: '20' })]);
      try {
        const result = await adapter.quote(job, new AbortController().signal);
        expect(result).toMatchObject({ outcome: 'success', reason: null });
        expect(result.quotes[0]).toMatchObject({
          platform: 'myUnishippers',
          carrier: 'UPS',
          service: 'UPS Ground',
          total: '44.160000',
          currency: 'USD',
          estimateMethod: 'calculated',
          groupContributions: [
            { packageGroupPosition: 0, quantity: 2, subtotal: '24.160000' },
            { packageGroupPosition: 1, quantity: 1, subtotal: '20.000000' },
          ],
        });
        expect(testFixture.state.shopRequests).toHaveLength(2);
        expect(testFixture.state.mutations).toEqual([]);
      } finally {
        await adapter.close(job);
        await testFixture.context.close();
      }
    },
  );

  it('quotes duplicate box signatures once and multiplies each group contribution', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const job = makeJob('browser', [group(2), group(3)]);
    try {
      const result = await adapter.quote(job, new AbortController().signal);
      expect(result.quotes[0]?.total).toBe('60.400000');
      expect(result.quotes[0]?.groupContributions).toEqual([
        { packageGroupPosition: 0, quantity: 2, subtotal: '24.160000' },
        { packageGroupPosition: 1, quantity: 3, subtotal: '36.240000' },
      ]);
      expect(testFixture.state.shopRequests).toHaveLength(1);
    } finally {
      await adapter.close(job);
      await testFixture.context.close();
    }
  });

  it.each(['request', 'browser'] as const)(
    'quotes dimensionless packages by weight in %s mode',
    async (mode) => {
      const testFixture = await fixture();
      const adapter = new UnishippersShippingAdapter({
        origin,
        context: testFixture.context,
      });
      const job = makeJob(mode, [
        group(6, { length: '', width: '', height: '', weight: '51' }),
      ]);
      try {
        const result = await adapter.quote(job, new AbortController().signal);
        expect(result).toMatchObject({ outcome: 'success' });
        expect(result.quotes[0]?.total).toBe('72.480000');
        expect(result.quotes[0]?.groupContributions).toEqual([
          { packageGroupPosition: 0, quantity: 6, subtotal: '72.480000' },
        ]);
        expect(testFixture.state.shopRequests).toHaveLength(1);
      } finally {
        await adapter.close(job);
        await testFixture.context.close();
      }
    },
  );

  it('fails closed for defaults, international lanes, options, partial dimensions, and future dates', async () => {
    const testFixture = await fixture();
    const adapter = new UnishippersShippingAdapter({
      origin,
      context: testFixture.context,
    });
    const jobs = [
      makeJob('browser', [group()]),
      makeJob('browser', [group()]),
      makeJob('browser', [group()]),
      makeJob('browser', [group(1, { length: '' })]),
      makeJob('browser', [group()]),
    ];
    jobs[0]!.sender.mode = 'account_default';
    jobs[1]!.input.destination = { ...destination, country: 'CA' };
    jobs[2]!.input.providers[0]!.options.signature = 'signature';
    jobs[4]!.input.shipDate = '2099-10-20';
    try {
      for (const job of jobs)
        await expect(
          adapter.quote(job, new AbortController().signal),
        ).resolves.toMatchObject({ outcome: 'unsupported', quotes: [] });
      expect(testFixture.state.shopRequests).toEqual([]);
    } finally {
      await adapter.close();
      await testFixture.context.close();
    }
  });
});
