import type { EntityManager } from 'typeorm';
import {
  shipmentSearchResponseSchema,
  type ShipmentSearchQuery,
} from './shipments.schemas.js';
import type { ShipmentSearchResponse } from './shipments.repository.js';
import {
  SHIPMENT_TAB_PREDICATES,
  shipmentTabPredicate,
} from './shipment-read-predicates.js';
import { shipmentJsonSql, shipmentRecord } from './typeorm-shipment-record.js';

interface SearchEnvelopeRow {
  items: unknown[];
  total: number;
  all_count: number;
  active_count: number;
  paused_count: number;
  delivered_count: number;
  attention_count: number;
}

function orderBy(query: ShipmentSearchQuery): string {
  const direction = query.sortDirection.toUpperCase();

  switch (query.sortBy) {
    case 'trackingReference':
      return `selected.tracking_reference ${direction}, selected.shipment_id ${direction}`;
    case 'estimatedDeliveryOn':
      return `selected.snapshot_estimated_delivery_on ${direction} NULLS LAST, selected.shipment_id ${direction}`;
    case 'followUpOn':
      return `selected.follow_up_on ${direction} NULLS LAST, selected.shipment_id ${direction}`;
    case 'createdAt':
      return `selected.created_at ${direction}, selected.shipment_id ${direction}`;
  }
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

  if (query.salesRepExternalId === 'unassigned')
    filters.push('shipment.sales_rep_id IS NULL');
  else if (query.salesRepExternalId)
    filters.push(
      `sales_rep.external_id = ${parameter(query.salesRepExternalId)}::uuid`,
    );

  const limit = parameter(query.pageSize);
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
        shipment.follow_up_on,
        shipment.record_updated_at,
        carrier.external_id AS carrier_external_id,
        carrier.code AS carrier_code,
        carrier.name AS carrier_name,
        carrier.is_active AS carrier_is_active,
        sales_rep.external_id AS sales_rep_external_id,
        sales_rep.first_name AS sales_rep_first_name,
        sales_rep.last_name AS sales_rep_last_name,
        (sales_rep.deleted_at IS NULL) AS sales_rep_active,
        created_user.external_id AS created_by_external_id,
        created_user.first_name AS created_by_first_name,
        created_user.last_name AS created_by_last_name,
        updated_user.external_id AS updated_by_external_id,
        updated_user.first_name AS updated_by_first_name,
        updated_user.last_name AS updated_by_last_name,
        record_updated_user.external_id AS record_updated_by_external_id,
        record_updated_user.first_name AS record_updated_by_first_name,
        record_updated_user.last_name AS record_updated_by_last_name,
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
      LEFT JOIN sales_reps sales_rep ON sales_rep.id = shipment.sales_rep_id
      LEFT JOIN auth_users created_user ON created_user.id = shipment.created_by_id
      LEFT JOIN auth_users updated_user ON updated_user.id = shipment.updated_by_id
      LEFT JOIN auth_users record_updated_user
        ON record_updated_user.id = shipment.record_updated_by_id
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
        count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.active})::integer AS active_count,
        count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.paused})::integer AS paused_count,
        count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.delivered})::integer AS delivered_count,
        count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.attention})::integer AS attention_count
      FROM filtered
    ), selected AS MATERIALIZED (
      SELECT * FROM filtered WHERE ${shipmentTabPredicate(query.tab)}
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
          ${shipmentJsonSql('paged')} ORDER BY paged.page_position
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
