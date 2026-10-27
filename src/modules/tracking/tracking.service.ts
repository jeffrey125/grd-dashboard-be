import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  TrackingNotifications,
  type TrackingNotice,
} from '@modules/notifications/tracking-notifications.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import {
  createTrackingRunSchema,
  finalizeFailedSchema,
  finalizeFoundSchema,
  finalizeNotFoundSchema,
  finalizeSkippedSchema,
  interruptRunSchema,
  trackingRunExternalIdSchema,
  type NormalizedTrackingState,
} from './tracking.schemas.js';
import {
  TRACKING_REPOSITORY,
  TrackingOperationError,
  trackingRunRecord,
  type FinalizedSkippedAttempt,
  type LockedTrackingAttempt,
  type LockedTrackingRun,
  type TrackingAttemptCounts,
  type TrackingRepository,
  type TrackingRunRecord,
  type TrackingTransaction,
} from './tracking.repository.js';

function shipmentEligible(
  trigger: TrackingRunRecord['trigger'],
  shipment: {
    monitoringStatus: string;
    monitoringReason: string | null;
    monitoringWindowOpen: boolean;
  },
) {
  return (
    shipment.monitoringWindowOpen &&
    (shipment.monitoringStatus === 'active' ||
      (trigger === 'manual' &&
        shipment.monitoringStatus === 'paused' &&
        ['not_found_threshold', 'failure_threshold'].includes(
          shipment.monitoringReason ?? '',
        )))
  );
}

function mergeTrackingState(
  current: NormalizedTrackingState,
  previous: NormalizedTrackingState | null,
): NormalizedTrackingState {
  if (!previous) return current;

  return {
    carrierStatus: current.carrierStatus ?? previous.carrierStatus,
    carrierStatusDetail:
      current.carrierStatusDetail ?? previous.carrierStatusDetail,
    pickedUpOn: current.pickedUpOn ?? previous.pickedUpOn,
    estimatedDeliveryOn:
      current.estimatedDeliveryOn ?? previous.estimatedDeliveryOn,
    deliveredOn: current.deliveredOn ?? previous.deliveredOn,
  };
}

function trackingStateChanged(
  previous: NormalizedTrackingState | null,
  current: NormalizedTrackingState,
) {
  return (
    !previous ||
    (Object.keys(current) as Array<keyof NormalizedTrackingState>).some(
      (key) => current[key] !== previous[key],
    )
  );
}

function summarizedRunStatus(counts: TrackingAttemptCounts) {
  return counts.failed === 0
    ? ('succeeded' as const)
    : counts.failed === counts.total
      ? ('failed' as const)
      : ('partially_succeeded' as const);
}

function requireRun(run: LockedTrackingRun | null) {
  if (!run)
    throw new TrackingOperationError('RUN_NOT_FOUND', 'Tracking run not found');

  return run;
}

function requirePendingAttempt(attempt: LockedTrackingAttempt | null) {
  if (!attempt)
    throw new TrackingOperationError(
      'ATTEMPT_NOT_FOUND',
      'Tracking attempt not found',
    );

  if (attempt.runStatus !== 'running')
    throw new TrackingOperationError(
      'INVALID_RUN_STATE',
      'Attempts can be finalized only while their run is running',
    );

  if (attempt.attemptOutcome !== 'pending')
    throw new TrackingOperationError(
      'INVALID_ATTEMPT_STATE',
      'Tracking attempt is already finalized',
    );

  return attempt;
}

function requireShipmentUpdate(updated: boolean) {
  if (!updated)
    throw new TrackingOperationError(
      'INVALID_TRACKING_STATE',
      'Shipment changed while its locked tracking outcome was being persisted',
    );
}

@Injectable()
export class TrackingService {
  constructor(
    @Inject(TRACKING_REPOSITORY)
    private readonly repository: TrackingRepository,
    @Optional()
    @Inject(TrackingNotifications)
    private readonly notifications?: TrackingNotifications,
  ) {}

  reconcileDeliveredMonitoring() {
    return this.repository.transaction((transaction) =>
      transaction.reconcileDeliveredMonitoring(),
    );
  }

