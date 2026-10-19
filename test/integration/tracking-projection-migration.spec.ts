import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { ShipmentTrackingSnapshotEntity } from '@modules/tracking/shipment-tracking-snapshot.entity.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;

beforeAll(async () => {
  db = await shipmentDatabase();
});
afterAll(async () => {
  await db?.close();
});

it('backfills unique immutable public identities without changing populated history or ownership', async () => {
  await db.source.undoLastMigration(); // Quote comparison migration.
  await db.source.undoLastMigration(); // Sales Rep and follow-up migration.
  await db.source.undoLastMigration(); // Precise event migration.
  await db.source.undoLastMigration(); // Tracking projection migration.

  const [shipment] = await db.source
    .query(`INSERT INTO shipments (carrier_id, tracking_reference)
    SELECT id, 'migration' FROM carriers WHERE code = 'ups' RETURNING *`);
  const before = await db.source.query(
    `INSERT INTO shipment_tracking_snapshots
    (shipment_id, carrier_status, estimated_delivery_on, observed_at)
    VALUES ($1, 'First', '2026-11-01', '2026-10-01'), ($1, 'Second', '2026-11-02', '2026-10-02') RETURNING *`,
    [shipment.id],
  );

  await db.source.query(
    'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
    [before[0].id, shipment.id],
  );

  const [run] = await db.source.query(
    `INSERT INTO tracking_runs (carrier_id, trigger) VALUES ($1, 'scheduled') RETURNING id`,
    [shipment.carrier_id],
  );

  await db.source.query(
    `INSERT INTO tracking_attempts (tracking_run_id, shipment_id, outcome, snapshot_id, completed_at)
    VALUES ($1, $2, 'found', $3, now())`,
    [run.id, shipment.id, before[0].id],
  );
  await db.source.runMigrations();

  const after = await db.source.query(
    'SELECT * FROM shipment_tracking_snapshots ORDER BY id',
  );

  expect(
    after.map(
      ({ external_id: _uuid, ...facts }: Record<string, unknown>) => facts,
    ),
  ).toEqual(before);
  expect(
    new Set(after.map((row: { external_id: string }) => row.external_id)).size,
  ).toBe(2);

  for (const row of after) {
    expect(z.uuidv4().safeParse(row.external_id).success).toBe(true);
    await expect(
      db.source.query(
        'UPDATE shipment_tracking_snapshots SET external_id = gen_random_uuid() WHERE id = $1',
        [row.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await expect(
      db.source.query(
        "UPDATE shipment_tracking_snapshots SET carrier_status = 'Rewritten' WHERE id = $1",
        [row.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  }

  expect(
    await db.source.query(
      'SELECT current_tracking_snapshot_id FROM shipments WHERE id = $1',
      [shipment.id],
    ),
  ).toEqual([{ current_tracking_snapshot_id: before[0].id }]);
  expect(
    await db.source.query(
      'SELECT snapshot_id FROM tracking_attempts WHERE shipment_id = $1',
      [shipment.id],
    ),
  ).toEqual([{ snapshot_id: before[0].id }]);

  await expect(
    db.source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, external_id) VALUES ($1, 'Duplicate', $2)`,
      [shipment.id, after[0].external_id],
    ),
  ).rejects.toMatchObject({ driverError: { code: '23505' } });
  await expect(
    db.source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, external_id) VALUES ($1, 'Null', NULL)`,
      [shipment.id],
    ),
  ).rejects.toMatchObject({ driverError: { code: '23502' } });

  const generated = await db.source
    .getRepository(ShipmentTrackingSnapshotEntity)
    .save({
      shipmentId: shipment.id,
      carrierStatus: 'New',
      externalId: after[0].external_id,
    });

  expect(z.uuidv4().safeParse(generated.externalId).success).toBe(true);
  expect(generated.externalId).not.toBe(after[0].external_id);

  await db.source.runMigrations();

  expect(
    (
      await db.source.query(
        'SELECT external_id FROM shipment_tracking_snapshots WHERE id = $1',
        [after[0].id],
      )
    )[0].external_id,
  ).toBe(after[0].external_id);

  await db.source.undoLastMigration(); // Quote comparison migration.
  await db.source.undoLastMigration(); // Sales Rep and follow-up migration.
  await db.source.undoLastMigration(); // Precise event migration.
  await db.source.undoLastMigration(); // Tracking projection migration.

  expect(
    await db.source.query(
      'SELECT * FROM shipment_tracking_snapshots WHERE id = ANY($1::bigint[]) ORDER BY id',
      [before.map((row: { id: string }) => row.id)],
    ),
  ).toEqual(before);

  await db.source.runMigrations();

  expect(
    await db.source.query(
      'SELECT current_tracking_snapshot_id FROM shipments WHERE id = $1',
      [shipment.id],
    ),
  ).toEqual([{ current_tracking_snapshot_id: before[0].id }]);
});
