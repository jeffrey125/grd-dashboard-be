import { DynamicModule, Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { RuntimeConfigModule } from '../../config/config.module.js';
import {
  configuration,
  type RuntimeConfiguration,
} from '../../config/configuration.js';
import { createPinoHttpOptions } from './logging.options.js';
import { ApplicationLifecycleLogger } from './application-lifecycle-logger.js';
import { ProjectLogger, type LogRuntime } from './logging.types.js';
import { NestLoggerAdapter } from './nest-logger.adapter.js';
import { PinoLoggerService } from './pino-logger.service.js';

@Global()
@Module({})
export class LoggingModule {
  static forRoot(runtime: LogRuntime): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        RuntimeConfigModule,
        LoggerModule.forRootAsync({
          imports: [RuntimeConfigModule],
          inject: [configuration.KEY],
          useFactory: (runtimeConfiguration: RuntimeConfiguration) => ({
            pinoHttp: createPinoHttpOptions(runtimeConfiguration, runtime),
          }),
        }),
      ],
      providers: [
        PinoLoggerService,
        { provide: ProjectLogger, useExisting: PinoLoggerService },
        NestLoggerAdapter,
        ApplicationLifecycleLogger,
      ],
      exports: [ProjectLogger, NestLoggerAdapter],
    };
  }
}
