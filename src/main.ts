import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  configuration,
  type RuntimeConfiguration,
} from './config/configuration.js';
import { reportStartupError } from './runtime/startup-error.js';

let app: INestApplication | undefined;
try {
  const { AppModule } = await import('./app.module.js');
  // Suppress raw framework errors until V1-017 supplies the safe logging bridge.
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  const config = app.get<RuntimeConfiguration>(configuration.KEY);
  await app.listen(config.port);
  console.info('API ready');
} catch (error) {
  await app?.close().catch(() => undefined);
  reportStartupError(error);
}
