import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ShipmentBusinessFields1793664000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE shipments
      ADD COLUMN po_number varchar(255),
      ADD COLUMN customer varchar(255),
      ADD COLUMN vendor varchar(255)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE shipments
      DROP COLUMN vendor, DROP COLUMN customer, DROP COLUMN po_number`);
  }
}
