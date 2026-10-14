import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackingEvents1792195200000 implements MigrationInterface {
  name = 'TrackingEvents1792195200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE FUNCTION grd_announce_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify('grd_changes', json_build_object('type', TG_ARGV[0], 'externalId', NEW.external_id)::text);
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER shipments_announce_change AFTER INSERT OR UPDATE ON shipments
      FOR EACH ROW EXECUTE FUNCTION grd_announce_change('shipment.changed')`);
    await runner.query(`CREATE TRIGGER runs_announce_change AFTER INSERT OR UPDATE ON tracking_runs
      FOR EACH ROW EXECUTE FUNCTION grd_announce_change('run.changed')`);
    // Attempt completion changes a running run's HTTP status projection too.
    await runner.query(`CREATE FUNCTION grd_announce_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify('grd_changes', json_build_object('type', 'run.changed', 'externalId',
          (SELECT external_id FROM tracking_runs WHERE id = NEW.tracking_run_id))::text);
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER attempts_announce_change AFTER UPDATE ON tracking_attempts
      FOR EACH ROW EXECUTE FUNCTION grd_announce_attempt()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TRIGGER attempts_announce_change ON tracking_attempts',
    );
    await runner.query('DROP FUNCTION grd_announce_attempt()');
    await runner.query('DROP TRIGGER runs_announce_change ON tracking_runs');
    await runner.query('DROP TRIGGER shipments_announce_change ON shipments');
    await runner.query('DROP FUNCTION grd_announce_change()');
  }
}
