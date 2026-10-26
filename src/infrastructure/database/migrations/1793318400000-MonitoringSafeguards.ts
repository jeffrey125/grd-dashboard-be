import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MonitoringSafeguards1793318400000 implements MigrationInterface {
  name = 'MonitoringSafeguards1793318400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE carriers
      ADD failure_pause_enabled boolean NOT NULL DEFAULT true,
      ADD failure_pause_threshold smallint NOT NULL DEFAULT 2,
      ADD session_failure_disable_enabled boolean NOT NULL DEFAULT true,
      ADD session_failure_disable_threshold smallint NOT NULL DEFAULT 2,
      ADD consecutive_session_failures integer NOT NULL DEFAULT 0,
      ADD session_generation integer NOT NULL DEFAULT 0,
      ADD auto_disabled_reason varchar(50),
      ADD CONSTRAINT ck_carriers_failure_threshold CHECK (failure_pause_threshold BETWEEN 1 AND 10),
      ADD CONSTRAINT ck_carriers_session_threshold CHECK (session_failure_disable_threshold BETWEEN 1 AND 10),
      ADD CONSTRAINT ck_carriers_session_failures CHECK (consecutive_session_failures >= 0),
      ADD CONSTRAINT ck_carriers_session_generation CHECK (session_generation >= 0),
      ADD CONSTRAINT ck_carriers_disabled_reason CHECK (auto_disabled_reason IS NULL OR (auto_disabled_reason = 'session_failures' AND NOT is_active))`);
    await runner.query(`ALTER TABLE shipments ADD consecutive_failure_count integer NOT NULL DEFAULT 0,
      ADD CONSTRAINT ck_shipments_failures CHECK (consecutive_failure_count >= 0)`);
    await runner.query(`ALTER TABLE tracking_runs
      ADD session_failure_recorded boolean NOT NULL DEFAULT false,
      ADD session_generation integer NOT NULL DEFAULT 0`);
    // Recreate the enum so the new value can be used in the same atomic migration.
    await runner.query(
      'ALTER TABLE shipments DROP CONSTRAINT ck_shipments_monitoring',
    );
    await runner.query(
      'ALTER TYPE shipment_monitoring_reason RENAME TO shipment_monitoring_reason_old',
    );
    await runner.query(
      "CREATE TYPE shipment_monitoring_reason AS ENUM ('manual', 'not_found_threshold', 'delivered', 'failure_threshold')",
    );
    await runner.query(
      'ALTER TABLE shipments ALTER COLUMN monitoring_reason TYPE shipment_monitoring_reason USING monitoring_reason::text::shipment_monitoring_reason',
    );
    await runner.query('DROP TYPE shipment_monitoring_reason_old');
    await runner.query(`ALTER TABLE shipments ADD CONSTRAINT ck_shipments_monitoring CHECK (
      ((monitoring_status = 'active' AND monitoring_reason IS NULL)
      OR (monitoring_status = 'paused' AND monitoring_reason IN ('manual', 'not_found_threshold', 'failure_threshold'))
      OR (monitoring_status = 'completed' AND monitoring_reason = 'delivered')) IS TRUE)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE shipments DROP CONSTRAINT ck_shipments_monitoring',
    );
    // Preserve stopped monitoring on rollback; the older application supports manual pauses.
    await runner.query(
      "UPDATE shipments SET monitoring_reason = 'manual' WHERE monitoring_reason = 'failure_threshold'",
    );
    await runner.query(
      'ALTER TYPE shipment_monitoring_reason RENAME TO shipment_monitoring_reason_old',
    );
    await runner.query(
      "CREATE TYPE shipment_monitoring_reason AS ENUM ('manual', 'not_found_threshold', 'delivered')",
    );
    await runner.query(
      'ALTER TABLE shipments ALTER COLUMN monitoring_reason TYPE shipment_monitoring_reason USING monitoring_reason::text::shipment_monitoring_reason',
    );
    await runner.query('DROP TYPE shipment_monitoring_reason_old');
    await runner.query(`ALTER TABLE shipments ADD CONSTRAINT ck_shipments_monitoring CHECK (
      ((monitoring_status = 'active' AND monitoring_reason IS NULL)
      OR (monitoring_status = 'paused' AND monitoring_reason IN ('manual', 'not_found_threshold'))
      OR (monitoring_status = 'completed' AND monitoring_reason = 'delivered')) IS TRUE)`);
    await runner.query(
      'ALTER TABLE shipments DROP COLUMN consecutive_failure_count',
    );
    await runner.query(
      'ALTER TABLE tracking_runs DROP COLUMN session_failure_recorded, DROP COLUMN session_generation',
    );
    await runner.query(`ALTER TABLE carriers DROP COLUMN failure_pause_enabled, DROP COLUMN failure_pause_threshold,
      DROP COLUMN session_failure_disable_enabled, DROP COLUMN session_failure_disable_threshold,
      DROP COLUMN consecutive_session_failures, DROP COLUMN session_generation, DROP COLUMN auto_disabled_reason`);
  }
}
