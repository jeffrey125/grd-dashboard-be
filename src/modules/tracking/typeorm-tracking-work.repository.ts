import { DataSource } from 'typeorm';
import { monitoringWindowOpenSql } from '@modules/shipments/typeorm-delivered-monitoring.js';
import {
  TRACKING_WORK_REPOSITORY,
  type TrackingWorkRepository,
} from './tracking-work.repository.js';

export class TypeOrmTrackingWorkRepository implements TrackingWorkRepository {
  constructor(private readonly source: DataSource) {}

  async findDue(
    carrierExternalId: string,
    minimumIntervalMinutes: number,
  ): Promise<string[]> {
    const rows: Array<{ external_id: string }> = await this.source.query(
      `SELECT shipment.external_id
         FROM shipments shipment
         JOIN carriers carrier ON carrier.id = shipment.carrier_id
        WHERE carrier.external_id = $1 AND carrier.code <> 'other' AND carrier.is_active AND carrier.deleted_at IS NULL
          AND shipment.deleted_at IS NULL AND shipment.monitoring_status = 'active'
          AND shipment.next_check_at <= statement_timestamp()
          AND ${monitoringWindowOpenSql('shipment')}
          AND NOT EXISTS (
            SELECT 1 FROM tracking_attempts attempt
            JOIN tracking_runs run ON run.id = attempt.tracking_run_id
            WHERE attempt.shipment_id = shipment.id AND run.trigger = 'scheduled'
              AND attempt.outcome IN ('found', 'not_found', 'failed')
              AND (attempt.reason_code IS NULL OR attempt.reason_code NOT IN ('WORKER_SHUTDOWN', 'WORKER_INTERRUPTED'))
              AND attempt.completed_at + ($2::integer * interval '1 minute') > statement_timestamp()
          )
        ORDER BY shipment.next_check_at, shipment.id`,
      [carrierExternalId, minimumIntervalMinutes],
    );

    return rows.map((row) => row.external_id);
  }

  async nextManual() {
    const rows: Array<{ external_id: string; carrier_external_id: string }> =
      await this.source.query(
        `SELECT run.external_id, carrier.external_id AS carrier_external_id
       FROM tracking_runs run JOIN carriers carrier ON carrier.id = run.carrier_id
       WHERE run.status = 'queued' AND run.trigger = 'manual'
       ORDER BY run.created_at, run.id LIMIT 1`,
      );

    return rows[0]
      ? {
          externalId: rows[0].external_id,
          carrierExternalId: rows[0].carrier_external_id,
        }
      : null;
  }

  async interruptedRuns(): Promise<string[]> {
    const rows: Array<{ external_id: string }> = await this.source.query(
      "SELECT external_id FROM tracking_runs WHERE status = 'running' ORDER BY id",
    );

    return rows.map((row) => row.external_id);
  }

  async abandonedScheduledRuns(): Promise<string[]> {
    const rows: Array<{ external_id: string }> = await this.source.query(
      "SELECT external_id FROM tracking_runs WHERE status = 'queued' AND trigger = 'scheduled' ORDER BY id",
    );

    return rows.map((row) => row.external_id);
  }
}

export const trackingWorkRepositoryProvider = {
  provide: TRACKING_WORK_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): TrackingWorkRepository =>
    new TypeOrmTrackingWorkRepository(source),
};
