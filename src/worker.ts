import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestLoggerAdapter } from './infrastructure/logging/nest-logger.adapter.js';
import { ProjectLogger } from './infrastructure/logging/logging.types.js';
import { ReadinessService } from './modules/health/readiness.service.js';
import { reportStartupError } from './runtime/startup-error.js';

let app: INestApplicationContext | undefined;
try {
  const { WorkerModule } = await import('./worker.module.js');
  app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    autoFlushLogs: false,
    abortOnError: false,
  });
  app.useLogger(app.get(NestLoggerAdapter));
  app.flushLogs();
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  await app.get(ReadinessService).check();
  app.get(ProjectLogger).info('application.ready', 'Worker ready');
} catch (error) {
  await app?.close().catch(() => undefined);
  reportStartupError(error, 'worker');
}
