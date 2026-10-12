import { z } from 'zod';

const port = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.int().min(1).max(65535));
const requiredText = z.string().trim().min(1);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: port.default(3000),
  DB_HOST: requiredText,
  DB_PORT: port.default(5432),
  DB_NAME: requiredText,
  DB_USER: requiredText,
  // Preserve the password verbatim, including leading/trailing whitespace.
  DB_PASSWORD: z.string().refine((value) => value.trim().length > 0),
});

const guidance: Record<keyof z.infer<typeof environmentSchema>, string> = {
  NODE_ENV: 'must be development, test, or production',
  PORT: 'must be an integer from 1 to 65535',
  DB_HOST: 'is required and must not be blank',
  DB_PORT: 'must be an integer from 1 to 65535',
  DB_NAME: 'is required and must not be blank',
  DB_USER: 'is required and must not be blank',
  DB_PASSWORD: 'is required and must not be blank',
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