  /** Recheck after session setup and between reads, including midnight in a long run. */
  prepareLookup(
    runExternalId: string,
    target: { shipmentExternalId: string; expectedLockVersion: number },
  ) {
    return this.repository.transaction(async (transaction) => {
      const run = requireRun(await transaction.lockRun(runExternalId));
      const attempt = requirePendingAttempt(
        await transaction.lockAttempt(runExternalId, target.shipmentExternalId),
      );
      if (
        run.carrierIsActive &&
        run.carrierDeletedAt === null &&
        attempt.deletedAt === null &&
        attempt.lockVersion === target.expectedLockVersion &&
        shipmentEligible(run.trigger, attempt)
      )
        return true;

      await transaction.finalizeAttempt({
        attemptId: attempt.attemptId,
        outcome: 'skipped',
        snapshotId: null,
        snapshotChanged: false,
        sourceData: null,
        retryable: null,
        reasonCode: 'SHIPMENT_STATE_CHANGED',
        message: 'Shipment or Carrier became ineligible before lookup.',
        completedAt: await transaction.databaseNow(),
      });
      await transaction.reconcileDeliveredMonitoring(attempt.shipmentId);

      return false;
    });
  }

  createRun(input: unknown) {
    const command = createTrackingRunSchema.parse(input);

    return this.repository.transaction(async (transaction) => {
      const carrier = await transaction.lockAvailableCarrier(
        command.carrierExternalId,
      );

      if (!carrier)
        throw new TrackingOperationError(
          'CARRIER_UNAVAILABLE',
          'Carrier is unavailable for tracking',
        );

      const shipments = await transaction.lockTargetShipments(
        command.shipmentExternalIds,
        carrier.id,
      );

      if (shipments.length !== command.shipmentExternalIds.length)
        throw new TrackingOperationError(
          'SHIPMENT_UNAVAILABLE',
          'One or more Shipments are unavailable for this Carrier',
        );

      const byExternalId = new Map(
        shipments.map((shipment) => [shipment.externalId, shipment]),
      );
      const orderedShipments = command.shipmentExternalIds.map((externalId) =>
        byExternalId.get(externalId)!,
      );

      if (
        orderedShipments.some(
          (shipment) => !shipmentEligible(command.trigger, shipment),
        )
      )
        throw new TrackingOperationError(
          'SHIPMENT_UNAVAILABLE',
          'One or more Shipments are not eligible for this run',
        );

      const run = await transaction.insertRun(command, carrier.id);

      await transaction.insertAttempts(
        run.id,
        orderedShipments.map((shipment) => shipment.id),
      );

      return trackingRunRecord(run, orderedShipments.length);
    });
  }

  startRun(externalId: string) {
    const id = trackingRunExternalIdSchema.parse(externalId);

    return this.repository.transaction(async (transaction) => {
      const run = requireRun(await transaction.lockRun(id));

      if (run.status !== 'queued')
        throw new TrackingOperationError(
          'INVALID_RUN_STATE',
          'Only a queued tracking run can be started',
        );

      await transaction.markRunRunning(run.id);

      const updated = requireRun(await transaction.lockRun(id));
      const targets = await transaction.loadRunTargets(run.id);
      const eligibleTargets = [];
      let completedAt: Date | undefined;

      for (const target of targets) {
        const carrierEligible =
          updated.carrierIsActive && updated.carrierDeletedAt === null;
        const targetEligible =
          carrierEligible &&
          target.deletedAt === null &&
          shipmentEligible(updated.trigger, target);

        if (targetEligible) {
          eligibleTargets.push(target);

          continue;
        }

        completedAt ??= await transaction.databaseNow();
        await transaction.finalizeAttempt({
          attemptId: target.attemptId,
          outcome: 'skipped',
          snapshotId: null,
          snapshotChanged: false,
          sourceData: null,
          retryable: null,
          reasonCode: carrierEligible
            ? 'SHIPMENT_STATE_CHANGED'
            : 'CARRIER_STATE_CHANGED',
          message: carrierEligible
            ? 'Shipment became ineligible before tracking started.'
            : 'Carrier became ineligible before tracking started.',
          completedAt,
        });
      }

      return {
        ...trackingRunRecord(updated, targets.length),
        status: 'running' as const,
        carrierCode: updated.carrierCode,
        sessionGeneration: updated.sessionGeneration,
        targets: eligibleTargets.map((target) => ({
          shipmentExternalId: target.externalId,
          trackingReference: target.trackingReference,
          expectedLockVersion: target.lockVersion,
        })),
      };
    });
  }

