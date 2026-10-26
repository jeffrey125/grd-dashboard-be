import { DataSource } from 'typeorm';
import {
  SHIPMENT_TAB_PREDICATES,
  shipmentTabPredicateAt,
} from '@modules/shipments/shipment-read-predicates.js';
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
  upcoming_from: string;
  upcoming_to: string;
  upcoming_total: number;
  upcoming_items: unknown[];
}

function overviewStatement(): string {
  return `WITH bounds AS (
    SELECT $1::timestamptz AS as_of,
      ($1::timestamptz AT TIME ZONE 'America/New_York')::date AS business_date,
      ($1::timestamptz AT TIME ZONE 'America/New_York')::date AS date_from,
      ($1::timestamptz AT TIME ZONE 'America/New_York')::date + 6 AS date_to
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
      shipment.consecutive_failure_count,
      shipment.created_at,
      shipment.updated_at,
      shipment.follow_up_on,
      shipment.record_updated_at,
      bounds.business_date,
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
    CROSS JOIN bounds
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
    WHERE shipment.deleted_at IS NULL
  ), counts AS (
    SELECT
      count(*)::integer AS all_count,
        count(*) FILTER (WHERE ${shipmentTabPredicateAt('active', 'business_date')})::integer AS active_count,
      count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.paused})::integer AS paused_count,
      count(*) FILTER (WHERE ${SHIPMENT_TAB_PREDICATES.delivered})::integer AS delivered_count,
        count(*) FILTER (WHERE ${shipmentTabPredicateAt('attention', 'business_date')})::integer AS attention_count
    FROM base
  ), attention_rows AS (
    SELECT
      base.*,
      row_number() OVER (ORDER BY created_at DESC, shipment_id DESC) AS panel_position
    FROM base
    WHERE ${shipmentTabPredicateAt('attention', 'business_date')}
    ORDER BY created_at DESC, shipment_id DESC
    LIMIT 5
  ), upcoming AS MATERIALIZED (
    SELECT base.* FROM base CROSS JOIN bounds
    WHERE monitoring_status <> 'completed'
      AND snapshot_estimated_delivery_on BETWEEN bounds.date_from AND bounds.date_to
  ), upcoming_rows AS (
    SELECT upcoming.*,
      row_number() OVER (ORDER BY snapshot_estimated_delivery_on, created_at, shipment_id) AS panel_position
    FROM upcoming
    ORDER BY snapshot_estimated_delivery_on, created_at, shipment_id
    LIMIT 5
  ), panel_rows AS (
    SELECT attention_rows.*, 'attention' AS panel FROM attention_rows
    UNION ALL
    SELECT upcoming_rows.*, 'upcoming' AS panel FROM upcoming_rows
  ), panel_projected AS (
    SELECT
      panel_rows.*,
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
    FROM panel_rows
    LEFT JOIN tracking_runs lookup_run
      ON lookup_run.id = panel_rows.lookup_tracking_run_id
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
      WHERE membership.shipment_id = panel_rows.shipment_id
      ORDER BY run.created_at DESC, run.id DESC
      LIMIT 1
    ) latest_run ON TRUE
  )
  SELECT
    bounds.as_of,
    to_char(bounds.date_from, 'YYYY-MM-DD') AS upcoming_from,
    to_char(bounds.date_to, 'YYYY-MM-DD') AS upcoming_to,
    (SELECT count(*)::integer FROM upcoming) AS upcoming_total,
    coalesce((
      SELECT jsonb_agg(
        ${shipmentJsonSql('panel_projected')}
        ORDER BY panel_projected.panel_position
      ) FROM panel_projected WHERE panel = 'upcoming'
    ), '[]'::jsonb) AS upcoming_items,
    counts.all_count,
    counts.active_count,
    counts.paused_count,
    counts.delivered_count,
    counts.attention_count,
    coalesce((
      SELECT jsonb_agg(
        ${shipmentJsonSql('panel_projected')}
        ORDER BY panel_projected.panel_position
      )
      FROM panel_projected WHERE panel = 'attention'
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
      upcomingWindow: { from: row.upcoming_from, to: row.upcoming_to },
      upcomingDeliveries: {
        total: row.upcoming_total,
        items: row.upcoming_items.map(shipmentRecord),
      },
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
