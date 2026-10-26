import { DataSource } from 'typeorm';
import { TypeOrmTrackingTransaction } from './typeorm-tracking.repository.js';
import {
  trackingRunRecord,
  type TrackingRunRecord,
} from './tracking.repository.js';
import type {
  TrackingHttpRepository,
  RunStatus,
} from './tracking-http.repository.js';

export class TypeOrmTrackingHttpRepository implements TrackingHttpRepository {
  constructor(private readonly source: DataSource) {}

  queue(shipmentExternalId: string, actorId: number) {
    return this.source.transaction(async (manager) => {
      // Serialize producers without taking locks in the worker's run/Shipment order.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 16))',
        [shipmentExternalId],
      );

      const carriers: Array<{ external_id: string }> = await manager.query(
        `SELECT carrier.external_id FROM carriers carrier JOIN shipments shipment ON shipment.carrier_id = carrier.id
         WHERE shipment.external_id = $1 AND shipment.deleted_at IS NULL`,
        [shipmentExternalId],
      );

      if (!carriers[0]) return { kind: 'missing' as const };

      const tx = new TypeOrmTrackingTransaction(manager);
      const carrier = await tx.lockAvailableCarrier(carriers[0].external_id);

      if (!carrier) return { kind: 'unavailable' as const };

      const shipment = (
        await tx.lockTargetShipments([shipmentExternalId], carrier.id)
      )[0];

      if (!shipment) return { kind: 'missing' as const };

      const existing: Array<{ external_id: string }> = await manager.query(
        `SELECT run.external_id FROM tracking_runs run JOIN tracking_attempts attempt ON attempt.tracking_run_id = run.id
         WHERE attempt.shipment_id = $1 AND run.trigger = 'manual' AND run.status IN ('queued', 'running')
         ORDER BY run.created_at, run.id LIMIT 1`,
        [shipment.id],
      );

      if (existing[0]) {
        // Read without locking the run: a worker may hold it while waiting for our Shipment share lock.
        const rows: TrackingRunRecord[] = await manager.query(
          `SELECT external_id AS "externalId", trigger, status, fetch_mode AS "fetchMode",
           created_at AS "createdAt", started_at AS "startedAt", completed_at AS "completedAt", 1 AS "attemptCount"
           FROM tracking_runs WHERE external_id = $1`,
          [existing[0].external_id],
        );

        return { kind: 'accepted' as const, run: rows[0]! };
      }

      if (
        shipment.monitoringStatus !== 'active' &&
        !(
          shipment.monitoringStatus === 'paused' &&
          ['not_found_threshold', 'failure_threshold'].includes(
            shipment.monitoringReason ?? '',
          )
        )
      )
        return { kind: 'unavailable' as const };

      const run = await tx.insertRun(
        {
          carrierExternalId: carriers[0].external_id,
          shipmentExternalIds: [shipmentExternalId],
          trigger: 'manual',
          requestedById: actorId,
        },
        carrier.id,
      );

      await tx.insertAttempts(run.id, [shipment.id]);

      return { kind: 'accepted' as const, run: trackingRunRecord(run, 1) };
    });
  }

  async find(externalId: string): Promise<RunStatus | null> {
    const rows: RunStatus[] = await this.source.query(
      `SELECT run.external_id AS "externalId", run.trigger, run.status, run.fetch_mode AS "fetchMode",
       carrier.external_id AS "carrierExternalId", run.reason_code AS "reasonCode",
       run.created_at AS "createdAt", run.started_at AS "startedAt", run.completed_at AS "completedAt",
       count(attempt.id)::integer AS "attemptCount",
       jsonb_agg(jsonb_build_object('shipmentExternalId', shipment.external_id, 'outcome', attempt.outcome,
         'snapshotChanged', attempt.snapshot_changed, 'retryable', attempt.retryable,
         'reasonCode', attempt.reason_code, 'completedAt', attempt.completed_at) ORDER BY attempt.id) AS attempts
       FROM tracking_runs run JOIN carriers carrier ON carrier.id = run.carrier_id
       JOIN tracking_attempts attempt ON attempt.tracking_run_id = run.id
       JOIN shipments shipment ON shipment.id = attempt.shipment_id
       WHERE run.external_id = $1 GROUP BY run.id, carrier.external_id`,
      [externalId],
    );

    return rows[0] ?? null;
  }
}
