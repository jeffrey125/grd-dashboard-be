import { DataSource, type EntityManager } from 'typeorm';
import {
  TRACKING_REPOSITORY,
  type LockedTrackingAttempt,
  type LockedTrackingRun,
  type TrackingAttemptCounts,
  type TrackingRepository,
  type TrackingRunTarget,
  type TrackingShipmentCandidate,
  type TrackingTransaction,
} from './tracking.repository.js';
import type {
  CreateTrackingRun,
  NormalizedTrackingState,
} from './tracking.schemas.js';

interface RunRow {
  id: string;
  external_id: string;
  trigger: LockedTrackingRun['trigger'];
  status: LockedTrackingRun['status'];
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  carrier_code: string;
  carrier_is_active: boolean;
  carrier_deleted_at: Date | null;
}

function lockedRun(row: RunRow): LockedTrackingRun {
  return {
    id: row.id,
    externalId: row.external_id,
    trigger: row.trigger,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    carrierCode: row.carrier_code,
    carrierIsActive: row.carrier_is_active,
    carrierDeletedAt: row.carrier_deleted_at,
  };
}

class TypeOrmTrackingTransaction implements TrackingTransaction {
  constructor(private readonly manager: EntityManager) {}

  async lockAvailableCarrier(externalId: string) {
    const rows: Array<{ id: number }> = await this.manager.query(
      `SELECT id
         FROM carriers
        WHERE external_id = $1 AND deleted_at IS NULL AND is_active = TRUE
        FOR SHARE`,
      [externalId],
    );
    return rows[0] ?? null;
  }

  async lockTargetShipments(
    externalIds: string[],
    carrierId: number,
  ): Promise<TrackingShipmentCandidate[]> {
    const rows: Array<{
      id: number;
      external_id: string;
      monitoring_status: string;
      monitoring_reason: string | null;
    }> = await this.manager.query(
      `SELECT id, external_id, monitoring_status, monitoring_reason
         FROM shipments
        WHERE external_id = ANY($1::uuid[])
          AND carrier_id = $2
          AND deleted_at IS NULL
        ORDER BY id
        FOR SHARE`,
      [externalIds, carrierId],
    );
    return rows.map((row) => ({
      id: row.id,
      externalId: row.external_id,
      monitoringStatus: row.monitoring_status,
      monitoringReason: row.monitoring_reason,
    }));
  }

  async insertRun(command: CreateTrackingRun, carrierId: number) {
    const rows: Array<{ external_id: string }> = await this.manager.query(
      `INSERT INTO tracking_runs (carrier_id, trigger, requested_by_id)
       VALUES ($1, $2, $3)
       RETURNING external_id`,
      [carrierId, command.trigger, command.requestedById],
    );
    return (await this.lockRun(rows[0]!.external_id))!;
  }

  async insertAttempts(runId: string, shipmentIds: number[]) {
    for (const shipmentId of shipmentIds)
      await this.manager.query(
        `INSERT INTO tracking_attempts (tracking_run_id, shipment_id)
         VALUES ($1, $2)`,
        [runId, shipmentId],
      );
  }

  async lockRun(externalId: string) {
    const rows: RunRow[] = await this.manager.query(
      `SELECT run.id, run.external_id, run.trigger, run.status, run.created_at,
              run.started_at, run.completed_at, carrier.code AS carrier_code,
              carrier.is_active AS carrier_is_active,
              carrier.deleted_at AS carrier_deleted_at
         FROM tracking_runs run
         JOIN carriers carrier ON carrier.id = run.carrier_id
        WHERE run.external_id = $1
        FOR UPDATE OF run`,
      [externalId],
    );
    return rows[0] ? lockedRun(rows[0]) : null;
  }

