import { ConfigModule } from '@nestjs/config';
import { authConfiguration } from '@modules/auth/auth.config.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  configuration,
  createConfiguration,
  type RuntimeConfiguration,
} from '@config/configuration.js';
import { NestLoggerAdapter } from '@infrastructure/logging/nest-logger.adapter.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { reportStartupError } from '@runtime/startup-error.js';
import { configureApiRoutes } from '@runtime/api-routing.js';

async function bootstrap() {
  // Fail before concurrent Nest providers can open a database pool. A rejected
  // configuration provider otherwise leaves another provider connecting in flight.
  await ConfigModule.envVariablesLoaded;
  createConfiguration(process.env);
  authConfiguration(process.env);

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    autoFlushLogs: false,
    abortOnError: false,
  });

  try {
    app.useLogger(app.get(NestLoggerAdapter));
    app.flushLogs();
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    configureApiRoutes(app);

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