  finalizeFound(input: unknown) {
    const command = finalizeFoundSchema.parse(input);
    let notice: TrackingNotice | undefined;
    const result = this.finalizeCurrentAttempt(
      command,
      async (transaction, attempt, completedAt) => {
        let previous: NormalizedTrackingState | null = null;

        if (attempt.currentTrackingSnapshotId) {
          previous = await transaction.loadCurrentSnapshot(
            attempt.shipmentId,
            attempt.currentTrackingSnapshotId,
          );

          if (!previous)
            throw new TrackingOperationError(
              'INVALID_TRACKING_STATE',
              'Current tracking snapshot is missing',
            );
        }

        const merged = mergeTrackingState(command.snapshot, previous);

        if (Object.values(merged).every((value) => value === null))
          throw new TrackingOperationError(
            'INVALID_TRACKING_STATE',
            'A found result must contain tracking data',
          );

        const changed = trackingStateChanged(previous, merged);
        let snapshotId = attempt.currentTrackingSnapshotId;

        if (changed)
          snapshotId = await transaction.insertSnapshot(
            attempt.shipmentId,
            merged,
            completedAt,
          );

        if (!snapshotId)
          throw new TrackingOperationError(
            'INVALID_TRACKING_STATE',
            'A found result requires a tracking snapshot',
          );

        const delivered = merged.deliveredOn !== null;
        const complete = delivered && !attempt.followUpInFuture;
        const reactivate =
          attempt.runTrigger === 'manual' &&
          attempt.monitoringStatus === 'paused' &&
          ['not_found_threshold', 'failure_threshold'].includes(
            attempt.monitoringReason ?? '',
          );

        requireShipmentUpdate(
          await transaction.updateShipmentFound({
            shipmentId: attempt.shipmentId,
            snapshotId,
            verificationUrl: carrierReferencePolicy(
              attempt.carrierCode,
            ).verificationUrl(attempt.trackingReference),
            completedAt,
            complete,
            scheduleNext: attempt.runTrigger === 'scheduled',
            reactivate,
            effectiveIntervalMinutes: command.effectiveIntervalMinutes,
            expectedLockVersion: command.expectedLockVersion,
          }),
        );
        await transaction.finalizeAttempt({
          attemptId: attempt.attemptId,
          outcome: 'found',
          snapshotId,
          snapshotChanged: changed,
          sourceData: command.sourceData,
          retryable: null,
          reasonCode: null,
          message: null,
          completedAt,
        });
        notice = {
          carrierCode: attempt.carrierCode,
          shipmentExternalId: attempt.shipmentExternalId,
          trackingReference: attempt.trackingReference,
          outcome: 'found',
          changed,
          initial: previous === null,
          snapshot: merged,
          previous,
          ...(complete && attempt.monitoringStatus !== 'completed'
            ? { stopped: 'delivered' as const }
            : {}),
        };

        return {
          outcome: 'found' as const,
          snapshotChanged: changed,
          snapshotId,
          stale: false as const,
        };
      },
    );

    return result.then(async (outcome) => {
      if (notice) await this.notifications?.record(notice);

      return outcome;
    });
  }

