import axios from 'axios';
import type { TrackingResult } from '../carrier-result.js';

export class EchoShipFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable = true,
  ) {
    super('EchoShip lookup could not be completed.');
    this.name = 'EchoShipFailure';
  }
}

export function echoShipFailure(error: unknown): EchoShipFailure {
  if (error instanceof EchoShipFailure) return error;

  if (axios.isAxiosError(error)) {
    if ([401, 403].includes(error.response?.status ?? 0))
      return new EchoShipFailure('ECHOSHIP_AUTHENTICATION_FAILED');

    if (['ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? ''))
      return new EchoShipFailure('ECHOSHIP_TIMEOUT');
  }

  if (error instanceof Error && error.name === 'TimeoutError')
    return new EchoShipFailure('ECHOSHIP_TIMEOUT');

  return new EchoShipFailure('ECHOSHIP_LOOKUP_FAILED');
}

export function failedResult(error: unknown): TrackingResult {
  const failure = echoShipFailure(error);

  return {
    outcome: 'failed',
    reasonCode: failure.code,
    retryable: failure.retryable,
    message:
      failure.code === 'ECHOSHIP_AUTHENTICATION_FAILED'
        ? 'EchoShip authentication failed. Try again on the next run.'
        : failure.message,
    sourceData: null,
  };
}
