import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ProjectLogger } from './logging.types.js';

@Injectable()
export class ApplicationLifecycleLogger implements OnApplicationShutdown {
  constructor(@Inject(ProjectLogger) private readonly logger: ProjectLogger) {}

  async onApplicationShutdown(signal?: string) {
    this.logger.info(
      'application.stopped',
      'Application stopped',
      signal ? { signal } : {},
    );
    await new Promise<void>((resolve, reject) => {
      PinoLogger.root.flush((error) => {
        const streamError = error as NodeJS.ErrnoException | undefined;
        // SonicBoom calls fsync after draining. stdout pipes cannot be synced,
        // but their writes have already completed when this callback runs.
        if (
          !streamError ||
          (streamError.code === 'EINVAL' && streamError.syscall === 'fsync')
        ) {
          resolve();
          return;
        }
        reject(new Error('Application log flush failed'));
      });
    });
  }
}
