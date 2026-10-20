import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalMeasurements,
  conversionSnapshot,
  toProviderLength,
  toProviderWeight,
} from './quote-conversions.js';
import { QuoteDecimal } from './quote-decimal.js';
import {
  createQuoteSchema,
  submitQuoteSchema,
  type QuoteInput,
} from './quote.schemas.js';

const address = {
  name: 'Fixture',
  street: '1 Example Street',
  city: 'Abbotsford',
  division: 'British Columbia',
  postalCode: 'V2T 0J8',
  country: 'CA',
};

function input(): QuoteInput {
  return {
    idempotencyKey: randomUUID(),
    shipDate: '2099-10-19',
    destination: { ...address },
    international: {
      contentsDescription: 'Flour',
      customsMode: 'detailed',
      totalValue: { amount: '12.000000', currency: 'CAD' },
    },
    providers: [
      {
        code: 'unishippers',
        sender: {
          mode: 'explicit',
          address: { ...address, country: 'US', division: 'IL' },
        },
        options: { signature: 'signature', insurance: null },
      },
    ],
    packageGroups: [
      {
        quantity: 3,
        units: 'metric',
        length: '10.00',
        width: '8',
        height: '6',
        weight: '5',
        customsItems: [
          {
            description: 'Flour bag',
            quantity: 2,
            unitValue: '2.00',
            currency: 'CAD',
            countryOfManufacture: 'CA',
            weight: '0.5',
          },
        ],
      },
    ],
  };
}

describe('international quote input', () => {
  it('keeps historical account defaults readable but rejects them for new submissions', () => {
    const historical = input();
    historical.providers[0]!.sender = {
      mode: 'account_default',
      refreshId: '11111111-1111-4111-8111-111111111112',
    };

    expect(createQuoteSchema.safeParse(historical).success).toBe(true);
    expect(submitQuoteSchema.safeParse(historical).success).toBe(false);
  });

  it('allows blank dimensions only for myUnishippers-only submissions', () => {
    const unishippersOnly = input();
    unishippersOnly.packageGroups[0]!.length = '';
    unishippersOnly.packageGroups[0]!.width = '';
    unishippersOnly.packageGroups[0]!.height = '';

    expect(createQuoteSchema.safeParse(unishippersOnly).success).toBe(true);
    expect(submitQuoteSchema.safeParse(unishippersOnly).success).toBe(true);

    const amazonOnly = structuredClone(unishippersOnly);
    amazonOnly.providers[0]!.code = 'amazon';
    expect(submitQuoteSchema.safeParse(amazonOnly).success).toBe(false);

    const mixed = structuredClone(unishippersOnly);
    mixed.providers.push({
      ...mixed.providers[0]!,
      code: 'amazon',
    });
    expect(submitQuoteSchema.safeParse(mixed).success).toBe(false);
  });

  it('treats customs items as per-box and multiplies item and box quantities', () => {
    expect(createQuoteSchema.safeParse(input()).success).toBe(true);
    expect(
      createQuoteSchema.safeParse({
        ...input(),
        international: {
          ...input().international!,
          totalValue: { amount: '4.00', currency: 'CAD' },
        },
      }).success,
    ).toBe(false);
  });

  it('allows summary customs without item rows and rejects mixed currencies', () => {
    const summary = input();
    summary.international = {
      contentsDescription: 'Flour',
      customsMode: 'summary',
      totalValue: { amount: '1', currency: 'CAD' },
    };
    summary.packageGroups[0]!.customsItems = [];
    expect(createQuoteSchema.safeParse(summary).success).toBe(true);

    const mixed = input();
    mixed.packageGroups[0]!.customsItems[0]!.currency = 'USD';
    expect(createQuoteSchema.safeParse(mixed).success).toBe(false);
  });

  it('records six-decimal half-up provider conversions without changing originals', () => {
    const quote = input();
    const snapshot = conversionSnapshot(quote, 'unishippers');
    expect(snapshot.packageGroups[0]).toEqual({
      position: 0,
      quantity: 3,
      original: {
        units: 'metric',
        length: '10.00',
        width: '8',
        height: '6',
        weight: '5',
      },
      provider: {
        units: 'imperial',
        length: '3.937008',
        width: '3.149606',
        height: '2.362205',
        weight: '11.023113',
      },
    });
  });

  it('validates ISO country/currency codes and country-aware phone numbers', () => {
    const invalid = input();
    invalid.destination.country = 'ZZ';
    invalid.destination.phone = 'not a phone';
    invalid.international!.totalValue.currency = 'ZZZ';

    expect(createQuoteSchema.safeParse(invalid).success).toBe(false);
  });

  it('preserves detailed customs quantity semantics across generated values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (unitCents, itemQuantity, boxQuantity) => {
          const quote = input();
          const unitValue = new QuoteDecimal(unitCents).div(100).toFixed(2);
          const total = new QuoteDecimal(unitValue)
            .times(itemQuantity)
            .times(boxQuantity)
            .toFixed(6);

          quote.packageGroups[0]!.quantity = boxQuantity;
          quote.packageGroups[0]!.customsItems[0]!.quantity = itemQuantity;
          quote.packageGroups[0]!.customsItems[0]!.unitValue = unitValue;
          quote.international!.totalValue.amount = total;

          return createQuoteSchema.safeParse(quote).success;
        },
      ),
    );
  });

  it('round-trips generated metric measurements within six-decimal policy', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999_999 }), (millionths) => {
        const value = new QuoteDecimal(millionths).div(1_000_000).toFixed(6);
        const lengthInches = toProviderLength(value, 'metric');
        const weightPounds = toProviderWeight(value, 'metric');
        const lengthCm = canonicalMeasurements({
          ...input().packageGroups[0]!,
          units: 'imperial',
          length: lengthInches,
          width: lengthInches,
          height: lengthInches,
          weight: weightPounds,
        }).lengthCm!;
        const weightKg = canonicalMeasurements({
          ...input().packageGroups[0]!,
          units: 'imperial',
          length: lengthInches,
          width: lengthInches,
          height: lengthInches,
          weight: weightPounds,
        }).weightKg;

        return (
          new QuoteDecimal(lengthCm).minus(value).abs().lte('0.000002') &&
          new QuoteDecimal(weightKg).minus(value).abs().lte('0.000002')
        );
      }),
    );
  });
});
