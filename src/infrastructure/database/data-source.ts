import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from './database-options.js';

if (process.env.NODE_ENV !== 'test' && existsSync('.env')) loadEnvFile('.env');
const config = createConfiguration(process.env);

// The operator-invoked CLI intentionally retains TypeORM's complete diagnostics.
// Runtime API/worker connections use DatabaseDataSource's sanitized project logger.
export default new DataSource(createDatabaseOptions(config));
