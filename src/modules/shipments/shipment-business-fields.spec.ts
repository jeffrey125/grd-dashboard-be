import { describe, expect, it } from 'vitest';
import {
  createShipmentSchema,
  updateShipmentSchema,
} from './shipments.schemas.js';

describe('shipment business field validation', () => {
  it('preserves case and leading zeros while trimming and clearing blanks', () => {
    expect(
      updateShipmentSchema.parse({
        poNumber: ' 0001-a ',
        customer: ' ',
        vendor: null,
      }),
    ).toEqual({ poNumber: '0001-a', customer: null, vendor: null });
    expect(
      createShipmentSchema.parse({
        carrierExternalId: '00000000-0000-4000-8000-000000000001',
        trackingReference: '0001',
      }),
    ).not.toHaveProperty('poNumber');
  });
  it.each(['poNumber', 'customer', 'vendor'])(
    'bounds and validates %s',
    (field) => {
      expect(
        updateShipmentSchema.safeParse({ [field]: 'a'.repeat(255) }).success,
      ).toBe(true);
      for (const value of ['a'.repeat(256), 'a\0b', 12, []])
        expect(updateShipmentSchema.safeParse({ [field]: value }).success).toBe(
          false,
        );
    },
  );
  it('normalizes bounded lists without splitting product names or accepting ambiguous PO inputs', () => {
    expect(
      updateShipmentSchema.parse({
        poNumbers: [' 001 ', '001', '0'],
        soNumbers: [],
        products: ['Cacao, Powder'],
      }),
    ).toEqual({
      poNumbers: ['0', '001'],
      soNumbers: [],
      products: ['Cacao, Powder'],
    });
    for (const value of [
      [''],
      ['a'.repeat(256)],
      ['bad\0value'],
      Array(101).fill('item'),
      null,
    ])
      for (const field of ['poNumbers', 'soNumbers', 'products'])
        expect(updateShipmentSchema.safeParse({ [field]: value }).success).toBe(
          false,
        );
    expect(
      updateShipmentSchema.safeParse({ poNumber: '1', poNumbers: ['2'] })
        .success,
    ).toBe(false);
  });
});
