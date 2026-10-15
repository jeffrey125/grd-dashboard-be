import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TypeOrmTrackingHttpRepository } from '@modules/tracking/typeorm-tracking-http.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;
let shipments: TypeOrmShipmentsRepository;
let tracking: TrackingService;
let carrier: CarrierEntity;

beforeAll(async () => {
  db = await shipmentDatabase();
  shipments = new TypeOrmShipmentsRepository(db.source);
  tracking = new TrackingService(new TypeOrmTrackingRepository(db.source));
  carrier = await db.source
    .getRepository(CarrierEntity)
    .findOneByOrFail({ code: 'ups' });
});
afterAll(async () => {
  await db?.close();
});

async function create() {
  const result = await shipments.createMany([
    {
      carrierExternalId: carrier.externalId,
      trackingReference: randomUUID(),
      notes: null,
    },
  ]);

  if (result.kind !== 'created') throw new Error('Expected creation');

  return result.inserted[0]!;
}

async function run(
  externalId: string,
  trigger: 'manual' | 'scheduled' = 'scheduled',
) {
  return tracking.createRun({
    carrierExternalId: carrier.externalId,
    shipmentExternalIds: [externalId],
    trigger,
    requestedById: null,
  });
}

it('projects known tracking across unchanged, failed, absent and skipped checks while pending work stays separate', async () => {
  const shipment = await create();

  expect(shipment).toMatchObject({
    currentTracking: null,
    latestLookup: null,
    latestRun: null,
  });

  const snapshot = {
    carrierStatus: 'Moving',
    carrierStatusDetail: null,
    pickedUpOn: null,
    estimatedDeliveryOn: '2026-11-01',
    deliveredOn: null,
  };
  const first = await run(shipment.externalId);
  const target = (await tracking.startRun(first.externalId)).targets[0]!;

  await tracking.finalizeFound({
    runExternalId: first.externalId,
    shipmentExternalId: shipment.externalId,
    expectedLockVersion: target.expectedLockVersion,
    effectiveIntervalMinutes: 30,
    snapshot,
    sourceData: { privateCanary: 'never-public' },
  });
  await tracking.finalizeRun(first.externalId);

  const known = await shipments.find(shipment.externalId);

  expect(known).toMatchObject({
    currentTracking: {
      ...snapshot,
      externalId: expect.stringMatching(/^[0-9a-f-]{14}4[0-9a-f-]{21}$/),
      observedAt: expect.any(Date),
    },
    latestLookup: {
      runExternalId: first.externalId,
      outcome: 'found',
      snapshotChanged: true,
      retryable: null,
      reasonCode: null,
      completedAt: expect.any(Date),
    },
    latestRun: {
      externalId: first.externalId,
      trigger: 'scheduled',
      status: 'succeeded',
      attemptCount: 1,
      fetchMode: 'request',
    },
  });

  for (const outcome of ['found', 'failed', 'not_found', 'skipped'] as const) {
    const next = await run(shipment.externalId);
    const currentTarget = (await tracking.startRun(next.externalId))
      .targets[0]!;
    const command = {
      runExternalId: next.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: currentTarget.expectedLockVersion,
      effectiveIntervalMinutes: 30,
      sourceData: null,
    };

    if (outcome === 'found')
      await tracking.finalizeFound({ ...command, snapshot });
    if (outcome === 'failed')
      await tracking.finalizeFailed({
        ...command,
        retryable: true,
        reasonCode: 'FIXTURE_TIMEOUT',
        message: 'private diagnostic',
      });
    if (outcome === 'not_found') await tracking.finalizeNotFound(command);
    if (outcome === 'skipped')
      await tracking.finalizeSkipped({
        runExternalId: next.externalId,
        shipmentExternalId: shipment.externalId,
        reasonCode: 'FIXTURE_SKIP',
        message: 'private diagnostic',
      });

    await tracking.finalizeRun(next.externalId);

    const read = await shipments.find(shipment.externalId);

    expect(read?.currentTracking).toEqual(known?.currentTracking);
    expect(read?.latestLookup).toMatchObject({
      outcome,
      runExternalId: next.externalId,
      snapshotChanged: false,
    });
    expect(read!.latestLookup!.completedAt.getTime()).toBeGreaterThan(
      known!.currentTracking!.observedAt.getTime(),
    );
    expect(JSON.stringify(read)).not.toMatch(
      /privateCanary|never-public|private diagnostic|sourceData|snapshotId|requestedById/,
    );
  }

  const completed = await shipments.find(shipment.externalId);
  const manual = await run(shipment.externalId, 'manual');

  expect(await shipments.find(shipment.externalId)).toMatchObject({
    currentTracking: completed!.currentTracking,
    latestLookup: completed!.latestLookup,
    latestRun: { externalId: manual.externalId, status: 'queued' },
  });

  await tracking.startRun(manual.externalId);

  expect((await shipments.find(shipment.externalId))?.latestRun).toMatchObject({
    externalId: manual.externalId,
    status: 'running',
  });

  const newer = await run(shipment.externalId);

  expect(
    (await shipments.find(shipment.externalId))?.latestRun?.externalId,
  ).toBe(newer.externalId);
  expect(
    await new TypeOrmTrackingHttpRepository(db.source).find(manual.externalId),
  ).toMatchObject({ externalId: manual.externalId, status: 'running' });
});

