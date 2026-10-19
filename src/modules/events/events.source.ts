import type { Observable } from 'rxjs';
import { z } from 'zod';

const entityChangeSchema = z
  .object({
    type: z.enum(['shipment.changed', 'run.changed', 'quote.changed']),
    externalId: z.uuid(),
  })
  .strict();

const trackingChangeSchema = z
  .object({
    type: z.literal('tracking.changed'),
    externalId: z.uuid(),
    snapshotExternalId: z.uuid(),
    observedAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
  })
  .strict();

export const changeSchema = z.discriminatedUnion('type', [
  entityChangeSchema,
  trackingChangeSchema,
]);

export type LiveEvent =
  { type: 'resync' | 'heartbeat' } | z.infer<typeof changeSchema>;

export abstract class EventsSource {
  abstract readonly events: Observable<LiveEvent>;

  abstract start(): void;
}
