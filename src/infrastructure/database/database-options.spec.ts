import { describe, expect, it } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import { testEnvironment } from '@test/support/environment.js';
import { createDatabaseOptions } from './database-options.js';

describe('shared database configuration', () => {
  it('requires certificate and hostname verification when TLS is selected', () => {
    const options = createDatabaseOptions(
      createConfiguration({
        ...testEnvironment,
        DB_SSL_MODE: 'verify-full',
      }),
    );

    expect(options).toMatchObject({ ssl: { rejectUnauthorized: true } });
  });

  it('rejects insecure modes and CA files without TLS', () => {
    for (const DB_SSL_MODE of ['require', 'prefer', 'no-verify', 'invalid']) {
      expect(() =>
        createConfiguration({ ...testEnvironment, DB_SSL_MODE }),
      ).toThrow('DB_SSL_MODE');
    }

    expect(() =>
      createConfiguration({
        ...testEnvironment,
        DB_SSL_CA_FILE: '/private/canary.pem',
      }),
    ).toThrow('DB_SSL_CA_FILE');
  });

  it('reports unreadable or invalid CA configuration without retaining paths or content', () => {
    let failure: unknown;

    try {
      createDatabaseOptions(
        createConfiguration({
          ...testEnvironment,
          DB_SSL_MODE: 'verify-full',
          DB_SSL_CA_FILE: '/private/CANARY_CA_PATH.pem',
        }),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain('DB_SSL_CA_FILE');
    expect(String(failure)).not.toContain('CANARY');
    expect(failure).not.toHaveProperty('cause');
  });

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
