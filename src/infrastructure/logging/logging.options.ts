import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LoggerOptions } from 'pino';
import type { Options } from 'pino-http';
import type { RuntimeConfiguration } from '@config/configuration.js';
import type { LogLevel } from '@config/env.schema.js';
import { APPLICATION_NAME, REQUEST_ID_HEADER } from '@app/constants.js';
import type { LogRuntime } from './logging.types.js';

export const LOG_REDACTION_CENSOR = '[Redacted]';

const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwords',
  'token',
  'tokens',
  'accessToken',
  'refreshToken',
  'approvalToken',
  'secret',
  'secrets',
  'clientSecret',
  'apiKey',
  'authorization',
  'proxyAuthorization',
  'proxy-authorization',
  'cookie',
  'cookies',
  'setCookie',
  'set-cookie',
  'csrfToken',
  'session',
  'sessionId',
  'credentials',
  'credential',
  'headers',
  'requestHeaders',
  'responseHeaders',
  'body',
  'requestBody',
  'responseBody',
  'payload',
  'requestPayload',
  'responsePayload',
  'trackingReference',
  'trackingReferences',
  'trackingNumber',
  'trackingNumbers',
  'contact',
  'contacts',
  'person',
  'people',
  'email',
  'phone',
  'firstName',
  'lastName',
  'address',
  'source_data',
  'sourceData',
  'rawProviderData',
  'providerResponse',
  'browserState',
  'browserArtifact',
  'browserArtifacts',
] as const;

const REDACTION_MAX_PARENT_DEPTH = 6;

function redactionPath(field: string, parentDepth: number) {
  const property = field.includes('-') ? `["${field}"]` : field;
  if (parentDepth === 0) return property;
  const parents = Array.from({ length: parentDepth }, () => '*').join('.');
  return field.includes('-')
    ? `${parents}${property}`
    : `${parents}.${property}`;
}

export const REDACTED_LOG_PATHS = SENSITIVE_FIELD_NAMES.flatMap((field) =>
  Array.from({ length: REDACTION_MAX_PARENT_DEPTH + 1 }, (_, parentDepth) =>
    redactionPath(field, parentDepth),
  ),
);

export function createBaseLoggingOptions(
  environment: string,
  runtime: LogRuntime,
  level: LogLevel,
): LoggerOptions {
  return {
    level,
    base: {
      service: APPLICATION_NAME,
      environment,
      runtime,
    },
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: REDACTED_LOG_PATHS,
      censor: LOG_REDACTION_CENSOR,
    },
  };
}

type HttpRequest = IncomingMessage & {
  baseUrl?: unknown;
  route?: { path?: unknown };
};

function routeTemplate(request: HttpRequest) {
  const path = request.route?.path;
  if (
    typeof path !== 'string' ||
    path.includes('*splat') ||
    path.includes('*path')
  ) {
    return 'unmatched';
  }
  const baseUrl = typeof request.baseUrl === 'string' ? request.baseUrl : '';
  return `${baseUrl}${path}` || '/';
}

function safeMethod(request: IncomingMessage) {
  const method = request.method;
  return typeof method === 'string' && /^[A-Z]{1,16}$/.test(method)
    ? method
    : 'UNKNOWN';
}

function requestFields(
  request: HttpRequest,
  response: ServerResponse,
  value: object,
) {
  const duration = (value as Record<string, unknown>).durationMs;
  return {
    component: 'http',
    event: 'api.request.completed',
    method: safeMethod(request),
    route: routeTemplate(request),
    status: response.statusCode,
    durationMs: typeof duration === 'number' ? duration : 0,
  };
}

function requestLevel(
  request: HttpRequest,
  response: ServerResponse,
  error?: Error,
) {
  const route = routeTemplate(request);
  if (route === '/health/live' || route === '/health/ready') {
    return response.statusCode < 400 && !error ? 'debug' : 'warn';
  }
  if (error || response.statusCode >= 500) return 'error';
  if (response.statusCode >= 400) return 'warn';
  return 'info';
}

export function createPinoHttpOptions(
  configuration: RuntimeConfiguration,
  runtime: LogRuntime,
): Options<HttpRequest, ServerResponse> {
  return {
    ...createBaseLoggingOptions(
      configuration.environment,
      runtime,
      configuration.logLevel,
    ),
    genReqId: (_request, response) => {
      const requestId = randomUUID();
      response.setHeader(REQUEST_ID_HEADER, requestId);
      return requestId;
    },
    quietReqLogger: true,
    quietResLogger: true,
    customAttributeKeys: {
      reqId: 'requestId',
      responseTime: 'durationMs',
    },
    customLogLevel: requestLevel,
    customSuccessObject: requestFields,
    customErrorObject: (request, response, _error, value) =>
      requestFields(request, response, value),
    customSuccessMessage: () => 'API request completed',
    customErrorMessage: () => 'API request completed',
  };
}
