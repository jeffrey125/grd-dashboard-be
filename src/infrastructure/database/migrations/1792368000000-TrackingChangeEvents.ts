import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackingChangeEvents1792368000000 implements MigrationInterface {
  name = 'TrackingChangeEvents1792368000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE FUNCTION grd_announce_tracking_change() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        snapshot_external_id uuid;
        snapshot_observed_at timestamptz;
      BEGIN
        SELECT external_id, observed_at
          INTO STRICT snapshot_external_id, snapshot_observed_at
          FROM shipment_tracking_snapshots
          WHERE id = NEW.current_tracking_snapshot_id
            AND shipment_id = NEW.id;

        PERFORM pg_notify('grd_changes', json_build_object(
          'type', 'tracking.changed',
          'externalId', NEW.external_id,
          'snapshotExternalId', snapshot_external_id,
          'observedAt', snapshot_observed_at
        )::text);
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER shipments_announce_tracking_change
      AFTER UPDATE OF current_tracking_snapshot_id ON shipments
      FOR EACH ROW
      WHEN (
        OLD.current_tracking_snapshot_id IS DISTINCT FROM NEW.current_tracking_snapshot_id
        AND NEW.current_tracking_snapshot_id IS NOT NULL
      )
      EXECUTE FUNCTION grd_announce_tracking_change()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TRIGGER shipments_announce_tracking_change ON shipments',
    );
    await runner.query('DROP FUNCTION grd_announce_tracking_change()');
  }
}
