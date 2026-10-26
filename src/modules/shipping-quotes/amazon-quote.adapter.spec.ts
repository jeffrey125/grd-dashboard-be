import { describe, expect, it, vi } from 'vitest';
import {
  AmazonShippingAdapter,
  type AmazonApiSession,
} from './amazon-quote.adapter.js';
import type { LeasedQuote } from './quote-execution.repository.js';

const address = {
  name: 'Global Resources Direct',
  street: '123 Example Street',
  city: 'Seattle',
  division: 'WA',
  postalCode: '98101',
  country: 'US' as const,
};

const input = {
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  shipDate: '2099-10-22',
  destination: { ...address, postalCode: '10001', division: 'NY' },
  providers: [
    {
      code: 'amazon' as const,
      sender: { mode: 'explicit' as const, address },
      options: { signature: 'none' as const, insurance: null },
    },
  ],
  packageGroups: [
    {
      quantity: 2,
      units: 'imperial' as const,
      length: '10',
      width: '8',
      height: '6',
      weight: '5',
      customsItems: [],
    },
  ],
};

function job(): LeasedQuote {
  return {
    id: 'attempt-1',
    requestId: 'request-1',
    accountId: 1,
    owner: 'owner-1',
    code: 'amazon',
    mode: 'api',
    enabled: true,
    input,
    sender: { code: 'amazon', mode: 'explicit', retrievedAt: null, address },
    reloginCount: 0,
  };
}

const fixtureRate = {
  payload: {
    requestToken: 'sandbox-request-token',
    rates: [
      {
        rateId: 'sandbox-rate',
        carrierId: 'AMZN_US',
        carrierName: 'Amazon Shipping',
        serviceId: 'std-us-swa-mfn',
        serviceName: 'Amazon Shipping Ground',
        totalCharge: { value: 17.53, unit: 'USD' },
        promise: {
          pickupWindow: { start: '2099-10-22T20:00:00Z' },
          deliveryWindow: { end: '2099-10-29T03:00:00Z' },
        },
        supportedDocumentSpecifications: [],
        requiresAdditionalInputs: false,
        rateItemList: [
          {
            rateItemID: 'BASE_RATE',
            rateItemType: 'MANDATORY',
            rateItemCharge: { value: 17.53, unit: 'USD' },
          },
        ],
      },
    ],
    ineligibleRates: [],
  },
};

