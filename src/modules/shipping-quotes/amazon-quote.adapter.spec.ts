import type { BrowserContext, Locator, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import {
  aggregateAmazonRates,
  AmazonChargeScopeUnknown,
  AmazonShippingAdapter,
  normalizeAmazonRate,
} from './amazon-quote.adapter.js';
import type { LeasedQuote } from './quote-execution.repository.js';

const evidenceBody = {
  totalCharge: { unit: 'USD', value: 13.81 },
  shippingCharges: [
    { chargeCode: 'BASE_CHARGE', charge: { unit: 'USD', value: 7.83 } },
    {
      chargeCode: 'DELIVERY_AREA_SURCHARGE',
      charge: { unit: 'USD', value: 3.56 },
    },
    { chargeCode: 'FUEL_SURCHARGE', charge: { unit: 'USD', value: 2.42 } },
  ],
};

const address = {
  name: 'Fixture',
  street: '1 Example St',
  city: 'Walworth',
  division: 'WI',
  postalCode: '53125',
  country: 'US' as const,
};

const input = {
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  shipDate: '2099-10-19',
  destination: { ...address, postalCode: '10118' },
  providers: [
    {
      code: 'amazon' as const,
      sender: { mode: 'explicit' as const, address },
      options: { signature: 'none' as const, insurance: null },
    },
  ],
  packageGroups: [
    {
      quantity: 1,
      units: 'imperial' as const,
      length: '10',
      width: '8',
      height: '6',
      weight: '5',
      customsItems: [],
    },
  ],
};

function job(mode: 'request' | 'browser'): LeasedQuote {
  return {
    id: 'attempt-1',
    requestId: 'request-1',
    accountId: 1,
    owner: 'owner-1',
    code: 'amazon',
    mode,
    enabled: true,
    input,
    sender: { code: 'amazon', mode: 'explicit', retrievedAt: null, address },
    reloginCount: 0,
  };
}

function fakeLocator(visible: boolean) {
  const value = {
    first: () => value,
    or: () => value,
    isVisible: async () => visible,
    waitFor: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    innerText: async () => '',
  };
  return value as unknown as Locator;
}

function fakePage(mode: 'request' | 'browser') {
  const origin = 'https://amazon.fixture';
  const visible = fakeLocator(true);
  const body = fakeLocator(true);
  const email = fakeLocator(false);
  const rateRequest = {
    method: () => 'POST',
    postDataJSON: () => ({
      originZip: '53125',
      destinationZip: '10118',
      length: 10,
      width: 8,
      height: 6,
      weight: 5,
      serviceCode: 'swa-us-mfn',
    }),
    headers: () => ({}),
  };
  const rateResponse = {
    status: () => 200,
    ok: () => true,
    url: () =>
      `${origin}/shipping-rates/getRates?merchantId=merchant-1&simulatedShipperId=proposal-1`,
    request: () => rateRequest,
    json: async () => evidenceBody,
  };
  const bootstrapResponse = {
    status: () => 200,
    ok: () => true,
    url: () => `${origin}/hz/getLatestProposalSharedWithShipper`,
    request: () => ({ headers: () => ({ 'x-xsrf-token': 'xsrf-1' }) }),
    json: async () => ({
      rateCardProposal: {
        merchantId: 'merchant-1',
        simulatedShipperId: 'proposal-1',
      },
    }),
  };
  let responseCalls = 0;
  const page = {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn(async () => undefined),
    waitForResponse: vi.fn(
      async (predicate: (response: unknown) => boolean) => {
        responseCalls += 1;
        if (mode === 'request' || responseCalls % 2 === 1)
          return bootstrapResponse;
        expect(predicate(rateResponse)).toBe(true);
        return rateResponse;
      },
    ),
    getByLabel: vi.fn(() => visible),
    getByRole: vi.fn(() => visible),
    locator: vi.fn((selector: string) =>
      selector === 'body'
        ? body
        : selector.includes('ap_email')
          ? email
          : visible,
    ),
    evaluate: vi.fn(async () => ({
      status: 200,
      body: JSON.stringify(evidenceBody),
    })),
  } as unknown as Page;
  const context = {
    newPage: vi.fn(async () => page),
  } as unknown as BrowserContext;
  return { origin, context, page, mode };
}

describe('Amazon quote normalization and aggregation', () => {
  it('normalizes the verified single-package USD 13.81 response', () => {
    expect(normalizeAmazonRate(evidenceBody)).toMatchObject({
      carrier: 'Not provided',
      service: 'Not provided',
      total: '13.810000',
      currency: 'USD',
      charges: [
        { description: 'BASE_CHARGE', amount: '7.830000', scope: 'package' },
        {
          description: 'DELIVERY_AREA_SURCHARGE',
          amount: '3.560000',
          scope: 'package',
        },
        { description: 'FUEL_SURCHARGE', amount: '2.420000', scope: 'package' },
      ],
    });
  });

  it('deduplicates compatible boxes and multiplies only package charges', () => {
    const rate = normalizeAmazonRate({
      ...evidenceBody,
      shippingCharges: [
        ...evidenceBody.shippingCharges,
        { chargeCode: 'SHIPMENT_FEE', charge: { unit: 'USD', value: 1 } },
      ],
      totalCharge: { unit: 'USD', value: 14.81 },
    });
    const [quote] = aggregateAmazonRates([
      {
        rate,
        groups: [{ packageGroupPosition: 0, quantity: 2 }],
      },
    ]);

    expect(quote).toMatchObject({
      total: '28.620000',
      estimateMethod: 'calculated',
      groupContributions: [
        { packageGroupPosition: 0, quantity: 2, subtotal: '27.620000' },
      ],
    });
    expect(quote?.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'BASE_CHARGE',
          amount: '15.660000',
          packageGroupPosition: 0,
        }),
        expect.objectContaining({
          description: 'SHIPMENT_FEE',
          amount: '1.000000',
          packageGroupPosition: null,
        }),
      ]),
    );
  });

  it('stops when a returned charge cannot be assigned a scope', () => {
    expect(() =>
      normalizeAmazonRate({
        ...evidenceBody,
        shippingCharges: [
          ...evidenceBody.shippingCharges,
          { chargeCode: 'UNCLASSIFIED_FEE', charge: { unit: 'USD', value: 1 } },
        ],
      }),
    ).toThrow(AmazonChargeScopeUnknown);
  });

  it('uses the authenticated request mode and refreshes bootstrap context per quote', async () => {
    const fixture = fakePage('request');
    const adapter = new AmazonShippingAdapter({
      origin: fixture.origin,
      context: fixture.context,
      credentials: () => ({
        email: 'fixture@example.test',
        password: 'fixture-password',
      }),
    });

    const first = await adapter.quote(
      job('request'),
      new AbortController().signal,
    );
    const second = await adapter.quote(
      job('request'),
      new AbortController().signal,
    );

    expect(first.outcome).toBe('success');
    expect(second.outcome).toBe('success');
    expect(fixture.page.goto).toHaveBeenCalledTimes(2);
    expect(fixture.page.evaluate).toHaveBeenCalledTimes(2);
    expect(fixture.page.waitForResponse).toHaveBeenCalledTimes(2);
  });

  it('uses the browser mode response for the current proposal and package payload', async () => {
    const fixture = fakePage('browser');
    const adapter = new AmazonShippingAdapter({
      origin: fixture.origin,
      context: fixture.context,
      credentials: () => ({
        email: 'fixture@example.test',
        password: 'fixture-password',
      }),
    });

    const result = await adapter.quote(
      job('browser'),
      new AbortController().signal,
    );

    expect(result.outcome).toBe('success');
    expect(fixture.page.evaluate).not.toHaveBeenCalled();
    expect(fixture.page.waitForResponse).toHaveBeenCalledTimes(2);
  });
});
