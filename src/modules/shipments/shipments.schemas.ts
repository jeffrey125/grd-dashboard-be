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
export const updateShipmentNotesSchema = z.strictObject({ notes: notesSchema });
export const monitoringCommandSchema = z.strictObject({});

const positiveIntegerQuerySchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().positive().safe());

export const shipmentSearchQuerySchema = z
  .strictObject({
    tab: z
      .enum(['all', 'active', 'paused', 'delivered', 'attention'])
      .default('active'),
    q: z
      .string()
      .trim()
      .max(255)
      .refine((value) => !value.includes('\u0000'))
      .transform((value) => value || undefined)
      .optional(),
    carrierExternalId: shipmentExternalIdSchema.optional(),
    estimatedDeliveryFrom: z.iso
      .date()
      .refine((value) => !value.startsWith('0000'))
      .optional(),
    estimatedDeliveryTo: z.iso
      .date()
      .refine((value) => !value.startsWith('0000'))
      .optional(),
    undeliveredOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    page: positiveIntegerQuerySchema.default(1),
    pageSize: z.enum(['25', '50', '100']).default('25').transform(Number),
    sortBy: z
      .enum(['createdAt', 'trackingReference', 'estimatedDeliveryOn'])
      .default('createdAt'),
    sortDirection: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine((query, context) => {
    if (
      query.estimatedDeliveryFrom &&
      query.estimatedDeliveryTo &&
      query.estimatedDeliveryFrom > query.estimatedDeliveryTo
    )
      context.addIssue({
        code: 'custom',
        path: ['estimatedDeliveryTo'],
        message: 'End date must not precede start date',
      });
    if (!Number.isSafeInteger((query.page - 1) * query.pageSize))
      context.addIssue({ code: 'custom', message: 'Page offset is too large' });
  });

export type ShipmentSearchQuery = z.infer<typeof shipmentSearchQuerySchema>;

export const shipmentHistoryQuerySchema = z
  .strictObject({
    page: positiveIntegerQuerySchema.default(1),
    pageSize: z.enum(['25', '50', '100']).default('25').transform(Number),
  })
  .refine((query) => Number.isSafeInteger((query.page - 1) * query.pageSize), {
    message: 'Page offset is too large',
  });

export type ShipmentHistoryQuery = z.infer<typeof shipmentHistoryQuerySchema>;

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
export const shipmentTabCountsSchema = z.strictObject({
  all: z.int().nonnegative(),
  active: z.int().nonnegative(),
  paused: z.int().nonnegative(),
  delivered: z.int().nonnegative(),
  attention: z.int().nonnegative(),
});
export const shipmentSearchResponseSchema = z.strictObject({
  items: z.array(shipmentRecordSchema),
  page: z.int().positive(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  total: z.int().nonnegative(),
  tabCounts: shipmentTabCountsSchema,
});
export const shipmentHistoryResponseSchema = z.strictObject({
  items: z.array(trackingSnapshotRecordSchema),
  page: z.int().positive(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  total: z.int().nonnegative(),
});

export interface ShipmentValidationDetail {
  field: 'carrierExternalId' | 'trackingReference' | 'notes' | 'shipment';
  message: string;
}

export function invalidShipmentFields(
  details: ShipmentValidationDetail[],
): never {
  throw new BadRequestException({
    message: 'Shipment is invalid',
    code: 'shipment_validation_failed',
    details,
  });
}

export function parseShipmentInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) throw new BadRequestException('Invalid Shipment input');

  return result.data;
}
