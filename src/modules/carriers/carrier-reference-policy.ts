import { z } from 'zod';

// Generic reference validation is an explicit V1-008 product decision. Keep
// identifiers as strings: casing, interior whitespace and leading zeros matter.
export const trackingReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('\u0000'));

export interface CarrierReferencePolicy {
  normalize(reference: string): string;
  verificationUrl(reference: string): string | null;
}

const verificationUrls: Readonly<
  Record<string, (reference: string) => string>
> = {
  ups: (reference) =>
    `https://www.ups.com/track?loc=en_US&trackn=${encodeURIComponent(reference)}`,
  echoship: (reference) =>
    `https://echoship.com/shipments/${encodeURIComponent(reference)}`,
  ffe: () => 'https://www.ffeinc.com/Customer/ShipmentTracking',
};

// No provider sessions/configuration are loaded in the API. Tracking tickets
// consume this same seam after a successful lookup, never during creation.
export function carrierReferencePolicy(code: string): CarrierReferencePolicy {
  return {
    normalize: (reference) => trackingReferenceSchema.parse(reference),
    verificationUrl: (reference) =>
      Object.hasOwn(verificationUrls, code)
        ? verificationUrls[code](trackingReferenceSchema.parse(reference))
        : null,
  };
}
