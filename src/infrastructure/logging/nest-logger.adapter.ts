import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { Logger as NestPinoLogger } from 'nestjs-pino';
import {
  configuration,
  type RuntimeConfiguration,
} from '../../config/configuration.js';
import { ProjectLogger, type LogFields } from './logging.types.js';
import { safeErrorFields } from './safe-error-fields.js';

const SAFE_NEST_CONTEXT = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

function nestContext(optionalParams: unknown[]): string | undefined {
  const candidate = optionalParams.at(-1);
  return typeof candidate === 'string' && SAFE_NEST_CONTEXT.test(candidate)
    ? candidate
    : undefined;
}

@Injectable()
export class NestLoggerAdapter implements LoggerService {
  private readonly logger: ProjectLogger;

  constructor(
    @Inject(ProjectLogger) projectLogger: ProjectLogger,
    private readonly nativeLogger: NestPinoLogger,
    @Inject(configuration.KEY)
    private readonly runtimeConfiguration: RuntimeConfiguration,
  ) {
    this.logger = projectLogger.child({ component: 'nest' });
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    if (this.isDevelopment()) {
      this.nativeLogger.log(message, ...optionalParams);
      return;
    }
    this.logger.info(
      'nest.lifecycle',
      typeof message === 'string' ? message : 'Nest framework lifecycle event',
      this.contextFields(optionalParams),
    );
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    if (this.isDevelopment()) {
      this.nativeLogger.debug(message, ...optionalParams);
      return;
    }
    this.logger.debug(
      'nest.debug',
      typeof message === 'string' ? message : 'Nest framework debug event',
      this.contextFields(optionalParams),
    );
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    if (this.isDevelopment()) {
      // nestjs-pino maps verbose to trace, below the local debug default.
      this.nativeLogger.debug(message, ...optionalParams);
      return;
    }
    this.logger.debug(
      'nest.verbose',
      typeof message === 'string' ? message : 'Nest framework verbose event',
      this.contextFields(optionalParams),
    );
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    if (this.isDevelopment()) {
      this.nativeLogger.warn(message, ...optionalParams);
      return;
    }
    this.logger.warn(
      'nest.warning',
      'Nest framework warning',
      this.failureFields(message, optionalParams),
    );
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    if (this.isDevelopment()) {
      this.nativeLogger.error(message, ...optionalParams);
      return;
    }
    this.logger.error(
      'nest.error',
      'Nest framework operation failed',
      this.failureFields(message, optionalParams),
    );
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    if (this.isDevelopment()) {
      this.nativeLogger.fatal(message, ...optionalParams);
      return;
    }
    this.logger.error(
      'nest.fatal',
      'Nest framework fatal error',
      this.failureFields(message, optionalParams),
    );
  }

  private isDevelopment() {
    return this.runtimeConfiguration.environment === 'development';
  }

  private contextFields(optionalParams: unknown[]): LogFields {
    const context = nestContext(optionalParams);
    return context ? { nestContext: context } : {};
  }

  private failureFields(
    message: unknown,
    optionalParams: unknown[],
  ): LogFields {
    return {
      ...this.contextFields(optionalParams),
      ...safeErrorFields(message),
    };
  }
}
