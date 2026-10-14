import { z } from 'zod';
import { trackingResultSchema } from '../carrier-result.js';

const dateField = z.string().max(64).nullish();
const recordSchema = z.object({
  orderNumber: z.string().trim().min(1).max(255),
  shipmentStatus: z.string().max(255).nullish(),
  pickupDate: dateField,
  apptPickupDate: dateField,
  apptDeliveryDate: dateField,
  schedDeliveryDate: dateField,
  requestedDeliveryDate: dateField,
  deliveryDate: dateField,
});

function calendarDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed || trimmed.startsWith('0001-01-01')) return null;

  const parsed = z
    .union([z.iso.date(), z.iso.datetime({ offset: true, local: true })])
    .safeParse(trimmed);

  return parsed.success ? parsed.data.slice(0, 10) : null;
}

export function mapFfe(reference: string, input: unknown) {
  const row = recordSchema.parse(input);

  if (row.orderNumber !== reference) throw new Error('FFE reference mismatch');

  const status = row.shipmentStatus?.replace(/\s+/g, ' ').trim() || null;

  return trackingResultSchema.parse({
    outcome: 'found',
    snapshot: {
      carrierStatus: status,
      carrierStatusDetail: null,
      pickedUpOn:
        calendarDate(row.pickupDate) ?? calendarDate(row.apptPickupDate),
      estimatedDeliveryOn:
        calendarDate(row.apptDeliveryDate) ??
        calendarDate(row.schedDeliveryDate) ??
        calendarDate(row.requestedDeliveryDate),
      deliveredOn:
        status?.toLowerCase() === 'delivered'
          ? calendarDate(row.deliveryDate)
          : null,
    },
    sourceData: {
      orderNumber: row.orderNumber,
      shipmentStatus: row.shipmentStatus ?? null,
      pickupDate: row.pickupDate ?? null,
      apptPickupDate: row.apptPickupDate ?? null,
      apptDeliveryDate: row.apptDeliveryDate ?? null,
      schedDeliveryDate: row.schedDeliveryDate ?? null,
      requestedDeliveryDate: row.requestedDeliveryDate ?? null,
      deliveryDate: row.deliveryDate ?? null,
    },
  });
}
