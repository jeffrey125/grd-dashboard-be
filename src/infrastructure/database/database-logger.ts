import type { Logger } from 'typeorm';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';

/** Never forwards SQL, parameters, driver messages, or arbitrary metadata. */
export class DatabaseLogger implements Logger {
  constructor(readonly project: ProjectLogger) {}
  logQuery() {}
  logQueryError() {
    this.project.error('database.query.failed', 'Database query failed');
  }
  logQuerySlow() {
    this.project.warn(
      'database.query.slow',
      'Database query exceeded its duration threshold',
    );
  }
  logSchemaBuild(message: string) {
    // Only migration status lines have a reviewed, bounded grammar. Other
    // TypeORM schema messages can embed SQL or driver-supplied values.
    if (
      /^\[(?:X| )\] (?:\d+ )?[A-Za-z][A-Za-z0-9_]{0,180}\d{13}$/.test(message)
    ) {
      this.project.info('database.migration.status', message);
    } else {
      this.project.info(
        'database.schema.progress',
        'Database schema operation progressed',
      );
    }
  }
  logMigration() {
    this.project.info(
      'database.migration.progress',
      'Database migration progressed',
    );
  }
  log(level: 'log' | 'info' | 'warn') {
    if (level === 'warn')
      this.project.warn('database.driver.warning', 'Database driver warning');
  }
}