  async markRunRunning(runId: string) {
    await this.manager.query(
      `UPDATE tracking_runs
          SET status = 'running',
              started_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [runId],
    );
  }

  async loadRunTargets(runId: string): Promise<TrackingRunTarget[]> {
    const rows: Array<{
      attempt_id: string;
      shipment_id: number;
      shipment_external_id: string;
      tracking_reference: string;
      lock_version: number;
      monitoring_status: string;
      monitoring_reason: string | null;
      deleted_at: Date | null;
    }> = await this.manager.query(
      `SELECT attempt.id AS attempt_id,
              shipment.id AS shipment_id,
              shipment.external_id AS shipment_external_id,
              shipment.tracking_reference,
              shipment.lock_version,
              shipment.monitoring_status,
              shipment.monitoring_reason,
              shipment.deleted_at
         FROM tracking_attempts attempt
         JOIN shipments shipment ON shipment.id = attempt.shipment_id
        WHERE attempt.tracking_run_id = $1
        ORDER BY attempt.id`,
      [runId],
    );
    return rows.map((row) => ({
      attemptId: row.attempt_id,
      id: row.shipment_id,
      externalId: row.shipment_external_id,
      trackingReference: row.tracking_reference,
      lockVersion: row.lock_version,
      monitoringStatus: row.monitoring_status,
      monitoringReason: row.monitoring_reason,
      deletedAt: row.deleted_at,
    }));
  }

  async databaseNow() {
    const rows: Array<{ completed_at: Date }> = await this.manager.query(
      'SELECT clock_timestamp() AS completed_at',
    );
    return rows[0]!.completed_at;
  }

  async lockAttempt(
    runExternalId: string,
    shipmentExternalId: string,
  ): Promise<LockedTrackingAttempt | null> {
    const rows: Array<{
      run_id: string;
      run_trigger: LockedTrackingAttempt['runTrigger'];
      run_status: LockedTrackingAttempt['runStatus'];
      attempt_id: string;
      attempt_outcome: string;
      shipment_id: number;
      shipment_external_id: string;
      tracking_reference: string;
      verification_url: string | null;
      current_tracking_snapshot_id: string | null;
      monitoring_status: string;
      monitoring_reason: string | null;
      consecutive_not_found_count: number;
      lock_version: number;
      deleted_at: Date | null;
      carrier_code: string;
      not_found_pause_threshold: number;
    }> = await this.manager.query(
      `SELECT run.id AS run_id,
              run.trigger AS run_trigger,
              run.status AS run_status,
              attempt.id AS attempt_id,
              attempt.outcome AS attempt_outcome,
              shipment.id AS shipment_id,
              shipment.external_id AS shipment_external_id,
              shipment.tracking_reference,
              shipment.verification_url,
              shipment.current_tracking_snapshot_id,
              shipment.monitoring_status,
              shipment.monitoring_reason,
              shipment.consecutive_not_found_count,
              shipment.lock_version,
              shipment.deleted_at,
              carrier.code AS carrier_code,
              carrier.not_found_pause_threshold
         FROM tracking_runs run
         JOIN tracking_attempts attempt ON attempt.tracking_run_id = run.id
         JOIN shipments shipment ON shipment.id = attempt.shipment_id
         JOIN carriers carrier ON carrier.id = shipment.carrier_id
        WHERE run.external_id = $1 AND shipment.external_id = $2
        FOR UPDATE OF run, attempt, shipment`,
      [runExternalId, shipmentExternalId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      runId: row.run_id,
      runTrigger: row.run_trigger,
      runStatus: row.run_status,
      attemptId: row.attempt_id,
      attemptOutcome: row.attempt_outcome,
      shipmentId: row.shipment_id,
      shipmentExternalId: row.shipment_external_id,
      trackingReference: row.tracking_reference,
      verificationUrl: row.verification_url,
      currentTrackingSnapshotId: row.current_tracking_snapshot_id,
      monitoringStatus: row.monitoring_status,
      monitoringReason: row.monitoring_reason,
      consecutiveNotFoundCount: row.consecutive_not_found_count,
      lockVersion: row.lock_version,
      deletedAt: row.deleted_at,
      carrierCode: row.carrier_code,
      notFoundPauseThreshold: row.not_found_pause_threshold,
    };
  }

  async loadCurrentSnapshot(
    shipmentId: number,
    snapshotId: string,
  ): Promise<NormalizedTrackingState | null> {
    const rows: Array<{
      carrier_status: string | null;
      carrier_status_detail: string | null;
      picked_up_on: string | null;
      estimated_delivery_on: string | null;
      delivered_on: string | null;
    }> = await this.manager.query(
      `SELECT carrier_status, carrier_status_detail, picked_up_on::text AS picked_up_on,
              estimated_delivery_on::text AS estimated_delivery_on, delivered_on::text AS delivered_on
         FROM shipment_tracking_snapshots
        WHERE shipment_id = $1 AND id = $2`,
      [shipmentId, snapshotId],
    );
    const row = rows[0];
    return row
      ? {
          carrierStatus: row.carrier_status,
          carrierStatusDetail: row.carrier_status_detail,
          pickedUpOn: row.picked_up_on,
          estimatedDeliveryOn: row.estimated_delivery_on,
          deliveredOn: row.delivered_on,
        }
      : null;
  }

  async insertSnapshot(
    shipmentId: number,
    snapshot: NormalizedTrackingState,
    observedAt: Date,
  ) {
    const rows: Array<{ id: string }> = await this.manager.query(
      `INSERT INTO shipment_tracking_snapshots
         (shipment_id, carrier_status, carrier_status_detail, picked_up_on,
          estimated_delivery_on, delivered_on, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        shipmentId,
        snapshot.carrierStatus,
        snapshot.carrierStatusDetail,
        snapshot.pickedUpOn,
        snapshot.estimatedDeliveryOn,
        snapshot.deliveredOn,
        observedAt,
      ],
    );
    return rows[0]!.id;
  }

