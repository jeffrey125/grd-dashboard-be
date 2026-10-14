import { z } from 'zod';
import { EchoShipFailure } from './echoship.failure.js';

const schema = z.object({
  ECHOSHIP_URL: z.url().refine((value) => {
    const url = new URL(value);

    return (
      url.origin === 'https://echoship.com' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }),
  ECHOSHIP_USERNAME: z
    .string()
    .min(1)
    .refine((value) => !!value.trim() && !/[\r\n:]/.test(value)),
  ECHOSHIP_PASSWORD: z
    .string()
    .min(1)
    .refine((value) => !!value.trim() && !/[\r\n]/.test(value)),
  ECHOSHIP_BROWSER_EXECUTABLE_PATH: z.string().trim().min(1).optional(),
});

export class EchoShipConfiguration {
  constructor(
    private readonly environment: Record<string, string | undefined>,
  ) {}

  read() {
    const parsed = schema.safeParse(this.environment);

    if (!parsed.success)
      throw new EchoShipFailure('ECHOSHIP_CONFIGURATION_INVALID', false);

    return {
      origin: 'https://echoship.com',
      loginUrl: parsed.data.ECHOSHIP_URL,
      username: parsed.data.ECHOSHIP_USERNAME,
      password: parsed.data.ECHOSHIP_PASSWORD,
      executablePath: parsed.data.ECHOSHIP_BROWSER_EXECUTABLE_PATH,
    };
  }
}

export type EchoShipSettings = ReturnType<EchoShipConfiguration['read']>;
