import { z } from 'zod';

export const trackingRunTriggerSchema = z.enum(['scheduled', 'manual']);
export const trackingRunExternalIdSchema = z.uuid();

export const createTrackingRunSchema = z
  .object({
    carrierExternalId: z.uuid(),
    trigger: trackingRunTriggerSchema,
    shipmentExternalIds: z.array(z.uuid()).min(1),
    requestedById: z.int().positive().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.shipmentExternalIds).size !==
      value.shipmentExternalIds.length
    )
      context.addIssue({
        code: 'custom',
        path: ['shipmentExternalIds'],
        message: 'Shipment IDs must be unique within a tracking run',
      });

    if (value.trigger === 'scheduled' && value.requestedById !== null)
      context.addIssue({
        code: 'custom',
        path: ['requestedById'],
        message: 'Scheduled runs cannot have a requesting user',
      });
  });

export type CreateTrackingRun = z.infer<typeof createTrackingRunSchema>;

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, 'Invalid calendar date');

export const normalizedTrackingStateSchema = z
  .object({
    carrierStatus: z.string().max(255).nullable(),
    carrierStatusDetail: z.string().nullable(),
    pickedUpOn: calendarDateSchema.nullable(),
    estimatedDeliveryOn: calendarDateSchema.nullable(),
    deliveredOn: calendarDateSchema.nullable(),
  })
  .strict();

export const sourceDataSchema = z.record(z.string(), z.json()).nullable();

export const finalizeFoundSchema = z
  .object({
    runExternalId: z.uuid(),
    shipmentExternalId: z.uuid(),
    expectedLockVersion: z.int().positive(),
    effectiveIntervalMinutes: z.int().positive(),
    snapshot: normalizedTrackingStateSchema,
    sourceData: sourceDataSchema,
  })
  .strict();

export type NormalizedTrackingState = z.infer<
  typeof normalizedTrackingStateSchema
>;

export type FinalizeFound = z.infer<typeof finalizeFoundSchema>;

export const finalizeNotFoundSchema = z
  .object({
    runExternalId: z.uuid(),
    shipmentExternalId: z.uuid(),
    expectedLockVersion: z.int().positive(),
    effectiveIntervalMinutes: z.int().positive(),
    sourceData: sourceDataSchema,
  })
  .strict();

export type FinalizeNotFound = z.infer<typeof finalizeNotFoundSchema>;

export const finalizeFailedSchema = z
  .object({
    runExternalId: z.uuid(),
    shipmentExternalId: z.uuid(),
    expectedLockVersion: z.int().positive(),
    effectiveIntervalMinutes: z.int().positive(),
    retryable: z.boolean(),
    reasonCode: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).nullable(),
    sourceData: sourceDataSchema,
  })
  .strict();

export type FinalizeFailed = z.infer<typeof finalizeFailedSchema>;

export const finalizeSkippedSchema = z
  .object({
    runExternalId: z.uuid(),
    shipmentExternalId: z.uuid(),
    reasonCode: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).nullable(),
  })
  .strict();

export const interruptRunSchema = z
  .object({
    runExternalId: z.uuid(),
    retryable: z.boolean(),
    reasonCode: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).nullable(),
  })
  .strict();

export type FinalizeSkipped = z.infer<typeof finalizeSkippedSchema>;

export type InterruptRun = z.infer<typeof interruptRunSchema>;
