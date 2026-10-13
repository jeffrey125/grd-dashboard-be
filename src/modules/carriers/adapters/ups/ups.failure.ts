import type { TrackingResult } from '@modules/carriers/adapters/carrier-result.js';
import axios from 'axios';
import { retryableTransportError } from './ups.retry.js';

export class UpsFailure extends Error {
  constructor(
    readonly reasonCode: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'UpsFailure';
  }

  result(): Extract<TrackingResult, { outcome: 'failed' }> {
    return {
      outcome: 'failed',
      reasonCode: this.reasonCode,
      retryable: this.retryable,
      message: this.message,
      sourceData: null,
    };
  }
}

export function invalidUpsResponse(): UpsFailure {
  return new UpsFailure(
    'UPS_INVALID_RESPONSE',
    true,
    'UPS returned an invalid tracking response.',
  );
}

/** Never retain Axios errors: their config contains Basic/Bearer credentials. */
export function upsHttpFailure(
  error: unknown,
  authentication = false,
): UpsFailure {
  if (error instanceof UpsFailure) return error;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const code = axios.isAxiosError(error) ? error.code : undefined;
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED')
    return new UpsFailure(
      'UPS_TIMEOUT',
      true,
      'UPS request timed out. Tracking will retry later.',
    );
  if (status === 429)
    return new UpsFailure(
      'UPS_RATE_LIMITED',
      true,
      'UPS temporarily unavailable. Tracking will retry later.',
    );
  if (authentication || status === 401 || status === 403)
    return new UpsFailure(
      'UPS_AUTHENTICATION_FAILED',
      retryableTransportError(error),
      'UPS authentication could not be completed.',
    );
  if (
    code === 'ERR_BAD_RESPONSE' &&
    (status === undefined || (status >= 200 && status < 300))
  )
    return invalidUpsResponse();
  return new UpsFailure(
    'UPS_UNAVAILABLE',
    retryableTransportError(error),
    'UPS tracking could not be completed.',
  );
}
