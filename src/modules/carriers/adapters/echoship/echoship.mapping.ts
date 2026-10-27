import { z } from 'zod';
import {
  trackingResultSchema,
  type TrackingResult,
} from '../carrier-result.js';
import { EchoShipFailure } from './echoship.failure.js';

export const SEARCH_PATH = '/api//v3/customer/loadSummaries';
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;
const id = z
  .union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ])
  .transform(String);
const dateValue = z.string().max(64).nullable().optional();
const textValue = z.string().max(16_384).nullable().optional();

export function envelope(input: unknown): unknown {
  const status = z
    .object({ status: z.object({ code: z.number() }), data: z.unknown() })
    .safeParse(input);

  if (!status.success) throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');

  if (status.data.status.code === 401104)
    throw new EchoShipFailure('ECHOSHIP_ACCOUNT_LOCKED');

  if ([401, 403].includes(status.data.status.code))
    throw new EchoShipFailure('ECHOSHIP_AUTHENTICATION_FAILED');

  if (status.data.status.code !== 200)
    throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');

  return status.data.data;
}

export function searchPage(input: unknown) {
  return z
    .object({
      results: z.array(z.object({ id })).max(100),
      totalRecordCount: z.int().nonnegative(),
    })
    .parse(envelope(input));
}

function date(value: string | null | undefined): string | null {
  if (!value || value.startsWith('0001-01-01')) return null;

  if (
    !z
      .union([z.iso.date(), z.iso.datetime({ offset: true, local: true })])
      .safeParse(value).success
  )
    throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');

  // Preserve the source calendar date, regardless of offset or machine timezone.
  return z.iso.date().parse(value.slice(0, 10));
}

const normalize = (value: string | null | undefined) =>
  value?.replace(/\s+/g, ' ').trim() || null;
const eventSchema = z.object({
  id,
  typeName: textValue,
  notes: textValue,
  createdDate: z.string().max(64),
  modifiedDate: z.string().max(64),
});
// Naive event timestamps have one common source clock. Anchor ordering to UTC
// only to avoid host-timezone-dependent sorting; do not persist them as UTC instants.
const eventOrder = (value: string) =>
  Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`);

export function mapEchoShip(
  reference: string,
  rawDetail: unknown,
  rawTracking: unknown,
): TrackingResult {
  const load = z
    .object({
      id,
      status: textValue,
      pickupDate: dateValue,
      deliveryByDate: dateValue,
      deliveryDate: dateValue,
      stops: z
        .array(z.object({ stopType: z.string(), appointmentStart: dateValue }))
        .max(100)
        .optional(),
    })
    .parse(envelope(rawDetail));

  if (load.id !== reference)
    throw new EchoShipFailure('ECHOSHIP_REFERENCE_MISMATCH');

  const events = z.array(eventSchema).max(10_000).parse(envelope(rawTracking));

  for (const event of events) {
    if (event.id !== reference)
      throw new EchoShipFailure('ECHOSHIP_REFERENCE_MISMATCH');

    for (const timestamp of [event.modifiedDate, event.createdDate]) {
      date(timestamp);

      if (!Number.isFinite(eventOrder(timestamp)))
        throw new EchoShipFailure('ECHOSHIP_INVALID_RESPONSE');
    }
  }

  // Match the portal's orderBy(modifiedDate desc, createdDate desc), not event time alone.
  // Ties with conflicting panel text cannot be resolved from the ordering evidence.
  const sorted = [...events].sort(
    (a, b) =>
      eventOrder(b.modifiedDate) - eventOrder(a.modifiedDate) ||
      eventOrder(b.createdDate) - eventOrder(a.createdDate),
  );
  const latest = sorted[0];

  if (
    latest &&
    sorted.some(
      (event) =>
        eventOrder(event.modifiedDate) === eventOrder(latest.modifiedDate) &&
        eventOrder(event.createdDate) === eventOrder(latest.createdDate) &&
        (normalize(event.typeName) !== normalize(latest.typeName) ||
          normalize(event.notes) !== normalize(latest.notes)),
    )
  )
    throw new EchoShipFailure('ECHOSHIP_AMBIGUOUS_TRACKING');

  const appointment = load.stops?.find(
    (stop) => stop.stopType === 'Delivery',
  )?.appointmentStart;
  const deliveredOn = date(load.deliveryDate);
  const sourceLoad = {
    id: load.id,
    status: load.status ?? null,
    pickupDate: load.pickupDate ?? null,
    deliveryDate: load.deliveryDate ?? null,
    deliveryByDate: load.deliveryByDate ?? null,
    deliveryAppointmentStart: appointment ?? null,
  };

  return trackingResultSchema.parse({
    outcome: 'found',
    snapshot: {
      carrierStatus: normalize(latest ? latest.typeName : load.status),
      carrierStatusDetail: normalize(latest?.notes),
      pickedUpOn: date(load.pickupDate),
      estimatedDeliveryOn: deliveredOn
        ? null
        : (date(appointment) ?? date(load.deliveryByDate)),
      deliveredOn,
    },
    sourceData: { load: sourceLoad, trackingEvent: latest ?? null },
  });
}
