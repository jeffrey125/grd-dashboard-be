import { z } from 'zod';
import {
  normalizedTrackingStateSchema,
  sourceDataSchema,
} from '@modules/tracking/tracking.schemas.js';

/** Shape validation complements each provider's own source-data allowlist. */
export const trackingResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('found'),
      snapshot: normalizedTrackingStateSchema.refine((snapshot) =>
        Object.values(snapshot).some((value) => value !== null),
      ),
      sourceData: sourceDataSchema,
    })
    .strict(),
  z
    .object({ outcome: z.literal('not_found'), sourceData: sourceDataSchema })
    .strict(),
  z
    .object({
      outcome: z.literal('failed'),
      retryable: z.boolean(),
      reasonCode: z.string().trim().min(1).max(100),
      message: z.string().trim().min(1).nullable(),
      sourceData: sourceDataSchema,
    })
    .strict(),
]);

export type TrackingResult = z.infer<typeof trackingResultSchema>;
