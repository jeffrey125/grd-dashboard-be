import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { ShipmentEntity } from '@modules/shipments/shipment.entity.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TypeOrmDashboardRepository } from '@modules/dashboard/typeorm-dashboard.repository.js';
import { shipmentSearchQuerySchema } from '@modules/shipments/shipments.schemas.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TypeOrmTrackingWorkRepository } from '@modules/tracking/typeorm-tracking-work.repository.js';
import { TypeOrmTrackingHttpRepository } from '@modules/tracking/typeorm-tracking-http.repository.js';
import { monitoringWindowOpenSql } from '@modules/shipments/typeorm-delivered-monitoring.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('MON-V1-002 delivered follow-up monitoring', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let shipments: TypeOrmShipmentsRepository;
  let tracking: TrackingService;
  let work: TypeOrmTrackingWorkRepository;
  let carrier: CarrierEntity;
  let today: string;
  let tomorrow: string;
  let yesterday: string;
  let serial = 0;

  beforeAll(async () => {
    db = await shipmentDatabase();
    shipments = new TypeOrmShipmentsRepository(db.source);
    tracking = new TrackingService(new TypeOrmTrackingRepository(db.source));
    work = new TypeOrmTrackingWorkRepository(db.source);
    carrier = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
    [{ today, tomorrow, yesterday }] = await db.source.query(`SELECT
      ((clock_timestamp() AT TIME ZONE 'America/New_York')::date)::text AS today,
      ((clock_timestamp() AT TIME ZONE 'America/New_York')::date + 1)::text AS tomorrow,
      ((clock_timestamp() AT TIME ZONE 'America/New_York')::date - 1)::text AS yesterday`);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function create(followUpOn: string | null) {
    const result = await shipments.createMany([
      {
        carrierExternalId: carrier.externalId,
        trackingReference: `follow-up-${++serial}`,
        notes: null,
        followUpOn,
      },
    ]);
    if (result.kind !== 'created') throw new Error('Creation failed');
    return result.inserted[0]!;
  }

  async function start(externalId: string) {
    const run = await tracking.createRun({
      carrierExternalId: carrier.externalId,
      shipmentExternalIds: [externalId],
      trigger: 'scheduled',
      requestedById: null,
    });
    const target = (await tracking.startRun(run.externalId)).targets[0]!;
    return { run, target };
  }

  async function deliver(externalId: string) {
    const { run, target } = await start(externalId);
    const result = await tracking.finalizeFound({
      runExternalId: run.externalId,
      shipmentExternalId: externalId,
      expectedLockVersion: target.expectedLockVersion,
      effectiveIntervalMinutes: 60,
      sourceData: null,
      snapshot: {
        carrierStatus: 'Delivered',
        carrierStatusDetail: null,
        pickedUpOn: null,
        estimatedDeliveryOn: today,
        deliveredOn: today,
      },
    });
    await tracking.finalizeRun(run.externalId);
    return result;
  }

  async function stored(externalId: string) {
    return db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId });
  }

  it('keeps repeated delivered results active until the future date, with immutable delivery history', async () => {
    const row = await create(tomorrow);
    await deliver(row.externalId);
    const first = await stored(row.externalId);
    await deliver(row.externalId);
    const next = await stored(row.externalId);
    expect(next).toMatchObject({
      monitoringStatus: 'active',
      monitoringReason: null,
      currentTrackingSnapshotId: first.currentTrackingSnapshotId,
    });
    expect(next.nextCheckAt).toBeInstanceOf(Date);
    expect(
      (await shipments.find(row.externalId))?.currentTracking?.deliveredOn,
    ).toBe(today);
    const active = await shipments.search(
      shipmentSearchQuerySchema.parse({
        tab: 'active',
        q: row.trackingReference,
      }),
    );
    expect(active.items.map((item) => item.externalId)).toContain(
      row.externalId,
    );
    expect(
      (
        await shipments.search(
          shipmentSearchQuerySchema.parse({
            tab: 'delivered',
            q: row.trackingReference,
          }),
        )
      ).total,
    ).toBe(0);
    expect(
      (
        await shipments.search(
          shipmentSearchQuerySchema.parse({
            tab: 'all',
            q: row.trackingReference,
            undeliveredOnly: 'true',
          }),
        )
      ).total,
    ).toBe(0);
    const overview = await new TypeOrmDashboardRepository(db.source).overview();
    expect(
      overview.upcomingDeliveries.items.map((item) => item.externalId),
    ).not.toContain(row.externalId);
  });

  it.each(['today', 'yesterday', 'empty'] as const)(
    'completes delivery with a %s follow-up',
    async (kind) => {
      const row = await create(
        kind === 'today' ? today : kind === 'yesterday' ? yesterday : null,
      );
      await deliver(row.externalId);
      expect(await stored(row.externalId)).toMatchObject({
        monitoringStatus: 'completed',
        nextCheckAt: null,
      });
    },
  );

  it('restarts on a future date edit and stops immediately when the date is cleared or today', async () => {
    const row = await create(null);
    await deliver(row.externalId);
    const snapshot = (await stored(row.externalId)).currentTrackingSnapshotId;
    for (const stopDate of [null, today]) {
      expect(
        await shipments.update(row.externalId, { followUpOn: tomorrow }),
      ).toMatchObject({ monitoringStatus: 'active' });
      expect(
        await shipments.update(row.externalId, { followUpOn: stopDate }),
      ).toMatchObject({ monitoringStatus: 'completed', nextCheckAt: null });
    }
    expect((await stored(row.externalId)).currentTrackingSnapshotId).toBe(
      snapshot,
    );
  });

  it('reconciles existing records and expiry even when carriers are disabled; preserves future pauses', async () => {
    const existing = await create(null);
    await deliver(existing.externalId);
    // Simulate an existing pre-rollout delivered record with a future follow-up.
    await db.source.query(
      'UPDATE shipments SET follow_up_on = $2 WHERE external_id = $1',
      [existing.externalId, tomorrow],
    );
    await db.source.query(
      'UPDATE carriers SET is_active = false WHERE id = $1',
      [carrier.id],
    );
    try {
      await tracking.reconcileDeliveredMonitoring();
      expect(await stored(existing.externalId)).toMatchObject({
        monitoringStatus: 'active',
      });
      expect(await work.findDue(carrier.externalId, 60)).not.toContain(
        existing.externalId,
      );
      await shipments.changeMonitoring(existing.externalId, 'pause');
      await shipments.update(existing.externalId, { followUpOn: tomorrow });
      await tracking.reconcileDeliveredMonitoring();
      expect(await stored(existing.externalId)).toMatchObject({
        monitoringStatus: 'paused',
        monitoringReason: 'manual',
      });
      await db.source.query(
        'UPDATE shipments SET follow_up_on = $2 WHERE external_id = $1',
        [existing.externalId, today],
      );
      await tracking.reconcileDeliveredMonitoring();
      expect(await stored(existing.externalId)).toMatchObject({
        monitoringStatus: 'completed',
        nextCheckAt: null,
      });
      const attention = await shipments.search(
        shipmentSearchQuerySchema.parse({
          tab: 'attention',
          q: existing.trackingReference,
        }),
      );
      expect(attention.total).toBe(1);
    } finally {
      await db.source.query(
        'UPDATE carriers SET is_active = true WHERE id = $1',
        [carrier.id],
      );
    }
  });

  it('blocks an expired delivered shipment during due selection, queueing and run start', async () => {
    const row = await create(tomorrow);
    await deliver(row.externalId);
    const queued = await tracking.createRun({
      carrierExternalId: carrier.externalId,
      shipmentExternalIds: [row.externalId],
      trigger: 'scheduled',
      requestedById: null,
    });
    await db.source.query(
      `UPDATE shipments SET follow_up_on = $2, next_check_at = clock_timestamp() - interval '2 hours' WHERE external_id = $1`,
      [row.externalId, today],
    );
    expect(await work.findDue(carrier.externalId, 0)).not.toContain(
      row.externalId,
    );
    expect(
      await new TypeOrmTrackingHttpRepository(db.source).queue(
        row.externalId,
        1,
      ),
    ).toEqual({ kind: 'unavailable' });
    await expect(start(row.externalId)).rejects.toMatchObject({
      code: 'SHIPMENT_UNAVAILABLE',
    });
    expect((await tracking.startRun(queued.externalId)).targets).toEqual([]);
    await tracking.finalizeRun(queued.externalId);
  });

  it('rechecks the deadline after session setup and skips an expired pending lookup', async () => {
    const row = await create(tomorrow);
    await deliver(row.externalId);
    const { run, target } = await start(row.externalId);
    expect(await tracking.prepareLookup(run.externalId, target)).toBe(true);
    await db.source.query(
      'UPDATE shipments SET follow_up_on = $2 WHERE external_id = $1',
      [row.externalId, today],
    );
    expect(await tracking.prepareLookup(run.externalId, target)).toBe(false);
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'completed',
      nextCheckAt: null,
    });
    await tracking.finalizeRun(run.externalId);
  });

  it('allows a lookup already in flight to finish, but cannot schedule past expiry', async () => {
    const row = await create(tomorrow);
    await deliver(row.externalId);
    const { run, target } = await start(row.externalId);
    // Moving the fixture date without changing its version models the date boundary during I/O.
    await db.source.query(
      'UPDATE shipments SET follow_up_on = $2 WHERE external_id = $1',
      [row.externalId, today],
    );
    expect(
      await tracking.finalizeFailed({
        runExternalId: run.externalId,
        shipmentExternalId: row.externalId,
        expectedLockVersion: target.expectedLockVersion,
        effectiveIntervalMinutes: 60,
        retryable: true,
        reasonCode: 'TIMEOUT',
        message: null,
        sourceData: null,
      }),
    ).toMatchObject({ outcome: 'failed' });
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'completed',
      nextCheckAt: null,
    });
    await tracking.finalizeRun(run.externalId);
  });

  it('does not let an in-flight result undo a staff follow-up edit', async () => {
    const row = await create(tomorrow);
    await deliver(row.externalId);
    const { run, target } = await start(row.externalId);
    await shipments.update(row.externalId, { followUpOn: null });
    expect(
      await tracking.finalizeFound({
        runExternalId: run.externalId,
        shipmentExternalId: row.externalId,
        expectedLockVersion: target.expectedLockVersion,
        effectiveIntervalMinutes: 60,
        sourceData: null,
        snapshot: {
          carrierStatus: 'Delivered',
          carrierStatusDetail: null,
          pickedUpOn: null,
          estimatedDeliveryOn: null,
          deliveredOn: today,
        },
      }),
    ).toMatchObject({ outcome: 'skipped', stale: true });
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'completed',
      followUpOn: null,
    });
    await tracking.finalizeRun(run.externalId);
  });

  it.each([
    ['2026-03-08', '2026-03-08T04:59:59Z', '2026-03-08T05:00:00Z'],
    ['2026-11-01', '2026-11-01T03:59:59Z', '2026-11-01T04:00:00Z'],
  ])(
    'uses New York midnight at the %s DST boundary',
    async (date, before, cutoff) => {
      const row = await create(tomorrow);
      await deliver(row.externalId);
      await db.source.query(
        'UPDATE shipments SET follow_up_on = $2 WHERE external_id = $1',
        [row.externalId, date],
      );
      // Evaluate the actual eligibility expression with a fixed database instant.
      const expression = monitoringWindowOpenSql('shipment').replaceAll(
        'clock_timestamp()',
        '$2::timestamptz',
      );
      for (const [instant, expected] of [
        [before, true],
        [cutoff, false],
      ] as const) {
        const [result] = await db.source.query(
          `SELECT ${expression} AS open FROM shipments shipment WHERE external_id = $1`,
          [row.externalId, instant],
        );
        expect(result.open).toBe(expected);
      }
    },
  );

  it('leaves undelivered shipments active after follow-up is due', async () => {
    const row = await create(today);
    await tracking.reconcileDeliveredMonitoring();
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'active',
    });
    expect(await work.findDue(carrier.externalId, 0)).toContain(row.externalId);
  });
});
