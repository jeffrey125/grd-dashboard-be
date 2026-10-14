import { z } from 'zod';

const port = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.int().min(1).max(65535));
const requiredText = z.string().trim().min(1);

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
    PORT: port.default(3000),
    DB_HOST: requiredText,
    DB_PORT: port.default(5432),
    DB_NAME: requiredText,
    DB_USER: requiredText,
    // Preserve the password verbatim, including leading/trailing whitespace.
    DB_PASSWORD: z.string().refine((value) => value.trim().length > 0),
    DB_SSL_MODE: z.enum(['disable', 'verify-full']).default('disable'),
    DB_SSL_CA_FILE: z
      .string()
      .trim()
      .transform((value) => value || undefined)
      .optional(),
  })
  .refine((env) => !env.DB_SSL_CA_FILE || env.DB_SSL_MODE === 'verify-full', {
    path: ['DB_SSL_CA_FILE'],
  });

const guidance: Record<keyof z.infer<typeof environmentSchema>, string> = {
  NODE_ENV: 'must be development, test, or production',
  LOG_LEVEL: 'must be debug, info, warn, error, or silent',
  PORT: 'must be an integer from 1 to 65535',
  DB_HOST: 'is required and must not be blank',
  DB_PORT: 'must be an integer from 1 to 65535',
  DB_NAME: 'is required and must not be blank',
  DB_USER: 'is required and must not be blank',
  DB_PASSWORD: 'is required and must not be blank',
  DB_SSL_MODE: 'must be disable or verify-full',
  DB_SSL_CA_FILE:
    'requires verify-full and a readable PEM certificate bundle of at most 64 KiB',
};

export class ConfigurationError extends Error {
  constructor(fields: (keyof typeof guidance)[]) {
    super(
      `Invalid configuration: ${fields.map((field) => `${field} ${guidance[field]}`).join('; ')}`,
    );
    this.name = 'ConfigurationError';
  }
}

export function validateEnvironment(environment: Record<string, unknown>) {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    // Do not retain the Zod error, input, cause, or arbitrary issue messages.
    const fields = Object.keys(guidance).filter((field) =>
      result.error.issues.some((issue) => issue.path[0] === field),
    ) as (keyof typeof guidance)[];

    throw new ConfigurationError(fields);
  }

  return result.data;
}
