import { describe, expect, it } from 'vitest';
import { carrierReferencePolicy } from './carrier-reference-policy.js';

describe('Carrier reference policy', () => {
  it.each(['ups', 'echoship', 'ffe'])(
    'preserves generic reference strings for %s',
    (code) => {
      const policy = carrierReferencePolicy(code);

      expect(policy.normalize(' 001aB / x ')).toBe('001aB / x');
      expect(() => policy.normalize('  ')).toThrow();
      expect(() => policy.normalize('x'.repeat(256))).toThrow();
    },
  );

  it('builds original Carrier verification URLs with safely encoded reference components', () => {
    expect(carrierReferencePolicy('ups').verificationUrl(' A&?/# ')).toBe(
      'https://www.ups.com/track?loc=en_US&trackn=A%26%3F%2F%23',
    );
    expect(carrierReferencePolicy('echoship').verificationUrl(' A&?/# ')).toBe(
      'https://echoship.com/shipments/A%26%3F%2F%23',
    );
    expect(carrierReferencePolicy('ffe').verificationUrl('001')).toBe(
      'https://www.ffeinc.com/Customer/ShipmentTracking',
    );
    expect(
      carrierReferencePolicy('future-carrier').verificationUrl('001'),
    ).toBeNull();
    expect(
      carrierReferencePolicy('constructor').verificationUrl('001'),
    ).toBeNull();
  });
});
