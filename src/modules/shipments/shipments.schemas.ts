import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import {
  trackingSnapshotRecordSchema,
  latestLookupRecordSchema,
  trackingRunRecordSchema,
} from '@modules/tracking/tracking-read.schemas.js';
import { trackingReferenceSchema } from '@modules/carriers/carrier-reference-policy.js';
import {
  ShipmentMonitoringReason,
  ShipmentMonitoringStatus,
} from './shipment.entity.js';

export const shipmentExternalIdSchema = z
  .uuidv4()
  .transform((id) => id.toLowerCase());
const notesSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !value.includes('\u0000'))
  .nullable();

export const createShipmentSchema = z.strictObject({
  carrierExternalId: shipmentExternalIdSchema,
  trackingReference: trackingReferenceSchema,
  notes: notesSchema.optional().transform((value) => value ?? null),
});
export const createShipmentsEnvelopeSchema = z.strictObject({
  items: z.array(z.unknown()).min(1).max(10),
});
export const updateShipmentNotesSchema = z.strictObject({ notes: notesSchema });
export const monitoringCommandSchema = z.strictObject({});

export type NewShipment = z.infer<typeof createShipmentSchema>;

export const shipmentRecordSchema = z.strictObject({
  externalId: z.uuidv4(),
  carrier: z.strictObject({
    externalId: z.uuidv4(),
    code: z.string(),
    name: z.string(),
    isActive: z.boolean(),
  }),
  trackingReference: z.string(),
  notes: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  currentTracking: trackingSnapshotRecordSchema.nullable(),
  latestLookup: latestLookupRecordSchema.nullable(),
  latestRun: trackingRunRecordSchema.nullable(),
  monitoringStatus: z.enum(ShipmentMonitoringStatus),
  monitoringReason: z.enum(ShipmentMonitoringReason).nullable(),
  lastAttemptedAt: z.date().nullable(),
  nextCheckAt: z.date().nullable(),
  consecutiveNotFoundCount: z.int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const bulkShipmentResultSchema = z.strictObject({
  inserted: z.array(shipmentRecordSchema),
  duplicates: z.array(shipmentRecordSchema),
});

export interface ShipmentValidationDetail {
  row: number;
  field: 'carrierExternalId' | 'trackingReference' | 'notes' | 'item';
  message: string;
}

export function invalidShipmentRows(
  details: ShipmentValidationDetail[],
): never {
  throw new BadRequestException({
    message: 'One or more Shipments are invalid',
    code: 'shipment_validation_failed',
    details,
  });
}

export function parseShipmentInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) throw new BadRequestException('Invalid Shipment input');

  return result.data;
}
