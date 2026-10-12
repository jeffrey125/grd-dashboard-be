import pino from 'pino';
import { ConfigurationError } from '../../config/env.schema.js';
import type { LogRuntime } from './logging.types.js';
import { createBaseLoggingOptions } from './logging.options.js';
import { safeErrorFields } from './safe-error-fields.js';

function safeEnvironment() {
  const environment = process.env.NODE_ENV;
  return environment === 'development' ||
    environment === 'test' ||
    environment === 'production'
    ? environment
    : 'unknown';
}

export function logStartupFailure(error: unknown, runtime: LogRuntime) {
  const logger = pino(
    createBaseLoggingOptions(safeEnvironment(), runtime, 'error'),
  );
  logger.error(
    {
      component: 'application',
      event: 'application.startup.failed',
      ...safeErrorFields(error),
    },
    error instanceof ConfigurationError
      ? error.message
      : 'Application startup failed. Check runtime configuration and port availability.',
  );
  logger.flush();
}
