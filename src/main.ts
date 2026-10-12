import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  configuration,
  type RuntimeConfiguration,
} from '@config/configuration.js';
import { NestLoggerAdapter } from '@infrastructure/logging/nest-logger.adapter.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { reportStartupError } from '@runtime/startup-error.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    autoFlushLogs: false,
    abortOnError: false,
  });

  try {
    app.useLogger(app.get(NestLoggerAdapter));
    app.flushLogs();
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    const config = app.get<RuntimeConfiguration>(configuration.KEY);
    await app.listen(config.port);
    app
      .get(ProjectLogger)
      .info('application.ready', 'API ready', { port: config.port });
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

try {
  await bootstrap();
} catch (error) {
  reportStartupError(error, 'api');
}
