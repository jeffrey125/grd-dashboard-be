import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildUnishippersEstimatePayload,
  buildUnishippersQuickQuoteReplay,
  matchesUnishippersQuickQuoteRequest,
  normalizeUnishippersOffers,
  unishippersQuickQuoteSignature,
  unishippersFailure,
} from './unishippers-quote.contract.js';
import type { LeasedQuote } from './quote-execution.repository.js';

const evidence = JSON.parse(
  readFileSync(
    'test/fixtures/shipping-quotes/unishippers-success-evidence.json',
    'utf8',
  ),
);

// Reconstruct only the observed response envelope around the sanitized evidence.
function response() {
  return {
    clientStatus: { success: true },
    response: {
      offerList: evidence.corrected.offers.map(
        (offer: {
          totalOfferPrice: unknown;
          expirationDate: string;
          products: Array<{ timeInTransit: unknown; charges: unknown }>;
        }) => ({
          totalOfferPrice: offer.totalOfferPrice,
          expirationDate: offer.expirationDate,
          primaryVendor: { scac: 'UPS' },
          offeredProductList: offer.products.map((product) => ({
            shopRQShipment: {
              timeInTransit: product.timeInTransit,
              handlingUnitList: [{ quantity: 1 }],
            },
            charges: product.charges,
          })),
        }),
      ),
    },
  };
}

