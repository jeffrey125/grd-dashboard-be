import axios from 'axios';
import type { TrackingResult } from '../carrier-result.js';

export class FfeFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable = true,
  ) {
    super('FFE lookup could not be completed.');
    this.name = 'FfeFailure';
  }
}

export function ffeFailure(error: unknown): FfeFailure {
  if (error instanceof FfeFailure) return error;
  if (axios.isAxiosError(error)) {
    if ([401, 403].includes(error.response?.status ?? 0))
      return new FfeFailure('FFE_AUTHENTICATION_FAILED');
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? ''))
      return new FfeFailure('FFE_TIMEOUT');
  }
  if (error instanceof Error && error.name === 'TimeoutError')
    return new FfeFailure('FFE_TIMEOUT');
  return new FfeFailure('FFE_LOOKUP_FAILED');
}

export function failedResult(error: unknown): TrackingResult {
  const failure = ffeFailure(error);
  return {
    outcome: 'failed',
    reasonCode: failure.code,
    retryable: failure.retryable,
    message:
      failure.code === 'FFE_AUTHENTICATION_FAILED'
        ? 'FFE authentication failed. Try again on the next run.'
        : failure.message,
    sourceData: null,
  };
}
