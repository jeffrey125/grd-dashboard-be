import type { Observable } from 'rxjs';
import { z } from 'zod';

export const changeSchema = z
  .object({
    type: z.enum(['shipment.changed', 'run.changed']),
    externalId: z.uuid(),
  })
  .strict();
export type LiveEvent =
  { type: 'resync' | 'heartbeat' } | z.infer<typeof changeSchema>;
export abstract class EventsSource {
  abstract readonly events: Observable<LiveEvent>;
  abstract start(): void;
}
