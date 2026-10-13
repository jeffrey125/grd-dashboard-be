import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CarrierFetchMode1791936000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE carriers ADD COLUMN fetch_mode varchar(10) NOT NULL DEFAULT 'request',
      ADD CONSTRAINT ck_carriers_fetch_mode CHECK (fetch_mode IN ('request', 'browser'))`);
    await queryRunner.query(
      "UPDATE carriers SET fetch_mode = 'browser' WHERE code = 'ffe'",
    );
    // Old and queued runs have no observed mode. Never invent historical evidence.
    await queryRunner.query(`ALTER TABLE tracking_runs ADD COLUMN fetch_mode varchar(10),
      ADD CONSTRAINT ck_runs_fetch_mode CHECK (fetch_mode IN ('request', 'browser'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE tracking_runs DROP COLUMN fetch_mode');
    await queryRunner.query('ALTER TABLE carriers DROP COLUMN fetch_mode');
  }
}
