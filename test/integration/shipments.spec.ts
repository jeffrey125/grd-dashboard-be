import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import {
  ShipmentEntity,
  ShipmentMonitoringReason,
  ShipmentMonitoringStatus,
} from '@modules/shipments/shipment.entity.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('Shipment PostgreSQL repository', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let repository: TypeOrmShipmentsRepository;
  let ups: CarrierEntity;
  let echo: CarrierEntity;

  beforeAll(async () => {
    db = await shipmentDatabase();
    repository = new TypeOrmShipmentsRepository(db.source);
    ups = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
    echo = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'echoship' });
  });
  afterAll(async () => {
    await db?.close();
  });

  async function create(reference: string) {
    const result = await repository.createMany([
      {
        carrierExternalId: ups.externalId,
        trackingReference: reference,
        notes: 'original',
      },
    ]);

    if (result.kind !== 'created') throw new Error('Expected creation');

    return result.inserted[0];
  }

  it('orders by newest creation with a deterministic tie-breaker', async () => {
    const oldest = await create('ordering-old');
    const first = await create('ordering-first');
    const second = await create('ordering-second');

    await db.source
      .getRepository(ShipmentEntity)
      .update(
        { externalId: oldest.externalId },
        { createdAt: new Date('2020-01-01T00:00:00Z') },
      );

    for (const row of [first, second])
      await db.source
        .getRepository(ShipmentEntity)
        .update(
          { externalId: row.externalId },
          { createdAt: new Date('2020-02-01T00:00:00Z') },
        );

    const ids = new Set([
      oldest.externalId,
      first.externalId,
      second.externalId,
    ]);

    expect(
      (await repository.list())
        .filter((row) => ids.has(row.externalId))
        .map((row) => row.externalId),
    ).toEqual([second.externalId, first.externalId, oldest.externalId]);
  });

  it('waits for a concurrent Carrier disable and rejects the complete batch after it commits', async () => {
    const carrier = await db.source.getRepository(CarrierEntity).save({
      code: 'disable-race',
      name: 'Disable race',
      pollIntervalMinutes: 5,
    });
    const runner = db.source.createQueryRunner();

    await runner.connect();
    await runner.startTransaction();

    let creation: ReturnType<typeof repository.createMany> | undefined;

    try {
      await runner.manager
        .getRepository(CarrierEntity)
        .update({ id: carrier.id }, { isActive: false });
      creation = repository.createMany([
        {
          carrierExternalId: ups.externalId,
          trackingReference: 'race-sibling',
          notes: null,
        },
        {
          carrierExternalId: carrier.externalId,
          trackingReference: 'race-disabled',
          notes: null,
        },
      ]);

      // Confirm that creation is actually blocked by this transaction before
      // releasing it; the test must exercise the race, not sequential requests.
      const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');

      await vi.waitFor(
        async () => {
          const blocked: Array<{ pid: number }> = await db.source.query(
            'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
            [pid],
          );

          expect(blocked.length).toBeGreaterThan(0);
        },
        { timeout: 3000, interval: 10 },
      );
      await runner.commitTransaction();

      expect(await creation).toEqual({
        kind: 'unavailable',
        carrierExternalIds: [carrier.externalId],
      });
      expect(
        (await repository.list()).some(
          (row) => row.trackingReference === 'race-sibling',
        ),
      ).toBe(false);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();

      await creation?.catch(() => undefined);
      await runner.release();
    }
  });

  it('updates notes, clears them, and soft-deletes without exposing or erasing history', async () => {
    const shipment = await create('lifecycle');
    const changed = await repository.updateNotes(
      shipment.externalId,
      'changed',
    );

    expect(changed).toMatchObject({
      notes: 'changed',
      createdAt: shipment.createdAt,
    });
    expect(
      await repository.updateNotes(shipment.externalId, null),
    ).toMatchObject({ notes: null });

    const row = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: shipment.externalId });
    const [snapshot] = await db.source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status) VALUES ($1, 'Known') RETURNING id`,
      [row.id],
    );

    await db.source.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [snapshot.id, row.id],
    );

    expect(await repository.remove(shipment.externalId)).toBe(true);
    expect(await repository.find(shipment.externalId)).toBeNull();
    expect(await repository.list()).not.toContainEqual(
      expect.objectContaining({ externalId: shipment.externalId }),
    );
    expect(
      await repository.updateNotes(shipment.externalId, 'cannot revive'),
    ).toBeNull();
    expect(await repository.remove(shipment.externalId)).toBe(false);
    expect(
      await repository.changeMonitoring(shipment.externalId, 'pause'),
    ).toEqual({ kind: 'missing' });

    const replacement = await create('lifecycle');

    expect(replacement.externalId).not.toBe(shipment.externalId);
    expect(
      await repository.updateNotes(shipment.externalId, 'stale write'),
    ).toBeNull();

    const deleted = await db.source
      .getRepository(ShipmentEntity)
      .findOneOrFail({
        where: { externalId: shipment.externalId },
        withDeleted: true,
      });

    expect(deleted).toMatchObject({
      createdById: null,
      updatedById: null,
      deletedById: null,
      currentTrackingSnapshotId: snapshot.id,
      nextCheckAt: null,
      lockVersion: 4,
    });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it('enforces strict monitoring transitions, preserves counters and history, and schedules resume immediately', async () => {
    const shipment = await create('monitoring');

    await db.source
      .getRepository(ShipmentEntity)
      .update(
        { externalId: shipment.externalId },
        { consecutiveNotFoundCount: 3 },
      );

    expect(
      await repository.changeMonitoring(shipment.externalId, 'resume'),
    ).toEqual({ kind: 'conflict' });

    const paused = await repository.changeMonitoring(
      shipment.externalId,
      'pause',
    );

    expect(paused).toMatchObject({
      kind: 'updated',
      shipment: {
        monitoringStatus: 'paused',
        monitoringReason: 'manual',
        nextCheckAt: null,
        consecutiveNotFoundCount: 3,
      },
    });
    expect(
      await repository.changeMonitoring(shipment.externalId, 'pause'),
    ).toEqual({ kind: 'conflict' });

    const before = Date.now();
    const resumed = await repository.changeMonitoring(
      shipment.externalId,
      'resume',
    );

    expect(resumed).toMatchObject({
      kind: 'updated',
      shipment: {
        monitoringStatus: 'active',
        monitoringReason: null,
        consecutiveNotFoundCount: 3,
      },
    });

    if (resumed.kind !== 'updated') throw new Error('Expected resume');

    expect(resumed.shipment.nextCheckAt!.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(resumed.shipment.nextCheckAt!.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );

    for (const [monitoringStatus, monitoringReason] of [
      [
        ShipmentMonitoringStatus.Paused,
        ShipmentMonitoringReason.NotFoundThreshold,
      ],
      [ShipmentMonitoringStatus.Completed, ShipmentMonitoringReason.Delivered],
    ] as const) {
      await db.source
        .getRepository(ShipmentEntity)
        .update(
          { externalId: shipment.externalId },
          { monitoringStatus, monitoringReason, nextCheckAt: null },
        );

      expect(
        await repository.changeMonitoring(shipment.externalId, 'resume'),
      ).toEqual({ kind: 'conflict' });
      expect(
        await repository.changeMonitoring(shipment.externalId, 'pause'),
      ).toEqual({ kind: 'conflict' });
      expect(
        await repository.createMany([
          {
            carrierExternalId: ups.externalId,
            trackingReference: 'monitoring',
            notes: 'must not reset',
          },
        ]),
      ).toMatchObject({
        inserted: [],
        duplicates: [
          {
            externalId: shipment.externalId,
            monitoringStatus,
            monitoringReason,
            notes: 'original',
          },
        ],
      });
    }
  });

  it('serializes competing pauses and preserves independent concurrent note changes', async () => {
    const shipment = await create('concurrent-lifecycle');
    const results = await Promise.all([
      repository.changeMonitoring(shipment.externalId, 'pause'),
      repository.changeMonitoring(shipment.externalId, 'pause'),
      repository.updateNotes(shipment.externalId, 'concurrent note'),
    ]);

    expect(results.slice(0, 2)).toContainEqual({ kind: 'conflict' });
    expect(results.slice(0, 2)).toContainEqual(
      expect.objectContaining({ kind: 'updated' }),
    );
    expect(await repository.find(shipment.externalId)).toMatchObject({
      monitoringStatus: 'paused',
      notes: 'concurrent note',
    });
  });

  it('handles overlapping reverse-order concurrent batches without duplicate writes or lost notes', async () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      carrierExternalId: ups.externalId,
      trackingReference: `concurrent-${index}`,
      notes: `first-${index}`,
    }));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        repository.createMany(index % 2 ? [...items].reverse() : items),
      ),
    );
    const inserted = results.flatMap((result) =>
      result.kind === 'created' ? result.inserted : [],
    );
    const duplicates = results.flatMap((result) =>
      result.kind === 'created' ? result.duplicates : [],
    );

    expect(inserted).toHaveLength(10);
    expect(new Set(inserted.map((row) => row.externalId)).size).toBe(10);
    expect(duplicates).toHaveLength(50);

    const repeat = await repository.createMany([
      { ...items[0], notes: 'must not replace' },
    ]);

    expect(repeat).toMatchObject({
      inserted: [],
      duplicates: [{ notes: 'first-0' }],
    });
  });

  it('rolls back earlier inserts on an unexpected later database failure', async () => {
    await db.source
      .query(`CREATE FUNCTION fail_shipment_test_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.tracking_reference = 'rollback-z' THEN RAISE EXCEPTION 'test failure'; END IF;
      RETURN NEW; END $$`);
    await db.source.query(
      `CREATE TRIGGER fail_shipment_test_insert BEFORE INSERT ON shipments FOR EACH ROW EXECUTE FUNCTION fail_shipment_test_insert()`,
    );

    try {
      await expect(
        repository.createMany([
          {
            carrierExternalId: ups.externalId,
            trackingReference: 'rollback-a',
            notes: null,
          },
          {
            carrierExternalId: ups.externalId,
            trackingReference: 'rollback-z',
            notes: null,
          },
        ]),
      ).rejects.toMatchObject({ driverError: { code: 'P0001' } });

      expect(
        (await repository.list()).filter((row) =>
          row.trackingReference.startsWith('rollback-'),
        ),
      ).toEqual([]);
    } finally {
      await db.source.query(
        'DROP TRIGGER fail_shipment_test_insert ON shipments',
      );
      await db.source.query('DROP FUNCTION fail_shipment_test_insert()');
    }
  });

  it('rejects disabled/deleted Carriers atomically while keeping existing Shipments editable', async () => {
    const carrier = await db.source.getRepository(CarrierEntity).save({
      code: 'disabled-test',
      name: 'Disabled',
      pollIntervalMinutes: 5,
    });
    const result = await repository.createMany([
      {
        carrierExternalId: carrier.externalId,
        trackingReference: 'keep',
        notes: null,
      },
    ]);

    if (result.kind !== 'created') throw new Error('Expected creation');

    await db.source
      .getRepository(CarrierEntity)
      .update({ id: carrier.id }, { isActive: false });

    expect(
      await repository.createMany([
        {
          carrierExternalId: ups.externalId,
          trackingReference: 'disabled-rollback',
          notes: null,
        },
        {
          carrierExternalId: carrier.externalId,
          trackingReference: 'new',
          notes: null,
        },
      ]),
    ).toEqual({
      kind: 'unavailable',
      carrierExternalIds: [carrier.externalId],
    });

    await db.source.getRepository(CarrierEntity).softDelete({ id: carrier.id });

    expect(await repository.find(result.inserted[0].externalId)).toMatchObject({
      trackingReference: 'keep',
    });
    expect(
      await repository.updateNotes(
        result.inserted[0].externalId,
        'still editable',
      ),
    ).toMatchObject({ notes: 'still editable' });
    expect(
      (await repository.list()).some(
        (row) => row.trackingReference === 'disabled-rollback',
      ),
    ).toBe(false);
  });

  it('creates independently Carrier-scoped references, immediately due with public UUIDs', async () => {
    const before = Date.now();
    const result = await repository.createMany([
      {
        carrierExternalId: ups.externalId,
        trackingReference: '001-a',
        notes: 'Receiving',
      },
      {
        carrierExternalId: echo.externalId,
        trackingReference: '001-a',
        notes: null,
      },
    ]);

    expect(result.kind).toBe('created');

    if (result.kind !== 'created') throw new Error('Expected creation');

    expect(result.inserted).toHaveLength(2);
    expect(result.duplicates).toEqual([]);

    const shipment = result.inserted[0];

    expect(shipment).toMatchObject({
      carrier: { externalId: ups.externalId },
      trackingReference: '001-a',
      notes: 'Receiving',
      verificationUrl: null,
      monitoringStatus: 'active',
      monitoringReason: null,
      consecutiveNotFoundCount: 0,
      lastAttemptedAt: null,
    });
    expect(shipment.nextCheckAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(shipment.nextCheckAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await repository.find(shipment.externalId)).toEqual(shipment);
    expect(await repository.list()).toContainEqual(shipment);
    expect(shipment).not.toHaveProperty('id');
    expect(shipment.carrier).not.toHaveProperty('id');
  });
});
