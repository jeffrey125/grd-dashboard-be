import { registerAs } from '@nestjs/config';
import { validateEnvironment, type LogLevel } from './env.schema.js';

const defaultLogLevel: Record<'development' | 'test' | 'production', LogLevel> =
  {
    development: 'debug',
    test: 'silent',
    production: 'info',
  };

export function createConfiguration(environment: Record<string, unknown>) {
  const env = validateEnvironment(environment);

  return {
    environment: env.NODE_ENV,
    quoteComparisonEnabled: env.QUOTE_COMPARISON_ENABLED === 'true',
    quoteDemo: env.QUOTE_DEMO_MODE === 'true',
    quoteScenarios: {
      amazon: env.QUOTE_DEMO_AMAZON,
      unishippers: env.QUOTE_DEMO_UNISHIPPERS,
    },
    logLevel: env.LOG_LEVEL ?? defaultLogLevel[env.NODE_ENV],
    port: env.PORT,
    database: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      username: env.DB_USER,
      password: env.DB_PASSWORD,
      sslMode: env.DB_SSL_MODE,
      sslCaFile: env.DB_SSL_CA_FILE,
    },
  };
}

export type RuntimeConfiguration = ReturnType<typeof createConfiguration>;

// Validation runs during Nest initialization, before either root accepts work.
export const configuration = registerAs('runtime', () =>
  createConfiguration(process.env),
);
