import { z } from 'zod';
import { FfeFailure } from './ffe.failure.js';
import type { FfeSettings } from './ffe.config.js';
import type { CarrierRequestLimiter } from '../carrier-request-limiter.js';

export const LOGIN_PATH = '/Account/Login';
export const TRACKING_PATH = '/Customer/ShipmentTracking';
export const DATA_PATH = '/Customer/LoadShipmentTrackingData';
export const TIMEOUT_MS = 30_000;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface FfeSessionOptions {
  settings: FfeSettings;
  limiter: CarrierRequestLimiter;
  rpm: number | null;
  signal: AbortSignal;
}

const columns = [
  'orderNumber',
  'bolNumber',
  'poNumber',
  'pickupLocation',
  'shipmentStatus',
  'stringApptPickupDate',
  'stringApptDeliveryDate',
  'consignee',
  'city',
  'state',
  'stringDeliveryDate',
  'unitLatitude',
  'unitLongitude',
  'orderStatusId',
];

export function searchBody(reference: string, start: number, draw: number) {
  return {
    draw,
    columns: columns.map((name) => ({
      data: name,
      name,
      searchable: true,
      orderable: true,
      search: { value: name === 'orderNumber' ? reference : '', regex: false },
    })),
    order: [{ column: 10, dir: 'desc' }],
    start,
    length: 100,
    search: { value: '', regex: false },
    archiveLimit: '365',
  };
}

const envelope = z.object({
  draw: z.union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/).transform(Number),
  ]),
  recordsTotal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recordsFiltered: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  data: z
    .array(
      z
        .object({ orderNumber: z.string().trim().min(1).max(255) })
        .passthrough(),
    )
    .max(200),
});

export function searchPage(input: unknown, draw: number, limit: number) {
  const result = envelope.safeParse(input);

  if (
    !result.success ||
    result.data.draw !== draw ||
    result.data.recordsFiltered > result.data.recordsTotal ||
    result.data.data.length > Math.min(limit, result.data.recordsFiltered)
  )
    throw new FfeFailure('FFE_INVALID_RESPONSE');

  return result.data;
}

export function assertResponse(
  status: number,
  contentType: string,
  kind: 'html' | 'json',
) {
  if ([401, 403].includes(status))
    throw new FfeFailure('FFE_AUTHENTICATION_FAILED');

  const pattern =
    kind === 'html'
      ? /^text\/html(?:;|$)/i
      : /^application\/(?:[\w.-]+\+)?json(?:;|$)/i;

  if (status !== 200 || !pattern.test(contentType))
    throw new FfeFailure('FFE_INVALID_RESPONSE');
}
