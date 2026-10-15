import type { EntityManager } from 'typeorm';
import {
  shipmentRecordSchema,
  shipmentSearchResponseSchema,
  type ShipmentSearchQuery,
} from './shipments.schemas.js';
import type {
  ShipmentRecord,
  ShipmentSearchResponse,
} from './shipments.repository.js';

interface SearchEnvelopeRow {
  items: unknown[];
  total: number;
  all_count: number;
  active_count: number;
  paused_count: number;
  delivered_count: number;
  attention_count: number;
}

type JsonObject = Record<string, unknown>;

const TAB_PREDICATES = {
  all: 'TRUE',
  active: "monitoring_status = 'active'",
  paused: "monitoring_status = 'paused'",
  delivered: "monitoring_status = 'completed'",
  attention: `monitoring_status <> 'completed'
    AND (lookup_outcome = 'failed'
      OR (monitoring_status = 'paused' AND monitoring_reason = 'not_found_threshold'))`,
} as const satisfies Record<ShipmentSearchQuery['tab'], string>;

function asNullableDate(value: unknown): Date | null {
  return value === null ? null : new Date(String(value));
}

function shipmentRecord(value: unknown): ShipmentRecord {
  const item = value as JsonObject;
  const currentTracking = item.currentTracking as JsonObject | null;
  const latestLookup = item.latestLookup as JsonObject | null;
  const latestRun = item.latestRun as JsonObject | null;

  return shipmentRecordSchema.parse({
    ...item,
    currentTracking: currentTracking
      ? {
          ...currentTracking,
          observedAt: new Date(String(currentTracking.observedAt)),
        }
      : null,
    latestLookup: latestLookup
      ? {
          ...latestLookup,
          completedAt: new Date(String(latestLookup.completedAt)),
        }
      : null,
    latestRun: latestRun
      ? {
          ...latestRun,
          createdAt: new Date(String(latestRun.createdAt)),
          startedAt: asNullableDate(latestRun.startedAt),
          completedAt: asNullableDate(latestRun.completedAt),
        }
      : null,
    lastAttemptedAt: asNullableDate(item.lastAttemptedAt),
    nextCheckAt: asNullableDate(item.nextCheckAt),
    createdAt: new Date(String(item.createdAt)),
    updatedAt: new Date(String(item.updatedAt)),
  });
}

function orderBy(query: ShipmentSearchQuery): string {
  const direction = query.sortDirection.toUpperCase();

  switch (query.sortBy) {
    case 'trackingReference':
      return `selected.tracking_reference ${direction}, selected.shipment_id ${direction}`;
    case 'estimatedDeliveryOn':
      return `selected.snapshot_estimated_delivery_on ${direction} NULLS LAST, selected.shipment_id ${direction}`;
    case 'lastAttemptedAt':
      return `selected.last_attempted_at ${direction} NULLS LAST, selected.shipment_id ${direction}`;
    case 'createdAt':
      return `selected.created_at ${direction}, selected.shipment_id ${direction}`;
  }
}

function tabPredicate(tab: ShipmentSearchQuery['tab']): string {
  return TAB_PREDICATES[tab];
}

