import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ShipmentOrderDetails1793750400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE shipments
      ALTER COLUMN po_number TYPE text,
      ADD COLUMN so_numbers varchar(255)[] NOT NULL DEFAULT '{}',
      ADD COLUMN products varchar(255)[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`CREATE TABLE purchase_orders (
      po_number varchar(255) PRIMARY KEY
    )`);
    await queryRunner.query(`CREATE TABLE shipment_purchase_orders (
      shipment_id integer NOT NULL,
      po_number varchar(255) NOT NULL,
      PRIMARY KEY (shipment_id, po_number),
      CONSTRAINT fk_shipment_purchase_orders_shipment FOREIGN KEY (shipment_id)
        REFERENCES shipments(id) ON DELETE NO ACTION,
      CONSTRAINT fk_shipment_purchase_orders_order FOREIGN KEY (po_number)
        REFERENCES purchase_orders(po_number) ON DELETE NO ACTION
    )`);
    await queryRunner.query(`CREATE INDEX ix_shipment_purchase_orders_number
      ON shipment_purchase_orders (po_number)`);
    // Existing references are opaque identifiers: never split an old value on commas.
    await queryRunner.query(`INSERT INTO purchase_orders (po_number)
      SELECT DISTINCT po_number FROM shipments WHERE po_number IS NOT NULL`);
    await queryRunner.query(`INSERT INTO shipment_purchase_orders (shipment_id, po_number)
      SELECT id, po_number FROM shipments WHERE po_number IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse a lossy rollback if any new display summary exceeds the old limit.
    await queryRunner.query(
      `ALTER TABLE shipments ALTER COLUMN po_number TYPE varchar(255)`,
    );
    await queryRunner.query('DROP TABLE shipment_purchase_orders');
    await queryRunner.query('DROP TABLE purchase_orders');
    await queryRunner.query(
      'ALTER TABLE shipments DROP COLUMN products, DROP COLUMN so_numbers',
    );
  }
}
