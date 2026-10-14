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
