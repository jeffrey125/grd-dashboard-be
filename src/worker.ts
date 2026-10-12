import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ReadinessService } from './modules/health/readiness.service.js';
import { reportStartupError } from './runtime/startup-error.js';

let app: INestApplicationContext | undefined;
try {
  const { WorkerModule } = await import('./worker.module.js');
  app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
    abortOnError: false,
  });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  await app.get(ReadinessService).check();
  console.info('Worker ready');
} catch (error) {
  await app?.close().catch(() => undefined);
  reportStartupError(error);
}
