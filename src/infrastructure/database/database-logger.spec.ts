import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'typeorm';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { DatabaseLogger } from './database-logger.js';

describe('database log safety', () => {
  it('omits SQL, parameters, driver errors and arbitrary schema messages', () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const bridge: Logger = new DatabaseLogger(
      logger as unknown as ProjectLogger,
    );
    const secret = 'CANARY_DATABASE_SECRET';

    bridge.logQuery(`SELECT '${secret}'`, [secret]);
    bridge.logQueryError(new Error(secret), `SELECT '${secret}'`, [secret]);
    bridge.logQuerySlow(100, secret, [secret]);
    bridge.log('warn', { password: secret });
    bridge.logSchemaBuild(`Migration failed: ${secret}`);
    bridge.logMigration(secret);

    expect(
      JSON.stringify(Object.values(logger).map((method) => method.mock.calls)),
    ).not.toContain(secret);
    expect(logger.error).toHaveBeenCalledWith(
      'database.query.failed',
      'Database query failed',
    );

    bridge.logSchemaBuild('[ ] ProofMigration1791800000000');

    expect(logger.info).toHaveBeenCalledWith(
      'database.migration.status',
      '[ ] ProofMigration1791800000000',
    );
  });
});
