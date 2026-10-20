import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';

const tables = [
  'shipping_providers',
  'shipping_accounts',
  'quote_requests',
  'quote_package_groups',
  'quote_customs_items',
  'quote_provider_attempts',
  'shipping_quotes',
  'shipping_quote_items',
];
describe('Quote persistence contract', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  beforeAll(async () => {
    db = await shipmentDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });
  it('migrates down/up and maps all eight tables with only NO ACTION foreign keys', async () => {
    await db.source.undoLastMigration(); // Provider administration migration.
    await db.source.undoLastMigration(); // History and retry migration.
    await db.source.undoLastMigration(); // International quote options migration.
    await db.source.undoLastMigration(); // Optional package dimensions migration.
    await db.source.undoLastMigration(); // Amazon quote breakdown migration.
    await db.source.undoLastMigration(); // Quote execution migration.
    await db.source.undoLastMigration(); // Quote comparison migration.
    expect(
      await db.source.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1)",
        [tables],
      ),
    ).toEqual([]);
    await db.source.runMigrations();
    expect(db.source.entityMetadatas.map((m) => m.tableName)).toEqual(
      expect.arrayContaining(tables),
    );
    const foreignKeys = await db.source.query(
      "SELECT confdeltype FROM pg_constraint WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname=ANY($1))",
      [tables],
    );
    expect(foreignKeys.length).toBeGreaterThan(8);
    expect(
      foreignKeys.every((f: { confdeltype: string }) => f.confdeltype === 'a'),
    ).toBe(true);
    await expect(
      db.source.query(
        'INSERT INTO shipping_accounts(provider_id) SELECT id FROM shipping_providers LIMIT 1',
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      db.source.query('DELETE FROM shipping_providers'),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
});
