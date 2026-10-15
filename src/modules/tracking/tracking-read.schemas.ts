import { z } from 'zod';
import {
  normalizedTrackingStateSchema,
  trackingRunTriggerSchema,
} from './tracking.schemas.js';

export const trackingSnapshotRecordSchema =
  normalizedTrackingStateSchema.extend({
    externalId: z.uuidv4(),
    observedAt: z.date(),
  });

export const latestLookupRecordSchema = z.strictObject({
  runExternalId: z.uuidv4(),
  outcome: z.enum(['found', 'not_found', 'failed', 'skipped']),
  snapshotChanged: z.boolean(),
  retryable: z.boolean().nullable(),
  reasonCode: z.string().nullable(),
  completedAt: z.date(),
});

export const trackingRunRecordSchema = z.strictObject({
  externalId: z.uuidv4(),
  trigger: trackingRunTriggerSchema,
  fetchMode: z.enum(['request', 'browser']).nullable(),
  status: z.enum([
    'queued',
    'running',
    'succeeded',
    'partially_succeeded',
    'failed',
    'cancelled',
  ]),
  attemptCount: z.int().nonnegative(),
  createdAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});