function statement(query: ShipmentSearchQuery) {
  const parameters: unknown[] = [];
  const parameter = (value: unknown) => {
    parameters.push(value);

    return `$${parameters.length}`;
  };
  const filters = ['shipment.deleted_at IS NULL'];

  if (query.q) {
    const search = parameter(query.q);

    filters.push(
      `(strpos(lower(shipment.tracking_reference), lower(${search})) > 0
        OR strpos(lower(coalesce(shipment.notes, '')), lower(${search})) > 0)`,
    );
  }

  if (query.carrierExternalId)
    filters.push(
      `carrier.external_id = ${parameter(query.carrierExternalId)}::uuid`,
    );

  if (query.lookupOutcome === 'never_checked')
    filters.push('lookup.id IS NULL');
  else if (query.lookupOutcome)
    filters.push(
      `lookup.outcome = ${parameter(query.lookupOutcome)}::tracking_attempt_outcome`,
    );

  if (query.createdFrom)
    filters.push(
      `shipment.created_at >= (${parameter(query.createdFrom)}::date::timestamp AT TIME ZONE 'America/New_York')`,
    );

  if (query.createdTo)
    filters.push(
      `shipment.created_at < (((${parameter(query.createdTo)}::date + 1)::timestamp) AT TIME ZONE 'America/New_York')`,
    );

  if (query.estimatedDeliveryFrom)
    filters.push(
      `snapshot.estimated_delivery_on >= ${parameter(query.estimatedDeliveryFrom)}::date`,
    );

  if (query.estimatedDeliveryTo)
    filters.push(
      `snapshot.estimated_delivery_on <= ${parameter(query.estimatedDeliveryTo)}::date`,
    );

  if (query.undeliveredOnly)
    filters.push("shipment.monitoring_status <> 'completed'");

  const limit = parameter(query.pageSize);
  const offset = parameter((query.page - 1) * query.pageSize);
  const ordering = orderBy(query);

  return {
    parameters,
    sql: `WITH filtered AS MATERIALIZED (
      SELECT
        shipment.id AS shipment_id,
        shipment.external_id AS shipment_external_id,
        shipment.tracking_reference,
        shipment.notes,
        shipment.verification_url,
        shipment.monitoring_status,
        shipment.monitoring_reason,
        shipment.last_attempted_at,
        shipment.next_check_at,
        shipment.consecutive_not_found_count,
        shipment.created_at,
        shipment.updated_at,
        carrier.external_id AS carrier_external_id,
        carrier.code AS carrier_code,
        carrier.name AS carrier_name,
        carrier.is_active AS carrier_is_active,
        snapshot.external_id AS snapshot_external_id,
        snapshot.carrier_status AS snapshot_carrier_status,
        snapshot.carrier_status_detail AS snapshot_carrier_status_detail,
        snapshot.picked_up_on AS snapshot_picked_up_on,
        snapshot.estimated_delivery_on AS snapshot_estimated_delivery_on,
        snapshot.delivered_on AS snapshot_delivered_on,
        snapshot.observed_at AS snapshot_observed_at,
        lookup.id AS lookup_id,
        lookup.tracking_run_id AS lookup_tracking_run_id,
        lookup.outcome AS lookup_outcome,
        lookup.snapshot_changed AS lookup_snapshot_changed,
        lookup.retryable AS lookup_retryable,
        lookup.reason_code AS lookup_reason_code,
        lookup.completed_at AS lookup_completed_at
      FROM shipments shipment
      JOIN carriers carrier ON carrier.id = shipment.carrier_id
      LEFT JOIN shipment_tracking_snapshots snapshot
        ON snapshot.id = shipment.current_tracking_snapshot_id
        AND snapshot.shipment_id = shipment.id
      LEFT JOIN LATERAL (
        SELECT
          attempt.id,
          attempt.tracking_run_id,
          attempt.outcome,
          attempt.snapshot_changed,
          attempt.retryable,
          attempt.reason_code,
          attempt.completed_at
        FROM tracking_attempts attempt
        WHERE attempt.shipment_id = shipment.id
          AND attempt.completed_at IS NOT NULL
        ORDER BY attempt.completed_at DESC, attempt.id DESC
        LIMIT 1
      ) lookup ON TRUE
      WHERE ${filters.join('\n        AND ')}
    ), counts AS (
      SELECT
        count(*)::integer AS all_count,
        count(*) FILTER (WHERE ${TAB_PREDICATES.active})::integer AS active_count,
        count(*) FILTER (WHERE ${TAB_PREDICATES.paused})::integer AS paused_count,
        count(*) FILTER (WHERE ${TAB_PREDICATES.delivered})::integer AS delivered_count,
        count(*) FILTER (WHERE ${TAB_PREDICATES.attention})::integer AS attention_count
      FROM filtered
    ), selected AS MATERIALIZED (
      SELECT * FROM filtered WHERE ${tabPredicate(query.tab)}
    ), page_rows AS (
      SELECT
        selected.*,
        row_number() OVER (ORDER BY ${ordering}) AS page_position
      FROM selected
      ORDER BY ${ordering}
      LIMIT ${limit} OFFSET ${offset}
    ), paged AS (
      SELECT
        page_rows.*,
        lookup_run.external_id AS lookup_run_external_id,
        latest_run.id AS latest_run_id,
        latest_run.external_id AS latest_run_external_id,
        latest_run.trigger AS latest_run_trigger,
        latest_run.fetch_mode AS latest_run_fetch_mode,
        latest_run.status AS latest_run_status,
        latest_run.attempt_count AS latest_run_attempt_count,
        latest_run.created_at AS latest_run_created_at,
        latest_run.started_at AS latest_run_started_at,
        latest_run.completed_at AS latest_run_completed_at
      FROM page_rows
      LEFT JOIN tracking_runs lookup_run
        ON lookup_run.id = page_rows.lookup_tracking_run_id
      LEFT JOIN LATERAL (
        SELECT
          run.id,
          run.external_id,
          run.trigger,
          run.fetch_mode,
          run.status,
          run.created_at,
          run.started_at,
          run.completed_at,
          (SELECT count(*)::integer FROM tracking_attempts counted
            WHERE counted.tracking_run_id = run.id) AS attempt_count
        FROM tracking_attempts membership
        JOIN tracking_runs run ON run.id = membership.tracking_run_id
        WHERE membership.shipment_id = page_rows.shipment_id
        ORDER BY run.created_at DESC, run.id DESC
        LIMIT 1
      ) latest_run ON TRUE
    )
    SELECT
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'externalId', shipment_external_id,
            'carrier', jsonb_build_object(
              'externalId', carrier_external_id,
              'code', carrier_code,
              'name', carrier_name,
              'isActive', carrier_is_active
            ),
            'trackingReference', tracking_reference,
            'notes', notes,
            'verificationUrl', verification_url,
            'currentTracking', CASE WHEN snapshot_external_id IS NULL THEN NULL ELSE jsonb_build_object(
              'externalId', snapshot_external_id,
              'carrierStatus', snapshot_carrier_status,
              'carrierStatusDetail', snapshot_carrier_status_detail,
              'pickedUpOn', snapshot_picked_up_on,
              'estimatedDeliveryOn', snapshot_estimated_delivery_on,
              'deliveredOn', snapshot_delivered_on,
              'observedAt', snapshot_observed_at
            ) END,
            'latestLookup', CASE WHEN lookup_id IS NULL THEN NULL ELSE jsonb_build_object(
              'runExternalId', lookup_run_external_id,
              'outcome', lookup_outcome,
              'snapshotChanged', lookup_snapshot_changed,
              'retryable', lookup_retryable,
              'reasonCode', lookup_reason_code,
              'completedAt', lookup_completed_at
            ) END,
            'latestRun', CASE WHEN latest_run_id IS NULL THEN NULL ELSE jsonb_build_object(
              'externalId', latest_run_external_id,
              'trigger', latest_run_trigger,
              'fetchMode', latest_run_fetch_mode,
              'status', latest_run_status,
              'attemptCount', latest_run_attempt_count,
              'createdAt', latest_run_created_at,
              'startedAt', latest_run_started_at,
              'completedAt', latest_run_completed_at
            ) END,
            'monitoringStatus', monitoring_status,
            'monitoringReason', monitoring_reason,
            'lastAttemptedAt', last_attempted_at,
            'nextCheckAt', next_check_at,
            'consecutiveNotFoundCount', consecutive_not_found_count,
            'createdAt', created_at,
            'updatedAt', updated_at
          ) ORDER BY page_position
        ) FROM paged
      ), '[]'::jsonb) AS items,
      (SELECT count(*)::integer FROM selected) AS total,
      counts.all_count,
      counts.active_count,
      counts.paused_count,
      counts.delivered_count,
      counts.attention_count
    FROM counts`,
  };
}

/** Search results and every count are derived by one PostgreSQL statement snapshot. */
export async function searchShipments(
  manager: EntityManager,
  query: ShipmentSearchQuery,
): Promise<ShipmentSearchResponse> {
  const { sql, parameters } = statement(query);
  const [row]: SearchEnvelopeRow[] = await manager.query(sql, parameters);

  return shipmentSearchResponseSchema.parse({
    items: row.items.map(shipmentRecord),
    page: query.page,
    pageSize: query.pageSize,
    total: row.total,
    tabCounts: {
      all: row.all_count,
      active: row.active_count,
      paused: row.paused_count,
      delivered: row.delivered_count,
      attention: row.attention_count,
    },
  });
}
