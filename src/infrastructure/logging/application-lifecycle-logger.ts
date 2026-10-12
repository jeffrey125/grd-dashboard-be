import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ProjectLogger } from './logging.types.js';

@Injectable()
export class ApplicationLifecycleLogger implements OnApplicationShutdown {
  constructor(@Inject(ProjectLogger) private readonly logger: ProjectLogger) {}

  onApplicationShutdown(signal?: string) {
    this.logger.info(
      'application.stopped',
      'Application stopped',
      signal ? { signal } : {},
    );
    PinoLogger.root.flush();
  }
}
