import { DataSource } from 'typeorm';
import { SHIPMENT_TAB_PREDICATES } from '@modules/shipments/shipment-read-predicates.js';
import {
  shipmentJsonSql,
  shipmentRecord,
} from '@modules/shipments/typeorm-shipment-record.js';
import { dashboardOverviewResponseSchema } from './dashboard.schemas.js';
import {
  DASHBOARD_REPOSITORY,
  type DashboardOverview,
  type DashboardRepository,
} from './dashboard.repository.js';

interface OverviewEnvelopeRow {
  as_of: Date | string;
  all_count: number;
  active_count: number;
  paused_count: number;
  delivered_count: number;
  attention_count: number;
  attention_items: unknown[];
}

function overviewStatement(): string {
  return `WITH bounds AS (
    SELECT $1::timestamptz AS as_of
  ), base AS MATERIALIZED (
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
    WHERE shipment.deleted_at IS NULL
  ), counts AS (
    SELECT
      count(*)::integer AS all_count,
      count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.active})::integer AS active_count,
      count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.paused})::integer AS paused_count,
      count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.delivered})::integer AS delivered_count,
      count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.attention})::integer AS attention_count
    FROM base
  ), attention_rows AS (
    SELECT
      base.*,
      row_number() OVER (ORDER BY created_at DESC, shipment_id DESC) AS panel_position
    FROM base
    WHERE ${SHIPMENT_TAB_PREDICATES.attention}
    ORDER BY created_at DESC, shipment_id DESC
    LIMIT 5
  ), attention_projected AS (
    SELECT
      attention_rows.*,
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
    FROM attention_rows
    LEFT JOIN tracking_runs lookup_run
      ON lookup_run.id = attention_rows.lookup_tracking_run_id
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
      WHERE membership.shipment_id = attention_rows.shipment_id
      ORDER BY run.created_at DESC, run.id DESC
      LIMIT 1
    ) latest_run ON TRUE
  )
  SELECT
    bounds.as_of,
    counts.all_count,
    counts.active_count,
    counts.paused_count,
    counts.delivered_count,
    counts.attention_count,
    coalesce((
      SELECT jsonb_agg(
        ${shipmentJsonSql('attention_projected')}
        ORDER BY attention_projected.panel_position
      )
      FROM attention_projected
    ), '[]'::jsonb) AS attention_items
  FROM bounds
  CROSS JOIN counts`;
}

export class TypeOrmDashboardRepository implements DashboardRepository {
  constructor(
    private readonly source: DataSource,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async overview(): Promise<DashboardOverview> {
    const asOf = this.clock();
    const [row]: OverviewEnvelopeRow[] = await this.source.manager.query(
      overviewStatement(),
      [asOf],
    );

    return dashboardOverviewResponseSchema.parse({
      asOf: new Date(row.as_of),
      timezone: 'America/New_York',
      counts: {
        all: row.all_count,
        active: row.active_count,
        paused: row.paused_count,
        delivered: row.delivered_count,
        attention: row.attention_count,
      },
      attention: {
        total: row.attention_count,
        items: row.attention_items.map(shipmentRecord),
      },
    });
  }
}

export const dashboardRepositoryProvider = {
  provide: DASHBOARD_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): DashboardRepository =>
    new TypeOrmDashboardRepository(source),
};
