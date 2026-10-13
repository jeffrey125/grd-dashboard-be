import { NestFactory } from '@nestjs/core';
import { NestLoggerAdapter } from '@infrastructure/logging/nest-logger.adapter.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { ReadinessService } from '@modules/health/readiness.service.js';
import { TrackingSchedulerService } from '@modules/tracking/tracking-scheduler.service.js';
import { reportStartupError } from '@runtime/startup-error.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    autoFlushLogs: false,
    abortOnError: false,
  });

  try {
    app.useLogger(app.get(NestLoggerAdapter));
    app.flushLogs();
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    await app.get(ReadinessService).check();
    await app.get(TrackingSchedulerService).start();
    app.get(ProjectLogger).info('application.ready', 'Worker ready');
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

try {
  await bootstrap();
} catch (error) {
  reportStartupError(error, 'worker');
}
