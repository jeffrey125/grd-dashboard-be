import type { LogLevel } from '@config/env.schema.js';

export type LogRuntime = 'api' | 'worker';
export type LogEvent = `${string}.${string}`;

export interface LogFields {
  component?: string;
  carrierCode?: string;
  runExternalId?: string;
  shipmentExternalId?: string;
  trigger?: string;
  outcome?: string;
  durationMs?: number;
  retryable?: boolean;
  reasonCode?: string;
  candidateCount?: number;
  selectedCount?: number;
  attemptedCount?: number;
  succeededCount?: number;
  failedCount?: number;
  method?: string;
  route?: string;
  status?: number;
  port?: number;
  signal?: string;
  nestContext?: string;
  errorName?: string;
  errorCode?: string;
  errorStatus?: number;
  errorLocation?: string;
}

export abstract class ProjectLogger {
  abstract debug(event: LogEvent, message: string, fields?: LogFields): void;
  abstract info(event: LogEvent, message: string, fields?: LogFields): void;
  abstract warn(event: LogEvent, message: string, fields?: LogFields): void;
  abstract error(event: LogEvent, message: string, fields?: LogFields): void;
  abstract child(fields: LogFields): ProjectLogger;
  abstract setLevel(level: LogLevel): void;
}
