import { registerAs } from '@nestjs/config';
import { validateEnvironment } from './env.schema.js';

export function createConfiguration(environment: Record<string, unknown>) {
  const env = validateEnvironment(environment);
  return {
    environment: env.NODE_ENV,
    port: env.PORT,
    database: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      username: env.DB_USER,
      password: env.DB_PASSWORD,
    },
  };
}

export type RuntimeConfiguration = ReturnType<typeof createConfiguration>;

// Validation runs during Nest initialization, before either root accepts work.
export const configuration = registerAs('runtime', () =>
  createConfiguration(process.env),
);
