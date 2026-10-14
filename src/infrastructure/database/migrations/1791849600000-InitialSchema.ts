import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1791849600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // PostgreSQL provides this built-in; do not install extensions at startup.
    await runner.query('SELECT gen_random_uuid()');
    await runner.query(
      `CREATE TYPE shipment_monitoring_status AS ENUM ('active', 'paused', 'completed')`,
    );
    await runner.query(
      `CREATE TYPE shipment_monitoring_reason AS ENUM ('manual', 'not_found_threshold', 'delivered')`,
    );
    await runner.query(
      `CREATE TYPE tracking_run_trigger AS ENUM ('scheduled', 'manual')`,
    );
    await runner.query(
      `CREATE TYPE tracking_run_status AS ENUM ('queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled')`,
    );
    await runner.query(
      `CREATE TYPE tracking_attempt_outcome AS ENUM ('pending', 'found', 'not_found', 'failed', 'skipped')`,
    );
    await runner.query(`CREATE TABLE carriers (
      id integer GENERATED ALWAYS AS IDENTITY CONSTRAINT "PK_fe886e72b3d9f67da3ce70f4368" PRIMARY KEY,
      external_id uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT "UQ_ef3f117b3f1d13d0c7d0f6d3613" UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      created_by_id integer,
      updated_by_id integer,
      deleted_by_id integer,
      code varchar(50) NOT NULL CONSTRAINT uq_carriers_code UNIQUE,
      name varchar(100) NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      not_found_pause_threshold smallint NOT NULL DEFAULT 5,
      poll_interval_minutes smallint NOT NULL,
      rate_limit_per_minute smallint,
      CONSTRAINT ck_carriers_threshold CHECK (not_found_pause_threshold >= 2),
      CONSTRAINT ck_carriers_interval CHECK (poll_interval_minutes >= 1),
      CONSTRAINT ck_carriers_rate_limit CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute >= 1)
    )`);
    await runner.query(`CREATE TABLE shipments (
      id integer GENERATED ALWAYS AS IDENTITY CONSTRAINT "PK_6deda4532ac542a93eab214b564" PRIMARY KEY,
      external_id uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT "UQ_8a60c13ead6acaf67e2f7ad371d" UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      created_by_id integer,
      updated_by_id integer,
      deleted_by_id integer,
      carrier_id integer NOT NULL,
      tracking_reference varchar(255) NOT NULL,
      notes varchar(500),
      verification_url text,
      monitoring_status shipment_monitoring_status NOT NULL DEFAULT 'active',
      monitoring_reason shipment_monitoring_reason,
      current_tracking_snapshot_id bigint,
      last_attempted_at timestamptz,
      next_check_at timestamptz,
      consecutive_not_found_count integer NOT NULL DEFAULT 0,
      lock_version integer NOT NULL DEFAULT 1,
      CONSTRAINT fk_shipments_carrier FOREIGN KEY (carrier_id) REFERENCES carriers (id) ON DELETE NO ACTION,
      CONSTRAINT ck_shipments_not_found CHECK (consecutive_not_found_count >= 0),
      CONSTRAINT ck_shipments_version CHECK (lock_version >= 1),
      CONSTRAINT ck_shipments_monitoring CHECK (((monitoring_status = 'active' AND monitoring_reason IS NULL)
        OR (monitoring_status = 'paused' AND monitoring_reason IN ('manual', 'not_found_threshold'))
        OR (monitoring_status = 'completed' AND monitoring_reason = 'delivered')) IS TRUE)
    )`);
    await runner.query(`CREATE TABLE shipment_tracking_snapshots (
      id bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT "PK_a2883a056f1e9100d94a1ccd890" PRIMARY KEY,
      shipment_id integer NOT NULL,
      carrier_status varchar(255),
      carrier_status_detail text,
      picked_up_on date,
      estimated_delivery_on date,
      delivered_on date,
      observed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_snapshots_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE NO ACTION,
      CONSTRAINT uq_snapshots_owner UNIQUE (shipment_id, id),
      CONSTRAINT ck_snapshots_tracking_data CHECK (carrier_status IS NOT NULL OR carrier_status_detail IS NOT NULL
        OR picked_up_on IS NOT NULL OR estimated_delivery_on IS NOT NULL OR delivered_on IS NOT NULL)
    )`);
    await runner.query(`ALTER TABLE shipments ADD CONSTRAINT fk_shipments_current_snapshot
      FOREIGN KEY (id, current_tracking_snapshot_id) REFERENCES shipment_tracking_snapshots (shipment_id, id) ON DELETE NO ACTION`);
    await runner.query(`CREATE TABLE tracking_runs (
      id bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT "PK_f8a4df026e68941b9ee3770a1aa" PRIMARY KEY,
      external_id uuid NOT NULL DEFAULT gen_random_uuid() CONSTRAINT "UQ_4d2807359b3f89ce09e88f5a29b" UNIQUE,
      carrier_id integer NOT NULL,
      trigger tracking_run_trigger NOT NULL,
      status tracking_run_status NOT NULL DEFAULT 'queued',
      reason_code varchar(100),
      message text,
      requested_by_id integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      CONSTRAINT fk_runs_carrier FOREIGN KEY (carrier_id) REFERENCES carriers (id) ON DELETE NO ACTION,
      CONSTRAINT ck_runs_timestamps CHECK ((status = 'queued' AND started_at IS NULL AND completed_at IS NULL)
        OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
        OR (status IN ('succeeded', 'partially_succeeded', 'failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL)
        OR (status = 'cancelled' AND completed_at IS NOT NULL))
    )`);
    await runner.query(`CREATE TABLE tracking_attempts (
      id bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT "PK_0dc2a69f79af4d89362726d152e" PRIMARY KEY,
      tracking_run_id bigint NOT NULL,
      shipment_id integer NOT NULL,
      outcome tracking_attempt_outcome NOT NULL DEFAULT 'pending',
      snapshot_id bigint,
      snapshot_changed boolean NOT NULL DEFAULT false,
      source_data jsonb,
      retryable boolean,
      reason_code varchar(100),
      message text,
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT fk_attempts_run FOREIGN KEY (tracking_run_id) REFERENCES tracking_runs (id) ON DELETE NO ACTION,
      CONSTRAINT fk_attempts_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE NO ACTION,
      CONSTRAINT fk_attempts_snapshot FOREIGN KEY (shipment_id, snapshot_id) REFERENCES shipment_tracking_snapshots (shipment_id, id) ON DELETE NO ACTION,
      CONSTRAINT uq_attempts_run_shipment UNIQUE (tracking_run_id, shipment_id),
      CONSTRAINT ck_attempts_source_object CHECK (source_data IS NULL OR jsonb_typeof(source_data) = 'object'),
      CONSTRAINT ck_attempts_completion CHECK ((outcome = 'pending' AND completed_at IS NULL)
        OR (outcome <> 'pending' AND completed_at IS NOT NULL)),
      CONSTRAINT ck_attempts_snapshot CHECK ((outcome = 'found' AND snapshot_id IS NOT NULL)
        OR (outcome <> 'found' AND snapshot_id IS NULL)),
      CONSTRAINT ck_attempts_changed CHECK (NOT snapshot_changed OR outcome = 'found'),
      CONSTRAINT ck_attempts_failure CHECK ((outcome = 'failed' AND retryable IS NOT NULL AND reason_code IS NOT NULL)
        OR (outcome <> 'failed' AND retryable IS NULL)),
      CONSTRAINT ck_attempts_skip CHECK (outcome <> 'skipped' OR reason_code IS NOT NULL)
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_shipments_active_reference ON shipments (carrier_id, tracking_reference) WHERE deleted_at IS NULL`,
    );
    await runner.query(
      'CREATE INDEX ix_shipments_carrier ON shipments (carrier_id)',
    );
    await runner.query(
      `CREATE INDEX ix_shipments_due ON shipments (next_check_at, id) WHERE deleted_at IS NULL AND monitoring_status = 'active'`,
    );
    await runner.query(
      'CREATE INDEX ix_snapshots_history ON shipment_tracking_snapshots (shipment_id, observed_at DESC, id DESC)',
    );
    await runner.query(
      'CREATE INDEX ix_runs_carrier_created ON tracking_runs (carrier_id, created_at DESC)',
    );
    await runner.query(
      'CREATE INDEX ix_runs_status_created ON tracking_runs (status, created_at)',
    );
    await runner.query(
      'CREATE INDEX ix_attempts_shipment_started ON tracking_attempts (shipment_id, started_at DESC)',
    );
    await runner.query(
      'CREATE INDEX ix_attempts_run_outcome ON tracking_attempts (tracking_run_id, outcome)',
    );
    await runner.query(`CREATE FUNCTION reject_identifier_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
          OR (to_jsonb(NEW) -> 'external_id') IS DISTINCT FROM (to_jsonb(OLD) -> 'external_id') THEN
          RAISE EXCEPTION 'Identifiers are immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$`);

    for (const table of [
      'carriers',
      'shipments',
      'tracking_runs',
      'tracking_attempts',
    ]) {
      await runner.query(`CREATE TRIGGER immutable_identifiers BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_identifier_update()`);
    }

    // Snapshots protect the entire row, including their generated identity.
    await runner.query(`CREATE FUNCTION reject_snapshot_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'Tracking snapshots are immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON shipment_tracking_snapshots
      FOR EACH ROW EXECUTE FUNCTION reject_snapshot_update()`);
    await runner.query(`INSERT INTO carriers
      (code, name, poll_interval_minutes, not_found_pause_threshold, rate_limit_per_minute)
      VALUES ('ups', 'UPS', 30, 5, 10), ('echoship', 'EchoShip', 5, 5, NULL), ('ffe', 'FFE', 5, 5, NULL)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE tracking_attempts');
    await runner.query('DROP TABLE tracking_runs');
    await runner.query(
      'ALTER TABLE shipments DROP CONSTRAINT fk_shipments_current_snapshot',
    );
    await runner.query('DROP TABLE shipment_tracking_snapshots');
    await runner.query('DROP TABLE shipments');
    await runner.query('DROP TABLE carriers');
    await runner.query('DROP FUNCTION reject_snapshot_update()');
    await runner.query('DROP FUNCTION reject_identifier_update()');
    await runner.query('DROP TYPE tracking_attempt_outcome');
    await runner.query('DROP TYPE tracking_run_status');
    await runner.query('DROP TYPE tracking_run_trigger');
    await runner.query('DROP TYPE shipment_monitoring_reason');
    await runner.query('DROP TYPE shipment_monitoring_status');
  }
}
