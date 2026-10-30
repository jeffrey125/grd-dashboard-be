import { afterAll, beforeAll, expect, it } from 'vitest';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;
beforeAll(async () => {
  db = await shipmentDatabase();
});
afterAll(async () => {
  await db?.close();
});

it('migrates opaque legacy references and warehouse markers without changing audit or soft deletion', async () => {
  await db.source.undoLastMigration();
  const [carrier] = await db.source.query(
    "SELECT id FROM carriers WHERE code = 'ups'",
  );
  const before = await db.source.query(
    `INSERT INTO shipments (carrier_id, tracking_reference, po_number, deleted_at)
    VALUES ($1, 'legacy-warehouse', '0', NULL), ($1, 'legacy-deleted', '0001, LEGACY', now())
    RETURNING id, po_number, created_at, updated_at, lock_version, deleted_at`,
    [carrier.id],
  );
  await db.source.runMigrations();
  expect(
    await db.source.query(
      `SELECT shipment_id, po_number FROM shipment_purchase_orders ORDER BY shipment_id`,
    ),
  ).toEqual(
    before.map((row: { id: number; po_number: string }) => ({
      shipment_id: row.id,
      po_number: row.po_number,
    })),
  );
  expect(
    await db.source.query(
      'SELECT id, po_number, created_at, updated_at, lock_version, deleted_at FROM shipments ORDER BY id',
    ),
  ).toEqual(before);
  expect(
    await db.source.query('SELECT so_numbers, products FROM shipments'),
  ).toEqual([
    { so_numbers: [], products: [] },
    { so_numbers: [], products: [] },
  ]);
});

it('refuses a truncating downgrade and leaves all data and migration state intact', async () => {
  const repository = new TypeOrmShipmentsRepository(db.source);
  const [row] = await db.source.query(
    "SELECT external_id FROM shipments WHERE tracking_reference = 'legacy-warehouse'",
  );
  const numbers = ['a'.repeat(200), 'b'.repeat(200)];
  await repository.update(row.external_id, {
    poNumbers: numbers,
    soNumbers: ['00123'],
    products: ['Organic oats'],
  });
  await expect(db.source.undoLastMigration()).rejects.toMatchObject({
    driverError: { code: '22001' },
  });
  expect(await repository.find(row.external_id)).toMatchObject({
    poNumbers: numbers,
    soNumbers: ['00123'],
    products: ['Organic oats'],
  });
  expect(await db.source.showMigrations()).toBe(false);
});
