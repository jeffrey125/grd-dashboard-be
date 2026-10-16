import { z } from 'zod';
import {
  shipmentRecordSchema,
  shipmentTabCountsSchema,
} from '@modules/shipments/shipments.schemas.js';

export const dashboardOverviewResponseSchema = z.strictObject({
  asOf: z.date(),
  timezone: z.literal('America/New_York'),
  upcomingWindow: z.strictObject({ from: z.iso.date(), to: z.iso.date() }),
  upcomingDeliveries: z.strictObject({
    total: z.int().nonnegative(),
    items: z.array(shipmentRecordSchema).max(5),
  }),
  counts: shipmentTabCountsSchema,
  attention: z.strictObject({
    total: z.int().nonnegative(),
    items: z.array(shipmentRecordSchema).max(5),
  }),
});