  finalizeNotFound(input: unknown) {
    const command = finalizeNotFoundSchema.parse(input);
    let notice: TrackingNotice | undefined;
    const result = this.finalizeCurrentAttempt(
      command,
      async (transaction, attempt, completedAt) => {
        const notFoundCount = attempt.consecutiveNotFoundCount + 1;
        const thresholdReached =
          notFoundCount >= attempt.notFoundPauseThreshold;

        requireShipmentUpdate(
          await transaction.updateShipmentNotFound({
            shipmentId: attempt.shipmentId,
            notFoundCount,
            completedAt,
            thresholdReached,
            scheduleNext:
              attempt.runTrigger === 'scheduled' && !thresholdReached,
            effectiveIntervalMinutes: command.effectiveIntervalMinutes,
            expectedLockVersion: command.expectedLockVersion,
          }),
        );
        await transaction.finalizeAttempt({
          attemptId: attempt.attemptId,
          outcome: 'not_found',
          snapshotId: null,
          snapshotChanged: false,
          sourceData: command.sourceData,
          retryable: null,
          reasonCode: null,
          message: null,
          completedAt,
        });
        notice = {
          carrierCode: attempt.carrierCode,
          shipmentExternalId: attempt.shipmentExternalId,
          trackingReference: attempt.trackingReference,
          outcome: 'not_found',
          ...(thresholdReached &&
          !(
            attempt.monitoringStatus === 'paused' &&
            attempt.monitoringReason === 'not_found_threshold'
          )
            ? { stopped: 'not_found_threshold' as const }
            : {}),
        };

        return {
          outcome: 'not_found' as const,
          snapshotChanged: false as const,
          snapshotId: null,
          stale: false as const,
        };
      },
    );

    return result.then(async (outcome) => {
      if (notice) await this.notifications?.record(notice);

      return outcome;
    });
  }

  async recordSessionOutcome(runExternalId: string, healthy: boolean) {
    const id = trackingRunExternalIdSchema.parse(runExternalId);

    return this.repository.transaction(async (transaction) => {
      const run = await transaction.lockRun(id);

      if (!run || run.status !== 'running') return false;

      return transaction.recordSessionOutcome(run.id, healthy);
    });
  }

  finalizeFailed(input: unknown) {
    const command = finalizeFailedSchema.parse(input);
    let notice: TrackingNotice | undefined;
    const result = this.finalizeCurrentAttempt(
      command,
      async (transaction, attempt, completedAt) => {
        const failureCount = command.sessionFailure
          ? attempt.consecutiveFailureCount
          : Math.min(attempt.consecutiveFailureCount + 1, 2147483647);
        const thresholdReached =
          !command.sessionFailure &&
          attempt.failurePauseEnabled &&
          failureCount >= attempt.failurePauseThreshold;

        requireShipmentUpdate(
          await transaction.updateShipmentFailed({
            shipmentId: attempt.shipmentId,
            failureCount,
            thresholdReached,
            completedAt,
            scheduleNext:
              attempt.runTrigger === 'scheduled' &&
              attempt.monitoringStatus === 'active',
            effectiveIntervalMinutes: command.effectiveIntervalMinutes,
            expectedLockVersion: command.expectedLockVersion,
          }),
        );
        await transaction.finalizeAttempt({
          attemptId: attempt.attemptId,
          outcome: 'failed',
          snapshotId: null,
          snapshotChanged: false,
          sourceData: command.sourceData,
          retryable: command.retryable,
          reasonCode: command.reasonCode,
          message: command.message,
          completedAt,
        });
        notice = {
          carrierCode: attempt.carrierCode,
          shipmentExternalId: attempt.shipmentExternalId,
          trackingReference: attempt.trackingReference,
          outcome: 'failed',
          ...(thresholdReached && attempt.monitoringStatus === 'active'
            ? { stopped: 'failure_threshold' as const }
            : {}),
        };

        return {
          outcome: 'failed' as const,
          snapshotChanged: false as const,
          snapshotId: null,
          stale: false as const,
        };
      },
    );

    return result.then(async (outcome) => {
      if (notice) await this.notifications?.record(notice);

      return outcome;
    });
  }

  finalizeSkipped(input: unknown) {
    const command = finalizeSkippedSchema.parse(input);

    return this.repository.transaction(async (transaction) => {
      const attempt = requirePendingAttempt(
        await transaction.lockAttempt(
          command.runExternalId,
          command.shipmentExternalId,
        ),
      );
      const completedAt = await transaction.databaseNow();

      await transaction.finalizeAttempt({
        attemptId: attempt.attemptId,
        outcome: 'skipped',
        snapshotId: null,
        snapshotChanged: false,
        sourceData: null,
        retryable: null,
        reasonCode: command.reasonCode,
        message: command.message,
        completedAt,
      });

      return {
        outcome: 'skipped' as const,
        snapshotChanged: false as const,
        snapshotId: null,
        stale: false as const,
      };
    });
  }

