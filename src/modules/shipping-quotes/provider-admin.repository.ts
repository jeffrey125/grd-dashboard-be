import { z } from 'zod';
import { providerCode } from './quote.schemas.js';

export const executionMode = z.enum(['request', 'browser']);
export const providerSettingsInput = z.strictObject({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  executionMode,
  maintenanceMessage: z.string().trim().max(500).nullable(),
  staleHours: z.number().int().min(1).max(168),
  connectionTestId: z.uuid().optional(),
  acknowledgeFailure: z.boolean().default(false),
});
export const readinessInput = z.strictObject({ executionMode });
export type ProviderSettingsInput = z.infer<typeof providerSettingsInput>;
export type ReadinessWork = {
  id: string;
  code: z.infer<typeof providerCode>;
  mode: z.infer<typeof executionMode>;
};
export type ReadinessFailure = 'readiness_failed' | 'readiness_timeout';

export abstract class ProviderAdminRepository {
  abstract settings(): Promise<unknown[]>;
  abstract save(
    code: string,
    input: ProviderSettingsInput,
    actorId: number,
  ): Promise<void>;
  abstract enqueue(
    code: string,
    mode: ReadinessWork['mode'],
    actorId: number,
  ): Promise<unknown>;
  abstract result(code: string, id: string, actorId: number): Promise<unknown>;
  abstract claim(): Promise<ReadinessWork | null>;
  abstract finish(
    work: ReadinessWork,
    failure: ReadinessFailure | null,
  ): Promise<void>;
}
