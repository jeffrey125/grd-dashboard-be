import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackingReadProjection1792281600000 implements MigrationInterface {
  name = 'TrackingReadProjection1792281600000';

  async up(runner: QueryRunner): Promise<void> {
    // A volatile default assigns each existing row its own UUID during ALTER;
    // no UPDATE or disabling of the immutable-snapshot trigger is necessary.
    await runner.query(`ALTER TABLE shipment_tracking_snapshots
      ADD COLUMN external_id uuid NOT NULL DEFAULT gen_random_uuid(),
      ADD CONSTRAINT uq_snapshots_external_id UNIQUE (external_id)`);
    await runner.query(`CREATE INDEX ix_attempts_shipment_completed
      ON tracking_attempts (shipment_id, completed_at DESC, id DESC)
      WHERE completed_at IS NOT NULL`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX ix_attempts_shipment_completed');
    // Rollback discards public snapshot identities; reapplying generates new ones.
    await runner.query(
      'ALTER TABLE shipment_tracking_snapshots DROP COLUMN external_id',
    );
  }
}