it('uses the current pointer and orders completed lookups and associated runs by time then internal identity', async () => {
  const shipment = await create();
  const sibling = await create();
  const [row] = await db.source.query(
    'SELECT id FROM shipments WHERE external_id = $1',
    [shipment.externalId],
  );
  const [pointed] = await db.source.query(
    `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, observed_at) VALUES ($1, 'Pointer wins', '2020-01-01') RETURNING external_id, id`,
    [row.id],
  );

  await db.source.query(
    `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, observed_at) VALUES ($1, 'Newer but not current', '2021-01-01')`,
    [row.id],
  );
  await db.source.query(
    'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
    [pointed.id, row.id],
  );

  const older = await run(shipment.externalId, 'manual');
  const tieWinner = await tracking.createRun({
    carrierExternalId: carrier.externalId,
    shipmentExternalIds: [shipment.externalId, sibling.externalId],
    trigger: 'scheduled',
    requestedById: null,
  });
  const newerIdOlderTime = await run(shipment.externalId);

  await db.source.query(
    `UPDATE tracking_runs SET created_at = '2020-02-01' WHERE external_id = ANY($1::uuid[])`,
    [[older.externalId, tieWinner.externalId]],
  );
  await db.source.query(
    `UPDATE tracking_runs SET created_at = '2020-01-01' WHERE external_id = $1`,
    [newerIdOlderTime.externalId],
  );
  await db.source.query(
    `UPDATE tracking_attempts SET outcome = 'not_found', completed_at = '2020-02-01'
    WHERE shipment_id = $1 AND tracking_run_id IN (SELECT id FROM tracking_runs WHERE external_id = ANY($2::uuid[]))`,
    [row.id, [older.externalId, tieWinner.externalId]],
  );
  await db.source.query(
    `UPDATE tracking_attempts SET outcome = 'not_found', completed_at = '2020-01-01'
    WHERE tracking_run_id = (SELECT id FROM tracking_runs WHERE external_id = $1)`,
    [newerIdOlderTime.externalId],
  );

  // A newer run for the same Carrier but another Shipment is not associated.
  await run(sibling.externalId);

  const read = await shipments.find(shipment.externalId);

  expect(read?.currentTracking).toMatchObject({
    externalId: pointed.external_id,
    carrierStatus: 'Pointer wins',
  });
  expect(read?.latestLookup?.runExternalId).toBe(tieWinner.externalId);
  expect(read?.latestRun).toMatchObject({
    externalId: tieWinner.externalId,
    attemptCount: 2,
  });
});

it('reads representative lists and batch projections in a constant number of database queries', async () => {
  await db.source.query(
    `INSERT INTO shipments (carrier_id, tracking_reference)
    SELECT $1, 'scale-' || n FROM generate_series(1, 1000) n`,
    [carrier.id],
  );
  await db.source
    .query(`INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status)
    SELECT id, 'In transit' FROM shipments WHERE tracking_reference LIKE 'scale-%'`);
  await db.source
    .query(`UPDATE shipments s SET current_tracking_snapshot_id = snapshot.id
    FROM shipment_tracking_snapshots snapshot WHERE snapshot.shipment_id = s.id AND s.tracking_reference LIKE 'scale-%'`);

  const scaleRun = await db.source.query(
    `INSERT INTO tracking_runs (carrier_id, trigger) VALUES ($1, 'scheduled') RETURNING id`,
    [carrier.id],
  );

  await db.source.query(
    `INSERT INTO tracking_attempts (tracking_run_id, shipment_id, outcome, completed_at)
    SELECT $1, id, 'not_found', now() FROM shipments WHERE tracking_reference LIKE 'scale-%'`,
    [scaleRun[0].id],
  );

  const queries = vi.spyOn(db.source.logger, 'logQuery');

  try {
    const list = await shipments.list();
    const measured = list.filter((row) =>
      row.trackingReference.startsWith('scale-'),
    );

    expect(measured).toHaveLength(1000);
    expect(
      measured.every(
        (row) =>
          row.currentTracking?.carrierStatus === 'In transit' &&
          row.latestRun?.attemptCount === 1000 &&
          row.latestLookup?.outcome === 'not_found',
      ),
    ).toBe(true);
    expect(queries).toHaveBeenCalledTimes(1);

    queries.mockClear();

    const result = await shipments.createMany(
      Array.from({ length: 10 }, (_, i) => ({
        carrierExternalId: carrier.externalId,
        trackingReference: `scale-${i + 1}`,
        notes: null,
      })),
    );

    expect(result).toMatchObject({
      inserted: [],
      duplicates: expect.any(Array),
    });
    expect(
      queries.mock.calls.filter(([sql]) =>
        sql.includes('shipment_tracking_snapshots'),
      ),
    ).toHaveLength(1);
  } finally {
    queries.mockRestore();
  }
});
