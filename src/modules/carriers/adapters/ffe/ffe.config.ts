import { z } from 'zod';
import { FfeFailure } from './ffe.failure.js';

export const FFE_ORIGIN = 'https://www.ffeinc.com';
const schema = z.object({
  FFE_URL: z.url().refine((value) => {
    const url = new URL(value);

    return (
      url.origin === FFE_ORIGIN &&
      url.pathname === '/Customer/ShipmentTracking' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  FFE_USERNAME: z
    .string()
    .min(1)
    .refine((value) => !!value.trim() && !/[\r\n]/.test(value)),
  FFE_PASSWORD: z
    .string()
    .min(1)
    .refine((value) => !!value.trim() && !/[\r\n]/.test(value)),
  FFE_BROWSER_EXECUTABLE_PATH: z.string().trim().min(1).optional(),
});

export class FfeConfiguration {
  constructor(
    private readonly environment: Record<string, string | undefined>,
  ) {}

  read() {
    const parsed = schema.safeParse(this.environment);

    if (!parsed.success)
      throw new FfeFailure('FFE_CONFIGURATION_INVALID', false);

    return {
      origin: FFE_ORIGIN,
      username: parsed.data.FFE_USERNAME,
      password: parsed.data.FFE_PASSWORD,
      executablePath: parsed.data.FFE_BROWSER_EXECUTABLE_PATH,
    };
  }
}

export type FfeSettings = ReturnType<FfeConfiguration['read']>;
