import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('Shipment history PostgreSQL repository', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let repository: TypeOrmShipmentsRepository;
  let tracking: TrackingService;
  let carrier: CarrierEntity;
  let sequence = 0;

  beforeAll(async () => {
    db = await shipmentDatabase();
    repository = new TypeOrmShipmentsRepository(db.source);
    tracking = new TrackingService(new TypeOrmTrackingRepository(db.source));
    carrier = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
  });

  afterAll(async () => {
    await db?.close();
  });

  async function create() {
    sequence += 1;
    const result = await repository.createMany([
      {
        carrierExternalId: carrier.externalId,
        trackingReference: `history-${sequence}`,
        notes: null,
      },
    ]);

    if (result.kind !== 'created') throw new Error('Expected creation');

    return result.inserted[0]!;
  }

  async function startRun(shipmentExternalId: string) {
    const run = await tracking.createRun({
      carrierExternalId: carrier.externalId,
      shipmentExternalIds: [shipmentExternalId],
      trigger: 'scheduled',
      requestedById: null,
    });
    const target = (await tracking.startRun(run.externalId)).targets[0]!;

    return { run, target };
  }

  it('distinguishes an empty history from a missing or deleted Shipment', async () => {
    const shipment = await create();

    await expect(
      repository.history(shipment.externalId, { page: 1, pageSize: 25 }),
    ).resolves.toEqual({ items: [], page: 1, pageSize: 25, total: 0 });
    await expect(
      repository.history('fdd45938-2f15-4c69-bc0d-52a57a707dc8', {
        page: 1,
        pageSize: 25,
      }),
    ).resolves.toBeNull();

    await repository.remove(shipment.externalId);

    await expect(
      repository.history(shipment.externalId, { page: 1, pageSize: 25 }),
    ).resolves.toBeNull();
  });

  it('returns only changed normalized snapshots and preserves known history after failure', async () => {
    const shipment = await create();
    const initial = {
      carrierStatus: null,
      carrierStatusDetail: null,
      pickedUpOn: '2026-10-01',
      estimatedDeliveryOn: null,
      deliveredOn: null,
    };
    const first = await startRun(shipment.externalId);

    await tracking.finalizeFound({
      runExternalId: first.run.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: first.target.expectedLockVersion,
      effectiveIntervalMinutes: 30,
      snapshot: initial,
      sourceData: { privateCanary: 'never-public' },
    });

    const unchanged = await startRun(shipment.externalId);

    await tracking.finalizeFound({
      runExternalId: unchanged.run.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: unchanged.target.expectedLockVersion,
      effectiveIntervalMinutes: 30,
      snapshot: initial,
      sourceData: null,
    });

    const failed = await startRun(shipment.externalId);

    await tracking.finalizeFailed({
      runExternalId: failed.run.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: failed.target.expectedLockVersion,
      effectiveIntervalMinutes: 30,
      sourceData: { diagnostic: 'private' },
      retryable: true,
      reasonCode: 'FIXTURE_TIMEOUT',
      message: 'private diagnostic',
    });

    const changed = await startRun(shipment.externalId);

    await tracking.finalizeFound({
      runExternalId: changed.run.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: changed.target.expectedLockVersion,
      effectiveIntervalMinutes: 30,
      snapshot: { ...initial, estimatedDeliveryOn: '2026-12-01' },
      sourceData: null,
    });

    const history = await repository.history(shipment.externalId, {
      page: 1,
      pageSize: 25,
    });

    expect(history).toMatchObject({ page: 1, pageSize: 25, total: 2 });
    expect(history!.items).toEqual([
      {
        ...initial,
        estimatedDeliveryOn: '2026-12-01',
        externalId: expect.any(String),
        observedAt: expect.any(Date),
      },
      {
        ...initial,
        externalId: expect.any(String),
        observedAt: expect.any(Date),
      },
    ]);
    expect(JSON.stringify(history)).not.toMatch(
      /privateCanary|never-public|diagnostic|sourceData|shipmentId|snapshotId/,
    );
  });

  it('paginates equal timestamps deterministically without leaking another Shipment history', async () => {
    const shipment = await create();
    const foreign = await create();
    const [owner]: Array<{ id: number }> = await db.source.query(
      'SELECT id FROM shipments WHERE external_id = $1',
      [shipment.externalId],
    );
    const [other]: Array<{ id: number }> = await db.source.query(
      'SELECT id FROM shipments WHERE external_id = $1',
      [foreign.externalId],
    );
    const inserted: Array<{
      id: string;
      external_id: string;
    }> = await db.source.query(
      `INSERT INTO shipment_tracking_snapshots
        (shipment_id, carrier_status, observed_at)
       SELECT $1, 'History ' || n, '2026-01-01T12:00:00Z'
       FROM generate_series(1, 26) n
       RETURNING id, external_id`,
      [owner!.id],
    );

    await db.source.query(
      `INSERT INTO shipment_tracking_snapshots
        (shipment_id, carrier_status, observed_at)
       VALUES ($1, 'Foreign only', '2027-01-01T12:00:00Z')`,
      [other!.id],
    );

    const first = await repository.history(shipment.externalId, {
      page: 1,
      pageSize: 25,
    });
    const second = await repository.history(shipment.externalId, {
      page: 2,
      pageSize: 25,
    });
    const expected = inserted
      .sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? 1 : -1))
      .map((row) => row.external_id);

    expect(first).toMatchObject({ page: 1, pageSize: 25, total: 26 });
    expect(first!.items).toHaveLength(25);
    expect(second).toMatchObject({ page: 2, pageSize: 25, total: 26 });
    expect(second!.items).toHaveLength(1);
    expect(
      [...first!.items, ...second!.items].map((item) => item.externalId),
    ).toEqual(expected);
    expect(JSON.stringify([first, second])).not.toContain('Foreign only');
  });
});
