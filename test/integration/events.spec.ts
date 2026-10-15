import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { TypeOrmEventsSource } from '@modules/events/typeorm-events.source.js';
import type { LiveEvent } from '@modules/events/events.source.js';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;

beforeAll(async () => {
  db = await shipmentDatabase();
});

it('reconnects a lost database listener and requires resync before subsequent changes', async () => {
  const events = new TypeOrmEventsSource(db.source, {
    warn: vi.fn(),
  } as unknown as ProjectLogger);
  const received: LiveEvent[] = [];
  const subscription = events.events.subscribe((event) => received.push(event));

  try {
    events.start();
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await db.source.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'grd-events'",
    );
    await vi.waitFor(
      () =>
        expect(
          received.filter((event) => event.type === 'resync'),
        ).toHaveLength(3),
      { timeout: 5000 },
    );

    const rows = await db.source.query(
      "INSERT INTO shipments (carrier_id, tracking_reference) SELECT id, 'event-recovery' FROM carriers WHERE code = 'ups' RETURNING external_id",
    );

    await vi.waitFor(() =>
      expect(received.at(-1)).toEqual({
        type: 'shipment.changed',
        externalId: rows[0].external_id,
      }),
    );
  } finally {
    subscription.unsubscribe();
    await events.onModuleDestroy();
  }

  expect(events.events.isStopped).toBe(true);
});
afterAll(async () => {
  await db?.close();
});
it('announces public IDs only after commit and emits nothing for rollback', async () => {
  const client = await (db.source.driver as PostgresDriver).master.connect();
  const messages: string[] = [];

  client.on('notification', (message: { payload: string }) =>
    messages.push(message.payload),
  );

  try {
    await client.query('LISTEN grd_changes');

    const runner = db.source.createQueryRunner();

    await runner.startTransaction();

    const rows = await runner.query(
      "INSERT INTO shipments (carrier_id, tracking_reference, next_check_at) SELECT id, 'event-test', now() FROM carriers WHERE code = 'ups' RETURNING external_id",
    );

    expect(messages).toEqual([]);

    await runner.commitTransaction();
    await runner.release();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(messages.map((value) => JSON.parse(value))).toEqual([
      { type: 'shipment.changed', externalId: rows[0].external_id },
    ]);

    await db.source
      .transaction(async (manager) => {
        await manager.query(
          "UPDATE shipments SET notes = 'rollback' WHERE external_id = $1",
          [rows[0].external_id],
        );

        throw new Error('rollback');
      })
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(messages).toHaveLength(1);
  } finally {
    await client.query('UNLISTEN *');
    client.release();
  }
});

it('announces only committed current-snapshot changes with exact public snapshot data', async () => {
  const client = await (db.source.driver as PostgresDriver).master.connect();
  const messages: Array<Record<string, unknown>> = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  client.on('notification', (message: { payload: string }) =>
    messages.push(JSON.parse(message.payload)),
  );

  try {
    await client.query('LISTEN grd_changes');

    const shipments = await db.source.query(
      "INSERT INTO shipments (carrier_id, tracking_reference) SELECT id, 'precise-event-test' FROM carriers WHERE code = 'ups' RETURNING id, external_id",
    );

    await settle();
    messages.length = 0;

    const firstSnapshot = await db.source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, observed_at)
       VALUES ($1, 'Moving', '2026-10-16T08:00:00+08:00')
       RETURNING id, external_id`,
      [shipments[0].id],
    );

    await settle();
    expect(messages).toEqual([]);

    const runner = db.source.createQueryRunner();

    await runner.startTransaction();
    await runner.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [firstSnapshot[0].id, shipments[0].id],
    );
    await settle();
    expect(messages).toEqual([]);
    await runner.commitTransaction();
    await runner.release();
    await vi.waitFor(() => expect(messages).toHaveLength(2));

    expect(messages).toContainEqual({
      type: 'tracking.changed',
      externalId: shipments[0].external_id,
      snapshotExternalId: firstSnapshot[0].external_id,
      observedAt: '2026-10-16T00:00:00+00:00',
    });
    expect(messages).toContainEqual({
      type: 'shipment.changed',
      externalId: shipments[0].external_id,
    });

    messages.length = 0;

    const unrelatedUpdates = [
      "UPDATE shipments SET notes = 'dispatch note' WHERE id = $1",
      'UPDATE shipments SET next_check_at = now() WHERE id = $1',
      "UPDATE shipments SET monitoring_status = 'paused', monitoring_reason = 'manual' WHERE id = $1",
      "UPDATE shipments SET monitoring_status = 'active', monitoring_reason = NULL WHERE id = $1",
      'UPDATE shipments SET last_attempted_at = now() WHERE id = $1',
      'UPDATE shipments SET consecutive_not_found_count = consecutive_not_found_count + 1 WHERE id = $1',
      'UPDATE shipments SET current_tracking_snapshot_id = current_tracking_snapshot_id WHERE id = $1',
    ];

    for (const sql of unrelatedUpdates)
      await db.source.query(sql, [shipments[0].id]);

    await vi.waitFor(() =>
      expect(messages).toHaveLength(unrelatedUpdates.length),
    );
    expect(messages).toEqual(
      unrelatedUpdates.map(() => ({
        type: 'shipment.changed',
        externalId: shipments[0].external_id,
      })),
    );

    messages.length = 0;

    const secondSnapshot = await db.source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, observed_at)
       VALUES ($1, 'Delivered', '2026-10-17T09:30:00+08:00')
       RETURNING id, external_id`,
      [shipments[0].id],
    );

    await db.source
      .transaction(async (manager) => {
        await manager.query(
          'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
          [secondSnapshot[0].id, shipments[0].id],
        );

        throw new Error('rollback');
      })
      .catch(() => {});
    await settle();
    expect(messages).toEqual([]);

    await db.source.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [secondSnapshot[0].id, shipments[0].id],
    );
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    expect(messages).toContainEqual({
      type: 'tracking.changed',
      externalId: shipments[0].external_id,
      snapshotExternalId: secondSnapshot[0].external_id,
      observedAt: '2026-10-17T01:30:00+00:00',
    });
  } finally {
    await client.query('UNLISTEN *');
    client.release();
  }
});
