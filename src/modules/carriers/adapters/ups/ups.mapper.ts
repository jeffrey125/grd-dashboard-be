import type { TrackingResult } from '@modules/carriers/adapters/carrier-result.js';
import { invalidUpsResponse } from './ups.failure.js';
import { upsPackageSchema, upsResponseSchema } from './ups.schemas.js';

export function mapUpsResponse(
  body: unknown,
  reference: string,
): TrackingResult {
  const response = upsResponseSchema.safeParse(body);

  if (!response.success) throw invalidUpsResponse();

  const matches = response.data.trackResponse.shipment
    .flatMap((shipment) => shipment.package)
    .filter(
      (pkg) =>
        typeof pkg === 'object' &&
        pkg !== null &&
        'trackingNumber' in pkg &&
        pkg.trackingNumber === reference,
    );

  if (matches.length !== 1) throw invalidUpsResponse();

  const parsed = upsPackageSchema.safeParse(matches[0]);

  if (!parsed.success) throw invalidUpsResponse();

  const pkg = parsed.data;
  const description = pkg.currentStatus.description.trim();
  const status =
    pkg.currentStatus.simplifiedTextDescription?.trim() || description;
  const dates = pkg.deliveryDate ?? [];
  const lastDate = (type: string) =>
    dates.findLast((entry) => entry.type === type && entry.date)?.date;
  const normalize = (value: string | null | undefined) =>
    value
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : null;

  return {
    outcome: 'found',
    snapshot: {
      carrierStatus: status,
      carrierStatusDetail: description === status ? null : description,
      pickedUpOn: null,
      estimatedDeliveryOn: normalize(
        lastDate('RDD') ??
          dates.find((entry) => entry.type === 'SDD' && entry.date)?.date,
      ),
      deliveredOn: normalize(lastDate('DEL')),
    },
    sourceData: pkg,
  };
}
