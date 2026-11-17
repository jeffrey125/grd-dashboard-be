import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UpcomingShipmentAccess1794873600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE upcoming_shipment_rep_access (
      account_id integer NOT NULL,
      rep_id varchar(17) NOT NULL,
      kind varchar(8) NOT NULL,
      CONSTRAINT pk_upcoming_access PRIMARY KEY (account_id, rep_id),
      CONSTRAINT ck_upcoming_access_kind CHECK (kind IN ('own', 'assigned')),
      CONSTRAINT ck_upcoming_access_rep CHECK (rep_id ~ '^rec[A-Za-z0-9]{14}$'),
      CONSTRAINT fk_upcoming_access_account FOREIGN KEY (account_id)
        REFERENCES auth_users(id) ON DELETE NO ACTION
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_upcoming_access_own
      ON upcoming_shipment_rep_access(account_id) WHERE kind = 'own'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE upcoming_shipment_rep_access');
  }
}
