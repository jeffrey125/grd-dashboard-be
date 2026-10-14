import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { LogLevel } from '@config/env.schema.js';
import {
  ProjectLogger,
  type LogEvent,
  type LogFields,
} from './logging.types.js';

type WritableLevel = 'debug' | 'info' | 'warn' | 'error';

const SAFE_EVENT = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

class BoundProjectLogger extends ProjectLogger {
  constructor(
    protected readonly pino: PinoLogger,
    private readonly bindings: LogFields,
  ) {
    super();
  }

  debug(event: LogEvent, message: string, fields?: LogFields) {
    this.write('debug', event, message, fields);
  }

  info(event: LogEvent, message: string, fields?: LogFields) {
    this.write('info', event, message, fields);
  }

  warn(event: LogEvent, message: string, fields?: LogFields) {
    this.write('warn', event, message, fields);
  }

  error(event: LogEvent, message: string, fields?: LogFields) {
    this.write('error', event, message, fields);
  }

  child(fields: LogFields): ProjectLogger {
    return new BoundProjectLogger(this.pino, {
      ...this.bindings,
      ...fields,
    });
  }

  setLevel(level: LogLevel) {
    PinoLogger.root.level = level;
  }

  private write(
    level: WritableLevel,
    event: LogEvent,
    message: string,
    fields: LogFields = {},
  ) {
    if (!SAFE_EVENT.test(event)) {
      throw new TypeError(
        'Log event must be a lowercase dot-separated identifier',
      );
    }

    this.pino[level](
      {
        ...fields,
        ...this.bindings,
        event,
      },
      message,
    );
  }
}

@Injectable()
export class PinoLoggerService extends BoundProjectLogger {
  constructor(pino: PinoLogger) {
    super(pino, { component: 'application' });
  }
}