  async updateShipmentFound(input: {
    shipmentId: number;
    snapshotId: string;
    verificationUrl: string | null;
    completedAt: Date;
    delivered: boolean;
    scheduleNext: boolean;
    reactivate: boolean;
    effectiveIntervalMinutes: number;
    expectedLockVersion: number;
  }) {
    const result: [Array<{ id: number }>, number] = await this.manager.query(
      `UPDATE shipments
          SET current_tracking_snapshot_id = $2,
              verification_url = COALESCE(verification_url, $3),
              consecutive_not_found_count = 0,
              last_attempted_at = $4,
              next_check_at = CASE
                WHEN $5::boolean THEN NULL
                WHEN $6::boolean OR $7::boolean
                  THEN $4::timestamptz + ($8::integer * INTERVAL '1 minute')
                ELSE next_check_at
              END,
              monitoring_status = CASE
                WHEN $5::boolean THEN 'completed'::shipment_monitoring_status
                WHEN $7::boolean THEN 'active'::shipment_monitoring_status
                ELSE monitoring_status
              END,
              monitoring_reason = CASE
                WHEN $5::boolean THEN 'delivered'::shipment_monitoring_reason
                WHEN $7::boolean THEN NULL
                ELSE monitoring_reason
              END,
              lock_version = lock_version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1 AND lock_version = $9 AND deleted_at IS NULL
        RETURNING id`,
      [
        input.shipmentId,
        input.snapshotId,
        input.verificationUrl,
        input.completedAt,
        input.delivered,
        input.scheduleNext,
        input.reactivate,
        input.effectiveIntervalMinutes,
        input.expectedLockVersion,
      ],
    );
    return result[1] === 1;
  }

  async updateShipmentNotFound(input: {
    shipmentId: number;
    notFoundCount: number;
    completedAt: Date;
    thresholdReached: boolean;
    scheduleNext: boolean;
    effectiveIntervalMinutes: number;
    expectedLockVersion: number;
  }) {
    const result: [Array<{ id: number }>, number] = await this.manager.query(
      `UPDATE shipments
          SET consecutive_not_found_count = $2,
              last_attempted_at = $3,
              next_check_at = CASE
                WHEN $4::boolean THEN NULL
                WHEN $5::boolean
                  THEN $3::timestamptz + ($6::integer * INTERVAL '1 minute')
                ELSE next_check_at
              END,
              monitoring_status = CASE
                WHEN $4::boolean THEN 'paused'::shipment_monitoring_status
                ELSE monitoring_status
              END,
              monitoring_reason = CASE
                WHEN $4::boolean
                  THEN 'not_found_threshold'::shipment_monitoring_reason
                ELSE monitoring_reason
              END,
              lock_version = lock_version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1 AND lock_version = $7 AND deleted_at IS NULL
        RETURNING id`,
      [
        input.shipmentId,
        input.notFoundCount,
        input.completedAt,
        input.thresholdReached,
        input.scheduleNext,
        input.effectiveIntervalMinutes,
        input.expectedLockVersion,
      ],
    );
    return result[1] === 1;
  }