describe('Amazon Shipping API production adapter', () => {
  it('quotes every physical box through SP-API and aggregates the common service', async () => {
    const authenticate = vi.fn(async () => undefined);
    const getRates = vi.fn<AmazonApiSession['getRates']>(
      async () => fixtureRate,
    );
    const session: AmazonApiSession = { authenticate, getRates };
    const adapter = new AmazonShippingAdapter({
      session,
    });

    const result = await adapter.quote(job(), new AbortController().signal);

    expect(result).toMatchObject({
      outcome: 'success',
      simulated: false,
      quotes: [
        {
          carrier: 'Amazon Shipping',
          service: 'Amazon Shipping Ground',
          total: '35.060000',
          currency: 'USD',
          estimateMethod: 'calculated',
          transitDescription: '2099-10-29T03:00:00Z',
          groupContributions: [
            {
              packageGroupPosition: 0,
              quantity: 2,
              subtotal: '35.060000',
            },
          ],
        },
      ],
    });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(getRates).toHaveBeenCalledTimes(2);
    expect(getRates).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        shipDate: '2099-10-22T12:00:00Z',
        channelDetails: { channelType: 'EXTERNAL' },
        packages: [
          expect.objectContaining({
            dimensions: { length: 10, width: 8, height: 6, unit: 'INCH' },
            weight: { value: 5, unit: 'POUND' },
            insuredValue: { value: 0, unit: 'USD' },
            items: [
              {
                quantity: 1,
                weight: { value: 5, unit: 'POUND' },
              },
            ],
          }),
        ],
      }),
      expect.any(AbortSignal),
    );
  });

  it('lets Amazon default the pickup time for a same-day shipment', async () => {
    const current = new Date('2026-10-21T22:16:00.000Z');
    const sameDay = job();
    sameDay.input = structuredClone(sameDay.input);
    sameDay.input.shipDate = '2026-10-21';
    const getRates = vi.fn<AmazonApiSession['getRates']>(
      async () => fixtureRate,
    );
    const adapter = new AmazonShippingAdapter({
      now: () => current,
      session: { authenticate: vi.fn(async () => undefined), getRates },
    });

    const result = await adapter.quote(sameDay, new AbortController().signal);

    expect(result.outcome).toBe('success');
    const request = getRates.mock.calls[0]![0];
    expect(request).not.toHaveProperty('shipDate');
  });

  it('rejects a ship date that became stale before worker execution', async () => {
    const stale = job();
    stale.input = structuredClone(stale.input);
    stale.input.shipDate = '2026-10-20';
    const getRates = vi.fn(async () => fixtureRate);
    const adapter = new AmazonShippingAdapter({
      now: () => new Date('2026-10-21T22:16:00.000Z'),
      session: { authenticate: vi.fn(async () => undefined), getRates },
    });

    expect(
      await adapter.quote(stale, new AbortController().signal),
    ).toMatchObject({ outcome: 'validation_failed', quotes: [] });
    expect(getRates).not.toHaveBeenCalled();
  });

  it('classifies an LWA token failure without exposing provider details', async () => {
    const adapter = new AmazonShippingAdapter({
      session: {
        authenticate: vi.fn(async () => {
          throw new Error('client_secret=do-not-expose');
        }),
        getRates: vi.fn(),
      },
    });

    expect(
      await adapter.quote(job(), new AbortController().signal),
    ).toMatchObject({
      outcome: 'authentication_failed',
      reason: 'authentication_failed',
      simulated: false,
      quotes: [],
    });
  });

  it('rejects more than 100 physical packages before allocating or calling Amazon', async () => {
    const getRates = vi.fn(async () => fixtureRate);
    const overLimit = job();
    overLimit.input = structuredClone(overLimit.input);
    overLimit.input.packageGroups[0]!.quantity = 101;
    const adapter = new AmazonShippingAdapter({
      session: { authenticate: vi.fn(async () => undefined), getRates },
    });

    expect(
      await adapter.quote(overLimit, new AbortController().signal),
    ).toMatchObject({ outcome: 'unsupported', quotes: [] });
    expect(getRates).not.toHaveBeenCalled();
  });

  it('rejects an over-limit contact name before calling Amazon', async () => {
    const getRates = vi.fn(async () => fixtureRate);
    const invalid = job();
    invalid.sender = structuredClone(invalid.sender);
    invalid.sender.address.contactName = 'C'.repeat(51);
    const adapter = new AmazonShippingAdapter({
      session: { authenticate: vi.fn(async () => undefined), getRates },
    });

    expect(
      await adapter.quote(invalid, new AbortController().signal),
    ).toMatchObject({ outcome: 'validation_failed', quotes: [] });
    expect(getRates).not.toHaveBeenCalled();
  });

  it('accepts the 100-package boundary', async () => {
    const getRates = vi.fn(async () => fixtureRate);
    const boundary = job();
    boundary.input = structuredClone(boundary.input);
    boundary.input.packageGroups[0]!.quantity = 100;
    const adapter = new AmazonShippingAdapter({
      session: { authenticate: vi.fn(async () => undefined), getRates },
    });

    const result = await adapter.quote(boundary, new AbortController().signal);

    expect(result.outcome).toBe('success');
    expect(result.quotes[0]).toMatchObject({ total: '1753.000000' });
    expect(getRates).toHaveBeenCalledTimes(100);
  });

  it('keeps only services returned for every physical package', async () => {
    const alternate = structuredClone(fixtureRate.payload.rates[0]!);
    alternate.rateId = 'alternate-rate';
    alternate.serviceId = 'alternate-service';
    alternate.serviceName = 'Amazon Shipping Alternate';
    const first = structuredClone(fixtureRate);
    first.payload.rates.push(alternate);
    const getRates = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(fixtureRate);
    const adapter = new AmazonShippingAdapter({
      session: { authenticate: vi.fn(async () => undefined), getRates },
    });

    const result = await adapter.quote(job(), new AbortController().signal);

    expect(result.outcome).toBe('success');
    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0]).toMatchObject({
      service: 'Amazon Shipping Ground',
      total: '35.060000',
    });
  });

  it('fails closed when packages have no common service', async () => {
    const second = structuredClone(fixtureRate);
    second.payload.rates[0]!.serviceId = 'different-service';
    const getRates = vi
      .fn()
      .mockResolvedValueOnce(fixtureRate)
      .mockResolvedValueOnce(second);
    const adapter = new AmazonShippingAdapter({
      session: { authenticate: vi.fn(async () => undefined), getRates },
    });

    expect(
      await adapter.quote(job(), new AbortController().signal),
    ).toMatchObject({ outcome: 'unsupported', quotes: [] });
  });

  it('classifies a provider 400 without exposing its response body', async () => {
    const adapter = new AmazonShippingAdapter({
      session: {
        authenticate: vi.fn(async () => undefined),
        getRates: vi.fn(async () => {
          throw Object.assign(new Error('private sandbox response'), {
            isAxiosError: true,
            response: { status: 400 },
          });
        }),
      },
    });

    expect(
      await adapter.quote(job(), new AbortController().signal),
    ).toMatchObject({ outcome: 'validation_failed', quotes: [] });
  });
});
