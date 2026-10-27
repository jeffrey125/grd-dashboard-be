import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import pino from 'pino';
import { createConfiguration } from '@config/configuration.js';
import { WorkerOwnership } from '@infrastructure/database/worker-ownership.js';
import { NestLoggerAdapter } from '@infrastructure/logging/nest-logger.adapter.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { createBaseLoggingOptions } from '@infrastructure/logging/logging.options.js';
import { ReadinessService } from '@modules/health/readiness.service.js';
import { TrackingSchedulerService } from '@modules/tracking/tracking-scheduler.service.js';
import { reportStartupError } from '@runtime/startup-error.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  // RuntimeConfigModule has loaded the native .env before this entrypoint runs.
  const config = createConfiguration(process.env);
  const logger = pino(
    createBaseLoggingOptions(config.environment, 'worker', config.logLevel),
  );
  const shutdown = new AbortController();
  let initializing: Promise<INestApplicationContext> | undefined;
  let app: INestApplicationContext | undefined;
  let stopping = false;

  const ownership = new WorkerOwnership(config.database, () => {
    logger.fatal(
      { event: 'worker.ownership.lost' },
      'Worker database ownership lost; terminating immediately',
    );
    // Do not drain or reconnect: running work must not continue without ownership.
    // As the container entrypoint exits, its browser children are also terminated.
    process.exit(1);
  });

  const stop = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    shutdown.abort();
    logger.info({ event: 'application.stopping', signal }, 'Worker stopping');
    const deadline = setTimeout(() => {
      logger.error(
        { event: 'worker.shutdown.timeout' },
        'Worker shutdown exceeded 40 seconds; terminating',
      );
      process.exit(1);
    }, 40_000);

    try {
      app ??= await initializing;
      await app?.close();
      if (!app)
        logger.info(
          { event: 'application.stopped' },
          'Worker stopped before initialization',
        );
      // Keep the advisory session open until OS process teardown. Some existing
      // hooks have bounded drains; releasing earlier could overlap remaining work.
      process.exit(0);
    } catch {
      process.exit(1);
    } finally {
      clearTimeout(deadline);
    }
  };

  process.once('SIGINT', () => {
    void stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    void stop('SIGTERM');
  });

  try {
    logger.info(
      { event: 'worker.ownership.connecting' },
      'Connecting worker ownership session',
    );
    await ownership.acquire(shutdown.signal, () => {
      logger.info(
        { event: 'worker.ownership.waiting' },
        'Waiting for the previous worker to stop',
      );
    });
    shutdown.signal.throwIfAborted();
    logger.info(
      { event: 'worker.ownership.acquired' },
      'Exclusive worker ownership acquired',
    );
    // No module lifecycle hooks, recovery, timers, or carrier work before the lock.
    initializing = NestFactory.createApplicationContext(WorkerModule, {
      bufferLogs: true,
      autoFlushLogs: false,
      abortOnError: false,
    });
    app = await initializing;
    if (stopping) return;
    app.useLogger(app.get(NestLoggerAdapter));
    app.flushLogs();
    await app.get(ReadinessService).check();
    if (stopping) return;
    const scheduler = app.get(TrackingSchedulerService);
    await scheduler.start();
    const health = setInterval(() => {
      if (!stopping && scheduler.status().state === 'failed') {
        logger.fatal(
          { event: 'worker.scheduler.failed' },
          'Tracking scheduler failed; terminating for restart',
        );
        process.exit(1);
      }
    }, 1000);
    health.unref();
    if (!stopping)
      app.get(ProjectLogger).info('application.ready', 'Worker ready');
  } catch (error) {
    if (stopping) return;
    reportStartupError(error, 'worker');
    // Failed initialization may already have started module timers. Exit while
    // retaining ownership instead of letting those timers outlive the lock.
    process.exit(1);
  }
}

try {
  await bootstrap();
} catch (error) {
  reportStartupError(error, 'worker');
  process.exit(1);
}
