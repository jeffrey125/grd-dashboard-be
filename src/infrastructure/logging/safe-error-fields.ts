const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const ERROR_LOCATION = /(?:file:\/\/)?([^\s()]+:\d+:\d+)/;
const APPLICATION_SOURCE = /(?:^|\/)(src|test|scripts)\//;

export interface SafeErrorFields {
  errorName: string;
  errorCode?: string;
  errorStatus?: number;
  errorLocation?: string;
}

function readProperty(error: Error, key: string): unknown {
  try {
    return (error as unknown as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeName(error: Error) {
  const name = readProperty(error, 'name');
  return typeof name === 'string' && SAFE_IDENTIFIER.test(name)
    ? name
    : 'Error';
}

function safeCode(error: Error) {
  const code = readProperty(error, 'code');
  return typeof code === 'string' && SAFE_IDENTIFIER.test(code)
    ? code
    : undefined;
}

function safeStatus(error: Error) {
  const httpStatus = readProperty(error, 'httpStatus');
  const status =
    typeof httpStatus === 'number' ? httpStatus : readProperty(error, 'status');
  return typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : undefined;
}

function safeLocation(error: Error) {
  const stack = readProperty(error, 'stack');
  if (typeof stack !== 'string') return undefined;

  for (const line of stack.split('\n').slice(1)) {
    const location = line.match(ERROR_LOCATION)?.[1];
    if (!location || location.includes('node_modules')) continue;
    const sourceStart = location.search(APPLICATION_SOURCE);
    if (sourceStart >= 0) return location.slice(sourceStart);
  }
  return undefined;
}

/**
 * Projects unknown failures into fields that are safe for durable logs. It
 * never retains the original value, message, stack, cause, response, request,
 * headers, or arbitrary nested properties.
 */
export function safeErrorFields(error: unknown): SafeErrorFields {
  if (!(error instanceof Error)) return { errorName: 'UnknownError' };

  const fields: SafeErrorFields = { errorName: safeName(error) };
  const errorCode = safeCode(error);
  const errorStatus = safeStatus(error);
  const errorLocation = safeLocation(error);
  if (errorCode !== undefined) fields.errorCode = errorCode;
  if (errorStatus !== undefined) fields.errorStatus = errorStatus;
  if (errorLocation !== undefined) fields.errorLocation = errorLocation;
  return fields;
}
