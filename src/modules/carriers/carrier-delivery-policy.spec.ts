import { describe, expect, it } from 'vitest';
import { isExplicitlyUndelivered } from './carrier-delivery-policy.js';

describe('carrier delivery reversal evidence', () => {
  it('normalizes casing and whitespace without matching arbitrary text', () => {
    expect(isExplicitlyUndelivered('ffe', '  OUT  for\nDelivery ')).toBe(true);
    expect(isExplicitlyUndelivered('ups', ' IN TRANSIT ')).toBe(true);
    expect(isExplicitlyUndelivered('echoship', 'CheckedIn')).toBe(true);
  });

  it.each([
    null,
    '',
    'Delivered',
    'Delivery exception',
    'Previously out for delivery',
  ])(
    'preserves known delivery for missing or inconclusive status %s',
    (status) => {
      for (const code of ['ffe', 'ups', 'echoship'])
        expect(isExplicitlyUndelivered(code, status)).toBe(false);
    },
  );

  it('does not borrow status meanings from a different carrier', () => {
    expect(isExplicitlyUndelivered('ups', 'CheckedIn')).toBe(false);
    expect(isExplicitlyUndelivered('ffe', 'Moving')).toBe(false);
    expect(isExplicitlyUndelivered('unknown', 'Out for Delivery')).toBe(false);
    expect(isExplicitlyUndelivered('toString', 'Out for Delivery')).toBe(false);
  });
});
