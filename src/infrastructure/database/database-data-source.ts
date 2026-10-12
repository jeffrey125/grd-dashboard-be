import { DataSource, type DataSourceOptions } from 'typeorm';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { DatabaseLogger } from './database-logger.js';

export class DatabaseDataSource extends DataSource {
  private readonly project: ProjectLogger;

  constructor(options: DataSourceOptions, logger: ProjectLogger) {
    const project = logger.child({ component: 'database' });
    super({
      ...options,
      logger: new DatabaseLogger(project),
      ...(options.type === 'postgres'
        ? {
            poolErrorHandler: () =>
              project.warn(
                'database.pool.error',
                'Database connection interrupted',
              ),
          }
        : {}),
    });
    this.project = project;
  }

  override async initialize(): Promise<this> {
    this.project.info('database.connecting', 'Connecting to database');
    try {
      await super.initialize();
      this.project.info('database.connected', 'Database connected');
      return this;
    } catch {
      this.project.error(
        'database.connection.failed',
        'Database connection failed',
      );
      // Nest's retry logger must never receive the original driver error.
      throw new Error('Database connection failed');
    }
  }

  override async destroy(): Promise<void> {
    try {
      await super.destroy();
      this.project.info('database.disconnected', 'Database disconnected');
    } catch {
      this.project.error(
        'database.disconnect.failed',
        'Database disconnect failed',
      );
      throw new Error('Database disconnect failed');
    }
  }
}
