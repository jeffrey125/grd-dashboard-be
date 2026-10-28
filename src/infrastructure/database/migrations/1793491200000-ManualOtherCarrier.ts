import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ManualOtherCarrier1793491200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO carriers (code, name, is_active, poll_interval_minutes,
      failure_pause_enabled, session_failure_disable_enabled)
      VALUES ('other', 'Other', true, 30, false, false)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Existing shipment foreign keys intentionally prevent deleting used carriers.
    await queryRunner.query("DELETE FROM carriers WHERE code = 'other'");
  }
}
