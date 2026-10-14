import { z } from 'zod';
import { UpsFailure } from './ups.failure.js';

const schema = z.object({
  UPS_ENVIRONMENT: z.enum(['cie', 'production']).default('cie'),
  UPS_CLIENT_ID: z
    .string()
    .refine((value) => value.trim().length > 0 && !/[\r\n:]/.test(value)),
  UPS_CLIENT_SECRET: z
    .string()
    .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value)),
});

/** Lazy validation: missing credentials must not break the API or a disabled UPS adapter. */
export class UpsConfiguration {
  constructor(
    private readonly environment: Record<string, string | undefined>,
  ) {}

  get minimumIntervalMinutes(): number {
    return this.environment.UPS_ENVIRONMENT === 'production' ? 30 : 60;
  }

  read() {
    const parsed = schema.safeParse(this.environment);

    if (!parsed.success)
      throw new UpsFailure(
        'UPS_CONFIGURATION_INVALID',
        false,
        'UPS requires a valid environment, client ID, and client secret.',
      );

    const env = parsed.data;

    return {
      environment: env.UPS_ENVIRONMENT,
      origin:
        env.UPS_ENVIRONMENT === 'production'
          ? 'https://onlinetools.ups.com'
          : 'https://wwwcie.ups.com',
      clientId: env.UPS_CLIENT_ID,
      clientSecret: env.UPS_CLIENT_SECRET,
      maximumRpm: env.UPS_ENVIRONMENT === 'production' ? 10 : 5,
    };
  }
}
