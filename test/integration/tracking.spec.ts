import { AuthUserEntity } from '@modules/auth/auth-user.entity.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import {
  TrackingAttemptEntity,
  TrackingAttemptOutcome,
} from '@modules/tracking/tracking-attempt.entity.js';
import { TrackingRunEntity } from '@modules/tracking/tracking-run.entity.js';
import {
  ShipmentEntity,
  ShipmentMonitoringReason,
  ShipmentMonitoringStatus,
} from '@modules/shipments/shipment.entity.js';
import { ShipmentTrackingSnapshotEntity } from '@modules/tracking/shipment-tracking-snapshot.entity.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

describe('Tracking PostgreSQL repository', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let service: TrackingService;
  let shipments: TypeOrmShipmentsRepository;
  let ups: CarrierEntity;
  let actorId: number;

  beforeAll(async () => {
    db = await shipmentDatabase();
    actorId = (
      await db.source.getRepository(AuthUserEntity).save({
        name: 'Audit Employee',
        firstName: 'Audit',
        lastName: 'Employee',
        email: 'audit@example.test',
      })
    ).id;
    service = new TrackingService(new TypeOrmTrackingRepository(db.source));
    shipments = new TypeOrmShipmentsRepository(db.source);
    ups = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
  });

  afterAll(async () => {
    await db?.close();
  });

  async function createShipment(reference: string) {
    const result = await shipments.createMany(
      [
        {
          carrierExternalId: ups.externalId,
          trackingReference: reference,
          notes: null,
        },
      ],
      actorId,
    );
    if (result.kind !== 'created') throw new Error('Expected creation');
    return result.inserted[0]!;
  }

  it('creates a queued run and all pending attempts atomically before starting it', async () => {
    const first = await createShipment('tracking-create-first');
    const second = await createShipment('tracking-create-second');

    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [first.externalId, second.externalId],
      requestedById: null,
    });

    expect(run).toMatchObject({
      status: 'queued',
      trigger: 'scheduled',
      attemptCount: 2,
    });
    const storedRun = await db.source
      .getRepository(TrackingRunEntity)
      .findOneByOrFail({ externalId: run.externalId });
    expect(
      await db.source.getRepository(TrackingAttemptEntity).countBy({
        trackingRunId: storedRun.id,
        outcome: TrackingAttemptOutcome.Pending,
      }),
    ).toBe(2);

    const started = await service.startRun(run.externalId);

    expect(started).toMatchObject({
      externalId: run.externalId,
      status: 'running',
      trigger: 'scheduled',
      carrierCode: 'ups',
    });
    expect(started.targets).toEqual([
      expect.objectContaining({
        shipmentExternalId: first.externalId,
        trackingReference: 'tracking-create-first',
        expectedLockVersion: 1,
      }),
      expect.objectContaining({
        shipmentExternalId: second.externalId,
        trackingReference: 'tracking-create-second',
        expectedLockVersion: 1,
      }),
    ]);
  });

  it('atomically persists changed and unchanged found outcomes with merged known calendar dates', async () => {
    const shipment = await createShipment('tracking-found');
    const firstRun = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    const firstTarget = (await service.startRun(firstRun.externalId))
      .targets[0]!;

    const changed = await service.finalizeFound({
      runExternalId: firstRun.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: firstTarget.expectedLockVersion,
      effectiveIntervalMinutes: 60,
      snapshot: {
        carrierStatus: 'Moving',
        carrierStatusDetail: 'In Transit',
        pickedUpOn: null,
        estimatedDeliveryOn: '2026-10-20',
        deliveredOn: null,
      },
      sourceData: { providerStatus: 'IN_TRANSIT', nested: { safe: true } },
    });

    expect(changed).toMatchObject({
      outcome: 'found',
      snapshotChanged: true,
    });
    if (changed.outcome !== 'found') throw new Error('Expected found outcome');
    const afterChanged = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: shipment.externalId });
    expect(afterChanged).toMatchObject({
      updatedById: null,
      createdById: actorId,
      verificationUrl:
        'https://www.ups.com/track?loc=en_US&trackn=tracking-found',
      monitoringStatus: 'active',
      monitoringReason: null,
      consecutiveNotFoundCount: 0,
      lockVersion: 2,
    });
    expect(afterChanged.lastAttemptedAt).toBeInstanceOf(Date);
    expect(
      afterChanged.nextCheckAt!.getTime() -
        afterChanged.lastAttemptedAt!.getTime(),
    ).toBe(60 * 60 * 1000);
    const firstAttempt = await db.source
      .getRepository(TrackingAttemptEntity)
      .findOneByOrFail({ snapshotId: changed.snapshotId });
    expect(firstAttempt.sourceData).toEqual({
      providerStatus: 'IN_TRANSIT',
      nested: { safe: true },
    });

    expect(await service.finalizeRun(firstRun.externalId)).toMatchObject({
      status: 'succeeded',
    });

    const secondRun = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    const secondTarget = (await service.startRun(secondRun.externalId))
      .targets[0]!;
    const unchanged = await service.finalizeFound({
      runExternalId: secondRun.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: secondTarget.expectedLockVersion,
      effectiveIntervalMinutes: 60,
      snapshot: {
        carrierStatus: null,
        carrierStatusDetail: null,
        pickedUpOn: null,
        estimatedDeliveryOn: '2026-10-20',
        deliveredOn: null,
      },
      sourceData: null,
    });

    expect(unchanged).toEqual({
      outcome: 'found',
      snapshotChanged: false,
      snapshotId: changed.snapshotId,
      stale: false,
    });
    expect(
      await db.source
        .getRepository(ShipmentTrackingSnapshotEntity)
        .countBy({ shipmentId: afterChanged.id }),
    ).toBe(1);
  });

  it('keeps the first four not-found outcomes active and pauses on the Carrier threshold', async () => {
    const shipment = await createShipment('tracking-not-found');

    for (let count = 1; count <= 5; count++) {
      const run = await service.createRun({
        carrierExternalId: ups.externalId,
        trigger: 'scheduled',
        shipmentExternalIds: [shipment.externalId],
        requestedById: null,
      });
      const target = (await service.startRun(run.externalId)).targets[0]!;
      expect(
        await service.finalizeNotFound({
          runExternalId: run.externalId,
          shipmentExternalId: shipment.externalId,
          expectedLockVersion: target.expectedLockVersion,
          effectiveIntervalMinutes: 60,
          sourceData: { lookup: 'completed', matched: false },
        }),
      ).toMatchObject({ outcome: 'not_found', stale: false });
      await service.finalizeRun(run.externalId);

      const stored = await db.source
        .getRepository(ShipmentEntity)
        .findOneByOrFail({ externalId: shipment.externalId });
      expect(stored.updatedById).toBeNull();
      expect(stored.createdById).toBe(actorId);
      expect(stored.consecutiveNotFoundCount).toBe(count);
      if (count < 5) {
        expect(stored.monitoringStatus).toBe('active');
        expect(stored.monitoringReason).toBeNull();
        expect(stored.nextCheckAt).toBeInstanceOf(Date);
      } else {
        expect(stored.monitoringStatus).toBe('paused');
        expect(stored.monitoringReason).toBe('not_found_threshold');
        expect(stored.nextCheckAt).toBeNull();
      }
    }
  });

  it('persists failed attempts without changing the not-found counter or snapshot', async () => {
    const shipment = await createShipment('tracking-failed');
    await db.source.getRepository(ShipmentEntity).update(
      { externalId: shipment.externalId },
      {
        consecutiveNotFoundCount: 2,
        verificationUrl: 'https://example.test/already-known',
      },
    );
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    const target = (await service.startRun(run.externalId)).targets[0]!;

    expect(
      await service.finalizeFailed({
        runExternalId: run.externalId,
        shipmentExternalId: shipment.externalId,
        expectedLockVersion: target.expectedLockVersion,
        effectiveIntervalMinutes: 60,
        retryable: true,
        reasonCode: 'UPS_TIMEOUT',
        message: 'Carrier request timed out.',
        sourceData: { endpoint: 'track', responseReceived: false },
      }),
    ).toMatchObject({ outcome: 'failed', stale: false });
    expect(await service.finalizeRun(run.externalId)).toMatchObject({
      status: 'failed',
    });

    const stored = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: shipment.externalId });
    expect(stored).toMatchObject({
      updatedById: null,
      createdById: actorId,
      consecutiveNotFoundCount: 2,
      currentTrackingSnapshotId: null,
      verificationUrl: 'https://example.test/already-known',
      monitoringStatus: 'active',
    });
    expect(stored.lastAttemptedAt).toBeInstanceOf(Date);
    expect(
      stored.nextCheckAt!.getTime() - stored.lastAttemptedAt!.getTime(),
    ).toBe(60 * 60 * 1000);

    const attempt = await db.source
      .getRepository(TrackingAttemptEntity)
      .findOneByOrFail({
        trackingRunId: (
          await db.source
            .getRepository(TrackingRunEntity)
            .findOneByOrFail({ externalId: run.externalId })
        ).id,
      });
    expect(attempt).toMatchObject({
      outcome: 'failed',
      retryable: true,
      reasonCode: 'UPS_TIMEOUT',
      message: 'Carrier request timed out.',
      sourceData: { endpoint: 'track', responseReceived: false },
    });
  });

  it('skips a stale result without overwriting a concurrent Shipment change', async () => {
    const shipment = await createShipment('tracking-stale');
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    const target = (await service.startRun(run.externalId)).targets[0]!;
    await shipments.updateNotes(shipment.externalId, 'changed during lookup');

    expect(
      await service.finalizeFound({
        runExternalId: run.externalId,
        shipmentExternalId: shipment.externalId,
        expectedLockVersion: target.expectedLockVersion,
        effectiveIntervalMinutes: 60,
        snapshot: {
          carrierStatus: 'Delivered',
          carrierStatusDetail: null,
          pickedUpOn: null,
          estimatedDeliveryOn: null,
          deliveredOn: '2026-10-13',
        },
        sourceData: { mustNotPersist: true },
      }),
    ).toEqual({
      outcome: 'skipped',
      snapshotChanged: false,
      snapshotId: null,
      stale: true,
    });
    expect(await service.finalizeRun(run.externalId)).toMatchObject({
      status: 'succeeded',
    });

    const stored = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: shipment.externalId });
    expect(stored).toMatchObject({
      notes: 'changed during lookup',
      verificationUrl: null,
      currentTrackingSnapshotId: null,
      consecutiveNotFoundCount: 0,
      monitoringStatus: 'active',
      lockVersion: target.expectedLockVersion + 1,
    });
    expect(stored.lastAttemptedAt).toBeNull();
    const storedRun = await db.source
      .getRepository(TrackingRunEntity)
      .findOneByOrFail({ externalId: run.externalId });
    expect(
      await db.source.getRepository(TrackingAttemptEntity).findOneByOrFail({
        trackingRunId: storedRun.id,
      }),
    ).toMatchObject({
      outcome: 'skipped',
      reasonCode: 'SHIPMENT_STATE_CHANGED',
      sourceData: null,
    });
  });

  it('completes delivered Shipments and reactivates only threshold-paused manual refreshes', async () => {
    const deliveredShipment = await createShipment('tracking-delivered');
    const deliveredRun = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [deliveredShipment.externalId],
      requestedById: null,
    });
    const deliveredTarget = (await service.startRun(deliveredRun.externalId))
      .targets[0]!;
    await service.finalizeFound({
      runExternalId: deliveredRun.externalId,
      shipmentExternalId: deliveredShipment.externalId,
      expectedLockVersion: deliveredTarget.expectedLockVersion,
      effectiveIntervalMinutes: 60,
      snapshot: {
        carrierStatus: 'Delivered',
        carrierStatusDetail: 'Complete',
        pickedUpOn: '2026-10-01',
        estimatedDeliveryOn: '2026-10-13',
        deliveredOn: '2026-10-13',
      },
      sourceData: null,
    });
    expect(
      await db.source
        .getRepository(ShipmentEntity)
        .findOneByOrFail({ externalId: deliveredShipment.externalId }),
    ).toMatchObject({
      monitoringStatus: 'completed',
      monitoringReason: 'delivered',
      nextCheckAt: null,
    });

    const pausedShipment = await createShipment('tracking-reactivate');
    await db.source.getRepository(ShipmentEntity).update(
      { externalId: pausedShipment.externalId },
      {
        monitoringStatus: ShipmentMonitoringStatus.Paused,
        monitoringReason: ShipmentMonitoringReason.NotFoundThreshold,
        consecutiveNotFoundCount: 5,
        nextCheckAt: null,
      },
    );
    const manualRun = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'manual',
      shipmentExternalIds: [pausedShipment.externalId],
      requestedById: null,
    });
    const manualTarget = (await service.startRun(manualRun.externalId))
      .targets[0]!;
    await service.finalizeFound({
      runExternalId: manualRun.externalId,
      shipmentExternalId: pausedShipment.externalId,
      expectedLockVersion: manualTarget.expectedLockVersion,
      effectiveIntervalMinutes: 60,
      snapshot: {
        carrierStatus: 'Moving',
        carrierStatusDetail: null,
        pickedUpOn: null,
        estimatedDeliveryOn: null,
        deliveredOn: null,
      },
      sourceData: null,
    });
    const reactivated = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: pausedShipment.externalId });
    expect(reactivated).toMatchObject({
      monitoringStatus: 'active',
      monitoringReason: null,
      consecutiveNotFoundCount: 0,
    });
    expect(
      reactivated.nextCheckAt!.getTime() -
        reactivated.lastAttemptedAt!.getTime(),
    ).toBe(60 * 60 * 1000);
  });

  it('summarizes mixed outcomes and resolves cancellation and interruption atomically', async () => {
    const first = await createShipment('tracking-summary-first');
    const second = await createShipment('tracking-summary-second');
    const third = await createShipment('tracking-summary-third');
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [
        first.externalId,
        second.externalId,
        third.externalId,
      ],
      requestedById: null,
    });
    const started = await service.startRun(run.externalId);
    const target = (externalId: string) =>
      started.targets.find((item) => item.shipmentExternalId === externalId)!;
    await service.finalizeFound({
      runExternalId: run.externalId,
      shipmentExternalId: first.externalId,
      expectedLockVersion: target(first.externalId).expectedLockVersion,
      effectiveIntervalMinutes: 60,
      snapshot: {
        carrierStatus: 'Moving',
        carrierStatusDetail: null,
        pickedUpOn: null,
        estimatedDeliveryOn: null,
        deliveredOn: null,
      },
      sourceData: null,
    });
    await service.finalizeFailed({
      runExternalId: run.externalId,
      shipmentExternalId: second.externalId,
      expectedLockVersion: target(second.externalId).expectedLockVersion,
      effectiveIntervalMinutes: 60,
      retryable: true,
      reasonCode: 'TEMPORARY_FAILURE',
      message: null,
      sourceData: null,
    });
    await service.finalizeSkipped({
      runExternalId: run.externalId,
      shipmentExternalId: third.externalId,
      reasonCode: 'NO_LONGER_ELIGIBLE',
      message: null,
    });
    expect(await service.finalizeRun(run.externalId)).toMatchObject({
      status: 'partially_succeeded',
    });

    const cancelFirst = await createShipment('tracking-cancel-first');
    const cancelSecond = await createShipment('tracking-cancel-second');
    const cancelRun = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [cancelFirst.externalId, cancelSecond.externalId],
      requestedById: null,
    });
    await service.startRun(cancelRun.externalId);
    expect(await service.cancelRun(cancelRun.externalId)).toMatchObject({
      status: 'cancelled',
    });
    const cancelled = await db.source
      .getRepository(TrackingRunEntity)
      .findOneByOrFail({ externalId: cancelRun.externalId });
    expect(
      await db.source.getRepository(TrackingAttemptEntity).countBy({
        trackingRunId: cancelled.id,
        outcome: TrackingAttemptOutcome.Skipped,
      }),
    ).toBe(2);

    const interruptedShipment = await createShipment('tracking-interrupted');
    const interruptedRun = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [interruptedShipment.externalId],
      requestedById: null,
    });
    await service.startRun(interruptedRun.externalId);
    expect(
      await service.interruptRun({
        runExternalId: interruptedRun.externalId,
        retryable: true,
        reasonCode: 'WORKER_INTERRUPTED',
        message: 'Worker stopped before completion.',
      }),
    ).toMatchObject({ status: 'failed' });
  });

  it('rejects invalid completion and source data without changing pending work', async () => {
    const shipment = await createShipment('tracking-invalid');
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    const target = (await service.startRun(run.externalId)).targets[0]!;

    await expect(service.finalizeRun(run.externalId)).rejects.toMatchObject({
      code: 'INVALID_RUN_STATE',
    });
    expect(() =>
      service.finalizeFailed({
        runExternalId: run.externalId,
        shipmentExternalId: shipment.externalId,
        expectedLockVersion: target.expectedLockVersion,
        effectiveIntervalMinutes: 60,
        retryable: true,
        reasonCode: 'INVALID_SOURCE',
        message: null,
        sourceData: ['not', 'an', 'object'],
      }),
    ).toThrow();

    const storedRun = await db.source
      .getRepository(TrackingRunEntity)
      .findOneByOrFail({ externalId: run.externalId });
    const attempt = await db.source
      .getRepository(TrackingAttemptEntity)
      .findOneByOrFail({ trackingRunId: storedRun.id });
    expect(attempt.outcome).toBe('pending');
    await expect(
      db.source.query(
        `UPDATE tracking_attempts SET source_data = '[]'::jsonb WHERE id = $1`,
        [attempt.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await service.cancelRun(run.externalId);
  });

  it('rolls back the snapshot, Shipment update, and attempt when finalization fails', async () => {
    const shipment = await createShipment('tracking-rollback');
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    const target = (await service.startRun(run.externalId)).targets[0]!;
    await db.source.query(`CREATE FUNCTION fail_tracking_attempt_finalize()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.outcome = 'found' THEN
          RAISE EXCEPTION 'injected tracking failure';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await db.source.query(`CREATE TRIGGER fail_tracking_attempt_finalize
      BEFORE UPDATE ON tracking_attempts
      FOR EACH ROW EXECUTE FUNCTION fail_tracking_attempt_finalize()`);
    try {
      await expect(
        service.finalizeFound({
          runExternalId: run.externalId,
          shipmentExternalId: shipment.externalId,
          expectedLockVersion: target.expectedLockVersion,
          effectiveIntervalMinutes: 60,
          snapshot: {
            carrierStatus: 'Moving',
            carrierStatusDetail: null,
            pickedUpOn: null,
            estimatedDeliveryOn: null,
            deliveredOn: null,
          },
          sourceData: null,
        }),
      ).rejects.toThrow('injected tracking failure');
    } finally {
      await db.source.query(
        'DROP TRIGGER fail_tracking_attempt_finalize ON tracking_attempts',
      );
      await db.source.query('DROP FUNCTION fail_tracking_attempt_finalize()');
    }

    const stored = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: shipment.externalId });
    expect(stored).toMatchObject({
      currentTrackingSnapshotId: null,
      verificationUrl: null,
      lockVersion: target.expectedLockVersion,
    });
    expect(
      await db.source
        .getRepository(ShipmentTrackingSnapshotEntity)
        .countBy({ shipmentId: stored.id }),
    ).toBe(0);
    const storedRun = await db.source
      .getRepository(TrackingRunEntity)
      .findOneByOrFail({ externalId: run.externalId });
    expect(
      await db.source.getRepository(TrackingAttemptEntity).findOneByOrFail({
        trackingRunId: storedRun.id,
      }),
    ).toMatchObject({ outcome: 'pending', snapshotId: null });
    await service.cancelRun(run.externalId);
  });

  it('rejects cross-Shipment snapshot ownership at the database boundary', async () => {
    const first = await createShipment('tracking-owner-first');
    const second = await createShipment('tracking-owner-second');
    const [firstRow, secondRow] = await Promise.all(
      [first, second].map((shipment) =>
        db.source
          .getRepository(ShipmentEntity)
          .findOneByOrFail({ externalId: shipment.externalId }),
      ),
    );
    const snapshots: Array<{ id: string }> = await db.source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status)
       VALUES ($1, 'Known') RETURNING id`,
      [secondRow.id],
    );
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [first.externalId],
      requestedById: null,
    });
    const storedRun = await db.source
      .getRepository(TrackingRunEntity)
      .findOneByOrFail({ externalId: run.externalId });
    const attempt = await db.source
      .getRepository(TrackingAttemptEntity)
      .findOneByOrFail({ trackingRunId: storedRun.id });
    await expect(
      db.source.query(
        `UPDATE tracking_attempts
            SET outcome = 'found', snapshot_id = $2, completed_at = now()
          WHERE id = $1`,
        [attempt.id, snapshots[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    expect(firstRow.currentTrackingSnapshotId).toBeNull();
    await service.cancelRun(run.externalId);
  });

  it('does not start work for a Shipment made ineligible while its run was queued', async () => {
    const shipment = await createShipment('tracking-paused-before-start');
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'scheduled',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    await shipments.changeMonitoring(shipment.externalId, 'pause');

    expect((await service.startRun(run.externalId)).targets).toEqual([]);
    expect(await service.finalizeRun(run.externalId)).toMatchObject({
      status: 'succeeded',
    });
    const storedRun = await db.source
      .getRepository(TrackingRunEntity)
      .findOneByOrFail({ externalId: run.externalId });
    expect(
      await db.source.getRepository(TrackingAttemptEntity).findOneByOrFail({
        trackingRunId: storedRun.id,
      }),
    ).toMatchObject({
      outcome: 'skipped',
      reasonCode: 'SHIPMENT_STATE_CHANGED',
    });
  });

  it('preserves an active Shipment schedule during a manual refresh', async () => {
    const shipment = await createShipment('tracking-manual-schedule');
    const before = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: shipment.externalId });
    const run = await service.createRun({
      carrierExternalId: ups.externalId,
      trigger: 'manual',
      shipmentExternalIds: [shipment.externalId],
      requestedById: null,
    });
    const target = (await service.startRun(run.externalId)).targets[0]!;
    await service.finalizeFound({
      runExternalId: run.externalId,
      shipmentExternalId: shipment.externalId,
      expectedLockVersion: target.expectedLockVersion,
      effectiveIntervalMinutes: 60,
      snapshot: {
        carrierStatus: 'Moving',
        carrierStatusDetail: null,
        pickedUpOn: null,
        estimatedDeliveryOn: null,
        deliveredOn: null,
      },
      sourceData: null,
    });
    const after = await db.source
      .getRepository(ShipmentEntity)
      .findOneByOrFail({ externalId: shipment.externalId });
    expect(after.nextCheckAt?.getTime()).toBe(before.nextCheckAt?.getTime());
  });
});
