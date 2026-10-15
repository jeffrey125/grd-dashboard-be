import { z } from 'zod';
import {
  shipmentRecordSchema,
  shipmentTabCountsSchema,
} from '@modules/shipments/shipments.schemas.js';
import { trackingSnapshotRecordSchema } from '@modules/tracking/tracking-read.schemas.js';

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dashboardOverviewResponseSchema = z.strictObject({
  asOf: z.date(),
  timezone: z.literal('America/New_York'),
  upcomingWindow: z.strictObject({
    from: calendarDateSchema,
    to: calendarDateSchema,
  }),
  counts: shipmentTabCountsSchema,
  attention: z.strictObject({
    total: z.int().nonnegative(),
    items: z.array(shipmentRecordSchema).max(10),
  }),
  upcomingDeliveries: z.strictObject({
    total: z.int().nonnegative(),
    items: z.array(shipmentRecordSchema).max(10),
  }),
  recentChanges: z
    .array(
      z.strictObject({
        shipmentExternalId: z.uuidv4(),
        trackingReference: z.string(),
        carrier: z.strictObject({
          externalId: z.uuidv4(),
          code: z.string(),
          name: z.string(),
        }),
        snapshot: trackingSnapshotRecordSchema,
      }),
    )
    .max(10),
});
