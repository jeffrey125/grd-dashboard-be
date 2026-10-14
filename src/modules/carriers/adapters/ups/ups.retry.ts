import axios from 'axios';

export function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function retryAfterMs(value: unknown, now: number): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;

  const header = String(value).trim();

  if (/^\d+$/.test(header))
    return Math.min(Number(header) * 1000, Number.MAX_SAFE_INTEGER - now);

  // Reject numeric-looking strings and Date.parse's permissive non-HTTP dates.
  if (
    !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)
  )
    return undefined;

  const timestamp = Date.parse(header);

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toUTCString().toLowerCase() !== header.toLowerCase()
  )
    return undefined;

  return Math.max(0, timestamp - now);
}

export function retryableTransportError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || axios.isCancel(error)) return false;

  if (error.response) return retryableHttpStatus(error.response.status);

  return [
    'ECONNABORTED',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EPIPE',
    'ERR_NETWORK',
  ].includes(error.code ?? '');
}
