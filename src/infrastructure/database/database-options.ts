import { fileURLToPath } from 'node:url';
import type { DataSourceOptions } from 'typeorm';
import type { RuntimeConfiguration } from '@config/configuration.js';
import { databaseTls } from './database-tls.js';

export function createDatabaseOptions(
  config: RuntimeConfiguration,
): DataSourceOptions {
  const { sslMode, sslCaFile, ...database } = config.database;

  // Resolve from this module, not the CLI's working directory. Only compiled
  // production entities/migrations are discovered; test fixtures stay separate.
  return {
    type: 'postgres',
    ...database,
    ssl: databaseTls(sslMode, sslCaFile),
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    installExtensions: false,
    uuidExtension: 'pgcrypto',
    logging: false,
    entities: [
      fileURLToPath(new URL('../../modules/**/*.entity.js', import.meta.url)),
    ],
    migrations: [fileURLToPath(new URL('./migrations/*.js', import.meta.url))],
    migrationsTransactionMode: 'all',
    connectTimeoutMS: 5000,
    poolSize: 10,
    extra: {
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 6000,
    },
  };
}