describe('myUnishippers native whole-shipment offers', () => {
  it('preserves all seven services and the two-box USD 24.16 total without multiplying again', () => {
    const quotes = normalizeUnishippersOffers(response(), 2);

    expect(quotes).toHaveLength(7);
    expect(
      quotes.find((quote) => quote.service === 'UPS Ground'),
    ).toMatchObject({
      platform: 'myUnishippers',
      carrier: 'UPS',
      total: '24.160000',
      currency: 'USD',
      estimateMethod: 'native',
      transitDescription:
        '2 transit days; estimated delivery 2026-10-21; delivery by 23:00:00 (provider local time)',
      expiresAt: null,
      optionCoverage: 'unverified',
      charges: [
        {
          description: 'SMALL PACKAGE FREIGHT',
          amount: '12.080000',
          scope: 'package',
        },
        {
          description: 'SMALL PACKAGE FREIGHT',
          amount: '12.080000',
          scope: 'package',
        },
      ],
    });
  });

  it('normalizes current Quick Quote chargeItemList lines', () => {
    const body = response();
    for (const offer of body.response.offerList)
      offer.offeredProductList = offer.offeredProductList.slice(0, 1);
    const product = body.response.offerList[0]!.offeredProductList[0]!;
    product.chargeItemList = product.charges;
    delete product.charges;

    const charges = normalizeUnishippersOffers(body, 1)[0]?.charges;

    expect(charges).toHaveLength(2);
    expect(charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'SMALL PACKAGE FREIGHT',
          scope: 'package',
        }),
      ]),
    );
  });

  it('expands quantities into one native handling unit per box for request mode', () => {
    const address = {
      name: 'Short sender',
      street: '1 Example Street',
      city: 'Walworth',
      division: 'WI',
      postalCode: '53125',
      country: 'US' as const,
    };
    const group = {
      quantity: 2,
      units: 'metric' as const,
      length: '25.4',
      width: '20.32',
      height: '15.24',
      weight: '2.26796185',
      customsItems: [],
    };
    const job: LeasedQuote = {
      id: 'attempt',
      requestId: 'comparison',
      accountId: 1,
      owner: 'lease',
      code: 'unishippers',
      mode: 'request',
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
        shipDate: '2099-10-19',
        destination: { ...address, postalCode: '10118' },
        providers: [
          {
            code: 'unishippers',
            sender: { mode: 'explicit', address },
            options: { signature: 'none', insurance: null },
          },
        ],
        packageGroups: [group],
      },
    };
    const payload = buildUnishippersEstimatePayload(
      job,
      'namespace-from-bootstrap',
    );

    expect(payload.orgInfo).toEqual({ namespace: 'namespace-from-bootstrap' });
    expect(payload.request.shipment.handlingUnitList).toHaveLength(2);
    expect(payload.request.shipment.handlingUnitList[0]).toMatchObject({
      packagingType: '02',
      billedDimension: { length: { value: '10', unit: 'in' } },
      weight: { value: 5, unit: 'LB' },
    });

    const captured = structuredClone(payload);
    captured.request.shipment.handlingUnitList = [
      captured.request.shipment.handlingUnitList[0]!,
    ];
    expect(matchesUnishippersQuickQuoteRequest(captured, job, 0)).toBe(true);
    captured.request.shipment.handlingUnitList[0]!.billedDimension!.length.unit =
      'cm';
    expect(matchesUnishippersQuickQuoteRequest(captured, job, 0)).toBe(false);
    captured.request.shipment.handlingUnitList[0]!.billedDimension!.length.unit =
      'in';
    captured.request.shipment.handlingUnitList[0]!.weight.unit = 'kg';
    expect(matchesUnishippersQuickQuoteRequest(captured, job, 0)).toBe(false);
  });

  it('omits billed dimensions when all three dimensions are blank', () => {
    const address = {
      name: 'US Spice Mills',
      street: '200 Regency Drive',
      city: 'Glendale Heights',
      division: 'IL',
      postalCode: '60139',
      country: 'US' as const,
    };
    const job: LeasedQuote = {
      id: 'attempt',
      requestId: 'comparison',
      accountId: 1,
      owner: 'lease',
      code: 'unishippers',
      mode: 'request',
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
        shipDate: '2099-10-19',
        destination: {
          ...address,
          name: 'Marine Crisp',
          postalCode: '04901',
          city: 'Winslow',
          division: 'ME',
        },
        providers: [
          {
            code: 'unishippers',
            sender: { mode: 'explicit', address },
            options: { signature: 'none', insurance: null },
          },
        ],
        packageGroups: [
          {
            quantity: 6,
            units: 'imperial',
            length: '',
            width: '',
            height: '',
            weight: '51',
            customsItems: [],
          },
        ],
      },
    };

    const payload = buildUnishippersEstimatePayload(
      job,
      'namespace-from-bootstrap',
    );

    expect(payload.request.shipment.handlingUnitList).toHaveLength(6);
    expect(payload.request.shipment.handlingUnitList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packagingType: '02',
          weight: { value: 51, unit: 'LB' },
        }),
      ]),
    );
    expect(
      payload.request.shipment.handlingUnitList.every(
        (unit) => !('billedDimension' in unit),
      ),
    ).toBe(true);

    const captured = structuredClone(payload);
    captured.request.shipment.handlingUnitList = [
      captured.request.shipment.handlingUnitList[0]!,
    ];
    expect(matchesUnishippersQuickQuoteRequest(captured, job, 0)).toBe(true);
    const replay = buildUnishippersQuickQuoteReplay(
      captured,
      job,
      0,
    ) as typeof captured;
    expect(
      'billedDimension' in replay.request.shipment.handlingUnitList[0]!,
    ).toBe(false);
    expect(JSON.parse(unishippersQuickQuoteSignature(job, 0))).toMatchObject({
      dimensions: null,
      weight: { value: 51, unit: 'LB' },
    });
  });

  it('does not apply the full-form sender-company limit to the estimate contract', () => {
    const longName = 'Global Resources Direct LLC - Chicago';
    const address = {
      name: longName,
      street: '1 Example Street',
      city: 'Walworth',
      division: 'WI',
      postalCode: '53125',
      country: 'US' as const,
    };
    const job: LeasedQuote = {
      id: 'attempt',
      requestId: 'comparison',
      accountId: 1,
      owner: 'lease',
      code: 'unishippers',
      mode: 'request',
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
        shipDate: '2099-10-19',
        destination: { ...address, postalCode: '10118', name: 'Receiver' },
        providers: [
          {
            code: 'unishippers',
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

    expect(() =>
      buildUnishippersEstimatePayload(job, 'namespace-from-bootstrap'),
    ).not.toThrow();
  });

  it('maps the observed company limit to actionable validation without exposing the provider message', () => {
    const failure = unishippersFailure(422, {
      clientStatus: {
        ...evidence.baseline.clientStatus,
        message: 'private account information',
      },
    });

    expect(failure).toMatchObject({
      outcome: 'validation_failed',
      reason: 'sender_company_too_long',
      quotes: [],
    });
    expect(JSON.stringify(failure)).not.toContain('private account');
  });

  it('rejects an offer that did not quote all submitted boxes', () => {
    expect(() => normalizeUnishippersOffers(response(), 3)).toThrow(
      'unishippers_contract_unverified',
    );
  });

  it('does not treat failed or malformed provider responses as successful rates', () => {
    expect(() =>
      normalizeUnishippersOffers(
        { ...response(), clientStatus: { success: false } },
        2,
      ),
    ).toThrow();
    expect(() =>
      normalizeUnishippersOffers({ response: { offerList: [] } }, 2),
    ).toThrow();
    const invalid = response();
    invalid.response.offerList[0].totalOfferPrice = {
      value: '-1',
      unit: 'USD',
    };
    expect(() => normalizeUnishippersOffers(invalid, 2)).toThrow();
  });

  it('keeps timezone-free expiry unknown and accepts an explicit offset', () => {
    const body = response();
    body.response.offerList[0].expirationDate = '2026-10-22T14:12:24-04:00';
    const quotes = normalizeUnishippersOffers(body, 2);

    expect(quotes[0]?.expiresAt).toBe('2026-10-22T18:12:24.000Z');
    expect(quotes[1]?.expiresAt).toBeNull();
  });

  it.each([
    [401, 'authentication_failed'],
    [403, 'authentication_failed'],
    [422, 'validation_failed'],
    [500, 'provider_failed'],
  ])('maps HTTP %s to %s without leaking a raw error', (status, reason) => {
    expect(unishippersFailure(status, { message: 'secret' })?.reason).toBe(
      reason,
    );
  });
});
