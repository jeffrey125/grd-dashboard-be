import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgresqlContainer } from '../support/postgresql-container.js';

describe('PostgreSQL container support', () => {
  let container: StartedPostgreSqlContainer | undefined;

  beforeAll(async () => {
    container = await startPostgresqlContainer();
  });

  afterAll(async () => {
    await container?.stop();
  });

  it('executes SQL against a real PostgreSQL server', async () => {
    if (!container) throw new Error('PostgreSQL container did not start');

    // Use the image's client until V1-004 introduces the application pg driver.
    const result = await container.exec([
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      container.getUsername(),
      '-d',
      container.getDatabase(),
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      'SELECT 1',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('1');
  });
});
