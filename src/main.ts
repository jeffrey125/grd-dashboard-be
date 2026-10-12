import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  configuration,
  type RuntimeConfiguration,
} from './config/configuration.js';
import { reportStartupError } from './runtime/startup-error.js';

async function bootstrap() {
  // Suppress raw framework errors until V1-017 supplies the safe logging bridge.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });

  try {
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    const config = app.get<RuntimeConfiguration>(configuration.KEY);
    await app.listen(config.port);
    console.info('API ready');
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

try {
  await bootstrap();
} catch (error) {
  reportStartupError(error);
}
