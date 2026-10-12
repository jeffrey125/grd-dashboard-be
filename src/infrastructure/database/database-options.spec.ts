import { describe, expect, it } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import { testEnvironment } from '@test/support/environment.js';
import { createDatabaseOptions } from './database-options.js';

describe('shared database configuration', () => {
  it('uses validated credentials without permitting automatic schema changes', () => {
    const options = createDatabaseOptions(createConfiguration(testEnvironment));
    expect(options).toMatchObject({
      type: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      database: 'runtime_test',
      username: 'runtime_test',
      password: 'fixture-password',
      synchronize: false,
      migrationsRun: false,
      dropSchema: false,
      logging: false,
      ssl: false,
      connectTimeoutMS: 5000,
    });
    expect(options.entities).not.toEqual(
      expect.arrayContaining([expect.stringContaining('test/')]),
    );
  });
});
