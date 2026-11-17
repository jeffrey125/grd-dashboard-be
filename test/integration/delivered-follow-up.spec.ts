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
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('MON-V1-005 delivered monitoring and one-off checks', () => {
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

  it.each(['future', 'today', 'past', 'empty'] as const)(
    'completes confirmed delivery with a %s follow-up',
    async (kind) => {
      const followUpOn =
        kind === 'future'
          ? tomorrow
          : kind === 'today'
            ? today
            : kind === 'past'
              ? yesterday
              : null;
      const row = await create(followUpOn);
      await deliver(row.externalId);
      expect(await stored(row.externalId)).toMatchObject({
        monitoringStatus: 'completed',
        monitoringReason: 'delivered',
        nextCheckAt: null,
        followUpOn,
      });
      for (const [tab, total] of [
        ['active', 0],
        ['delivered', 1],
      ] as const) {
        expect(
          (
            await shipments.search(
              shipmentSearchQuerySchema.parse({
                tab,
                q: row.trackingReference,
              }),
            )
          ).total,
        ).toBe(total);
      }
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
      const overview = await new TypeOrmDashboardRepository(
        db.source,
      ).overview();
      expect(
        overview.upcomingDeliveries.items.map((item) => item.externalId),
      ).not.toContain(row.externalId);
      expect(await work.findDue(carrier.externalId, 0)).not.toContain(
        row.externalId,
      );
    },
  );

  it('never restarts delivered monitoring when follow-up dates are edited', async () => {
    const row = await create(null);
    await deliver(row.externalId);
    const snapshot = (await stored(row.externalId)).currentTrackingSnapshotId;
    for (const followUpOn of [tomorrow, today, null]) {
      expect(
        await shipments.update(row.externalId, { followUpOn }),
      ).toMatchObject({
        monitoringStatus: 'completed',
        nextCheckAt: null,
        followUpOn,
      });
    }
    expect((await stored(row.externalId)).currentTrackingSnapshotId).toBe(
      snapshot,
    );
  });

  it.each(['active', 'paused'])(
    'reconciles existing delivered %s records even with a disabled carrier and future follow-up',
    async (status) => {
      const row = await create(tomorrow);
      await deliver(row.externalId);
      await db.source.query(
        "UPDATE shipments SET monitoring_status=$2::text::shipment_monitoring_status, monitoring_reason=CASE WHEN $2::text = 'paused' THEN 'manual'::shipment_monitoring_reason ELSE NULL END, next_check_at=CASE WHEN $2::text = 'paused' THEN NULL ELSE clock_timestamp() END WHERE external_id=$1",
        [row.externalId, status],
      );
      await db.source.query('UPDATE carriers SET is_active=false WHERE id=$1', [
        carrier.id,
      ]);
      try {
        await tracking.reconcileDeliveredMonitoring();
        const first = await stored(row.externalId);
        expect(first).toMatchObject({
          monitoringStatus: 'completed',
          monitoringReason: 'delivered',
          nextCheckAt: null,
          followUpOn: tomorrow,
        });
        await tracking.reconcileDeliveredMonitoring();
        expect((await stored(row.externalId)).lockVersion).toBe(
          first.lockVersion,
        );
      } finally {
        await db.source.query(
          'UPDATE carriers SET is_active=true WHERE id=$1',
          [carrier.id],
        );
      }
    },
  );

  async function monitorAgain(externalId: string) {
    const run = await tracking.createRun({
      carrierExternalId: carrier.externalId,
      shipmentExternalIds: [externalId],
      trigger: 'manual',
      requestedById: null,
    });
    const target = (await tracking.startRun(run.externalId)).targets[0]!;
    expect(target).toBeDefined();
    expect(await tracking.prepareLookup(run.externalId, target)).toBe(true);
    return { run, target };
  }

  it('checks a completed delivery once, preserves history and never schedules more checks', async () => {
    const row = await create(tomorrow);
    await deliver(row.externalId);
    const snapshot = (await stored(row.externalId)).currentTrackingSnapshotId;
    const { run, target } = await monitorAgain(row.externalId);
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'completed',
      nextCheckAt: null,
    });
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
        estimatedDeliveryOn: today,
        deliveredOn: today,
      },
    });
    await tracking.finalizeRun(run.externalId);
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'completed',
      monitoringReason: 'delivered',
      nextCheckAt: null,
      followUpOn: tomorrow,
      currentTrackingSnapshotId: snapshot,
    });
    await expect(start(row.externalId)).rejects.toMatchObject({
      code: 'SHIPMENT_UNAVAILABLE',
    });
  });

  it.each(['failed', 'not_found'] as const)(
    'keeps known delivery completed after a one-off %s result',
    async (outcome) => {
      const row = await create(tomorrow);
      await deliver(row.externalId);
      const { run, target } = await monitorAgain(row.externalId);
      // Force the safeguard threshold to ensure a one-off error cannot replace delivery with a pause.
      await db.source.query(
        'UPDATE shipments SET consecutive_failure_count=10, consecutive_not_found_count=10 WHERE external_id=$1',
        [row.externalId],
      );
      const input = {
        runExternalId: run.externalId,
        shipmentExternalId: row.externalId,
        expectedLockVersion: target.expectedLockVersion,
        effectiveIntervalMinutes: 60,
        sourceData: null,
      };
      if (outcome === 'failed')
        await tracking.finalizeFailed({
          ...input,
          retryable: true,
          reasonCode: 'TIMEOUT',
          message: null,
        });
      else await tracking.finalizeNotFound(input);
      await tracking.finalizeRun(run.externalId);
      expect(await stored(row.externalId)).toMatchObject({
        monitoringStatus: 'completed',
        monitoringReason: 'delivered',
        nextCheckAt: null,
        followUpOn: tomorrow,
      });
      expect(
        (await shipments.find(row.externalId))?.currentTracking?.deliveredOn,
      ).toBe(today);
    },
  );

  it('accepts and coalesces HTTP monitor-again requests without changing the follow-up date', async () => {
    const row = await create(null);
    await deliver(row.externalId);
    const [actor] = await db.source.query(
      "INSERT INTO auth_users (name,first_name,last_name,email,role) VALUES ('Monitor Test','Monitor','Test','monitor-once@example.test','staff') RETURNING id",
    );
    const http = new TypeOrmTrackingHttpRepository(db.source);
    const [first, second] = await Promise.all([
      http.queue(row.externalId, actor.id),
      http.queue(row.externalId, actor.id),
    ]);
    expect(first.kind).toBe('accepted');
    expect(second).toEqual(first);
    if (first.kind !== 'accepted') throw new Error('Queue failed');
    const started = await tracking.startRun(first.run.externalId);
    expect(started.targets).toHaveLength(1);
    expect(
      await tracking.prepareLookup(started.externalId, started.targets[0]!),
    ).toBe(true);
    await tracking.cancelRun(started.externalId);
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'completed',
      nextCheckAt: null,
      followUpOn: null,
    });
    await db.source.query('UPDATE carriers SET is_active=false WHERE id=$1', [
      carrier.id,
    ]);
    try {
      expect(await http.queue(row.externalId, actor.id)).toEqual({
        kind: 'unavailable',
      });
    } finally {
      await db.source.query('UPDATE carriers SET is_active=true WHERE id=$1', [
        carrier.id,
      ]);
    }
  });

  it('skips scheduled work if delivery is confirmed after queueing or session setup', async () => {
    for (const started of [false, true]) {
      const row = await create(tomorrow);
      const pending = await tracking.createRun({
        carrierExternalId: carrier.externalId,
        shipmentExternalIds: [row.externalId],
        trigger: 'scheduled',
        requestedById: null,
      });
      const target = started
        ? (await tracking.startRun(pending.externalId)).targets[0]!
        : null;
      await deliver(row.externalId);
      if (target)
        expect(await tracking.prepareLookup(pending.externalId, target)).toBe(
          false,
        );
      else
        expect((await tracking.startRun(pending.externalId)).targets).toEqual(
          [],
        );
      await tracking.finalizeRun(pending.externalId);
    }
  });

  it('does not let a one-off lookup undo a concurrent staff edit or deletion', async () => {
    for (const deleted of [false, true]) {
      const row = await create(tomorrow);
      await deliver(row.externalId);
      const { run, target } = await monitorAgain(row.externalId);
      if (deleted) await shipments.remove(row.externalId);
      else await shipments.update(row.externalId, { followUpOn: null });
      expect(
        await tracking.finalizeFound({
          runExternalId: run.externalId,
          shipmentExternalId: row.externalId,
          expectedLockVersion: target.expectedLockVersion,
          effectiveIntervalMinutes: 60,
          sourceData: null,
          snapshot: {
            carrierStatus: 'Delivered',
            carrierStatusDetail: 'Late response',
            pickedUpOn: null,
            estimatedDeliveryOn: null,
            deliveredOn: today,
          },
        }),
      ).toMatchObject({ outcome: 'skipped', stale: true });
      await tracking.finalizeRun(run.externalId);
    }
  });

  it('keeps undelivered active records eligible and manual pauses intact regardless of follow-up', async () => {
    const row = await create(today);
    const paused = await create(tomorrow);
    await shipments.changeMonitoring(paused.externalId, 'pause');
    await tracking.reconcileDeliveredMonitoring();
    expect(await stored(row.externalId)).toMatchObject({
      monitoringStatus: 'active',
    });
    expect(await stored(paused.externalId)).toMatchObject({
      monitoringStatus: 'paused',
      monitoringReason: 'manual',
    });
    expect(await work.findDue(carrier.externalId, 0)).toContain(row.externalId);
    expect(await work.findDue(carrier.externalId, 0)).not.toContain(
      paused.externalId,
    );
  });
});
