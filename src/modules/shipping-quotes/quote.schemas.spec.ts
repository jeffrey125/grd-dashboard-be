import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { conversionSnapshot } from './quote-conversions.js';
import { createQuoteSchema, type QuoteInput } from './quote.schemas.js';

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
    destination: address,
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
});