  finalizeRun(externalId: string) {
    const id = trackingRunExternalIdSchema.parse(externalId);

    return this.repository.transaction(async (transaction) => {
      const run = requireRun(await transaction.lockRun(id));

      if (run.status !== 'running')
        throw new TrackingOperationError(
          'INVALID_RUN_STATE',
          'Only a running tracking run can be finalized',
        );

      const counts = await transaction.countAttempts(run.id);

      if (counts.pending)
        throw new TrackingOperationError(
          'INVALID_RUN_STATE',
          'A run with pending attempts cannot be finalized',
        );

      await transaction.updateRun({
        runId: run.id,
        status: summarizedRunStatus(counts),
        reasonCode: null,
        message: null,
        completedAt: await transaction.databaseNow(),
      });

      return trackingRunRecord(
        requireRun(await transaction.lockRun(id)),
        counts.total,
      );
    });
  }

  interruptRun(input: unknown) {
    const command = interruptRunSchema.parse(input);

    return this.repository.transaction(async (transaction) => {
      const run = requireRun(await transaction.lockRun(command.runExternalId));

      if (run.status !== 'running')
        throw new TrackingOperationError(
          'INVALID_RUN_STATE',
          'Only a running tracking run can be interrupted',
        );

      const completedAt = await transaction.databaseNow();

      await transaction.finalizePendingAttempts({
        runId: run.id,
        outcome: 'failed',
        retryable: command.retryable,
        reasonCode: command.reasonCode,
        message: command.message,
        completedAt,
      });

      const counts = await transaction.countAttempts(run.id);

      await transaction.updateRun({
        runId: run.id,
        status: summarizedRunStatus(counts),
        reasonCode: command.reasonCode,
        message: command.message,
        completedAt,
      });

      return trackingRunRecord(
        requireRun(await transaction.lockRun(command.runExternalId)),
        counts.total,
      );
    });
  }

  cancelRun(externalId: string) {
    const id = trackingRunExternalIdSchema.parse(externalId);

    return this.repository.transaction(async (transaction) => {
      const run = requireRun(await transaction.lockRun(id));

      if (run.status !== 'queued' && run.status !== 'running')
        throw new TrackingOperationError(
          'INVALID_RUN_STATE',
          'Only a queued or running tracking run can be cancelled',
        );

      const completedAt = await transaction.databaseNow();

      await transaction.finalizePendingAttempts({
        runId: run.id,
        outcome: 'skipped',
        retryable: null,
        reasonCode: 'RUN_CANCELLED',
        message: 'Tracking run was cancelled.',
        completedAt,
      });
      await transaction.updateRun({
        runId: run.id,
        status: 'cancelled',
        reasonCode: 'RUN_CANCELLED',
        message: 'Tracking run was cancelled.',
        completedAt,
      });

      const counts = await transaction.countAttempts(run.id);

      return trackingRunRecord(
        requireRun(await transaction.lockRun(id)),
        counts.total,
      );
    });
  }

  private finalizeCurrentAttempt<TResult>(
    command: {
      runExternalId: string;
      shipmentExternalId: string;
      expectedLockVersion: number;
    },
    finalize: (
      transaction: TrackingTransaction,
      attempt: LockedTrackingAttempt,
      completedAt: Date,
    ) => Promise<TResult>,
  ): Promise<TResult | FinalizedSkippedAttempt> {
    return this.repository.transaction(async (transaction) => {
      const attempt = requirePendingAttempt(
        await transaction.lockAttempt(
          command.runExternalId,
          command.shipmentExternalId,
        ),
      );
      const completedAt = await transaction.databaseNow();

      if (
        attempt.deletedAt !== null ||
        attempt.lockVersion !== command.expectedLockVersion
      ) {
        await transaction.finalizeAttempt({
          attemptId: attempt.attemptId,
          outcome: 'skipped',
          snapshotId: null,
          snapshotChanged: false,
          sourceData: null,
          retryable: null,
          reasonCode: 'SHIPMENT_STATE_CHANGED',
          message: 'Shipment changed while tracking was in progress.',
          completedAt,
        });

        return {
          outcome: 'skipped',
          snapshotChanged: false,
          snapshotId: null,
          stale: true,
        };
      }

      const result = await finalize(transaction, attempt, completedAt);
      await transaction.reconcileDeliveredMonitoring(attempt.shipmentId);

      return result;
    });
  }
}