  async updateShipmentFailed(input: {
    shipmentId: number;
    completedAt: Date;
    scheduleNext: boolean;
    effectiveIntervalMinutes: number;
    expectedLockVersion: number;
  }) {
    const result: [Array<{ id: number }>, number] = await this.manager.query(
      `UPDATE shipments
          SET last_attempted_at = $2,
              next_check_at = CASE
                WHEN $3::boolean
                  THEN $2::timestamptz + ($4::integer * INTERVAL '1 minute')
                ELSE next_check_at
              END,
              lock_version = lock_version + 1,
              updated_at = clock_timestamp()
        WHERE id = $1 AND lock_version = $5 AND deleted_at IS NULL
        RETURNING id`,
      [
        input.shipmentId,
        input.completedAt,
        input.scheduleNext,
        input.effectiveIntervalMinutes,
        input.expectedLockVersion,
      ],
    );
    return result[1] === 1;
  }

  async finalizeAttempt(input: {
    attemptId: string;
    outcome: 'found' | 'not_found' | 'failed' | 'skipped';
    snapshotId: string | null;
    snapshotChanged: boolean;
    sourceData: Record<string, unknown> | null;
    retryable: boolean | null;
    reasonCode: string | null;
    message: string | null;
    completedAt: Date;
  }) {
    await this.manager.query(
      `UPDATE tracking_attempts
          SET outcome = $2::tracking_attempt_outcome,
              snapshot_id = $3,
              snapshot_changed = $4,
              source_data = $5::jsonb,
              retryable = $6,
              reason_code = $7,
              message = $8,
              completed_at = $9
        WHERE id = $1`,
      [
        input.attemptId,
        input.outcome,
        input.snapshotId,
        input.snapshotChanged,
        input.sourceData === null ? null : JSON.stringify(input.sourceData),
        input.retryable,
        input.reasonCode,
        input.message,
        input.completedAt,
      ],
    );
  }

  async countAttempts(runId: string): Promise<TrackingAttemptCounts> {
    const rows: TrackingAttemptCounts[] = await this.manager.query(
      `SELECT count(*)::integer AS total,
              count(*) FILTER (WHERE outcome = 'pending')::integer AS pending,
              count(*) FILTER (WHERE outcome = 'failed')::integer AS failed
         FROM tracking_attempts
        WHERE tracking_run_id = $1`,
      [runId],
    );
    return rows[0]!;
  }

  async updateRun(input: {
    runId: string;
    status: LockedTrackingRun['status'];
    reasonCode: string | null;
    message: string | null;
    completedAt: Date;
  }) {
    await this.manager.query(
      `UPDATE tracking_runs
          SET status = $2::tracking_run_status,
              reason_code = $3,
              message = $4,
              completed_at = $5,
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [
        input.runId,
        input.status,
        input.reasonCode,
        input.message,
        input.completedAt,
      ],
    );
  }

  async finalizePendingAttempts(input: {
    runId: string;
    outcome: 'failed' | 'skipped';
    retryable: boolean | null;
    reasonCode: string;
    message: string | null;
    completedAt: Date;
  }) {
    await this.manager.query(
      `UPDATE tracking_attempts
          SET outcome = $2::tracking_attempt_outcome,
              snapshot_id = NULL,
              snapshot_changed = FALSE,
              source_data = NULL,
              retryable = $3,
              reason_code = $4,
              message = $5,
              completed_at = $6
        WHERE tracking_run_id = $1 AND outcome = 'pending'`,
      [
        input.runId,
        input.outcome,
        input.retryable,
        input.reasonCode,
        input.message,
        input.completedAt,
      ],
    );
  }
}

export class TypeOrmTrackingRepository implements TrackingRepository {
  constructor(private readonly source: DataSource) {}

  transaction<T>(
    work: (transaction: TrackingTransaction) => Promise<T>,
  ): Promise<T> {
    return this.source.transaction((manager) =>
      work(new TypeOrmTrackingTransaction(manager)),
    );
  }
}

export const trackingRepositoryProvider = {
  provide: TRACKING_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): TrackingRepository =>
    new TypeOrmTrackingRepository(source),
};
