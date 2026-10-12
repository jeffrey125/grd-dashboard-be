import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RuntimeConfigModule } from '@config/config.module.js';
import {
  configuration,
  type RuntimeConfiguration,
} from '@config/configuration.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { createDatabaseOptions } from './database-options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { DatabaseLogger } from './database-logger.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [configuration.KEY, ProjectLogger],
      useFactory: (config: RuntimeConfiguration, logger: ProjectLogger) => ({
        ...createDatabaseOptions(config),
        logger: new DatabaseLogger(logger),
        retryAttempts: 3,
        retryDelay: 1000,
        verboseRetryLog: false,
      }),
      dataSourceFactory: async (options) => {
        if (!options || !(options.logger instanceof DatabaseLogger)) {
          throw new Error('Missing database logger');
        }
        return new DatabaseDataSource(options, options.logger.project);
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
