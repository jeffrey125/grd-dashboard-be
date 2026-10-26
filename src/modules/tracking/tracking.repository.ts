import type { z } from 'zod';
import type { trackingRunRecordSchema } from './tracking-read.schemas.js';
import type { FetchMode } from '@modules/carriers/carrier-fetch-mode.js';
import type {
  CreateTrackingRun,
  NormalizedTrackingState,
} from './tracking.schemas.js';

export type TrackingRunRecord = z.infer<typeof trackingRunRecordSchema>;

export interface TrackingExecutionTarget {
  shipmentExternalId: string;
  trackingReference: string;
  expectedLockVersion: number;
}

export interface StartedTrackingRun extends TrackingRunRecord {
  sessionGeneration: number;
  status: 'running';
  carrierCode: string;
  targets: TrackingExecutionTarget[];
}

export interface FinalizedFoundAttempt {
  outcome: 'found';
  snapshotChanged: boolean;
  snapshotId: string;
  stale: false;
}

export interface FinalizedSkippedAttempt {
  outcome: 'skipped';
  snapshotChanged: false;
  snapshotId: null;
  stale: boolean;
}

export interface FinalizedNotFoundAttempt {
  outcome: 'not_found';
  snapshotChanged: false;
  snapshotId: null;
  stale: false;
}

export interface FinalizedFailedAttempt {
  outcome: 'failed';
  snapshotChanged: false;
  snapshotId: null;
  stale: false;
}

export class TrackingOperationError extends Error {
  constructor(
    readonly code:
      | 'CARRIER_UNAVAILABLE'
      | 'SHIPMENT_UNAVAILABLE'
      | 'INVALID_RUN_STATE'
      | 'RUN_NOT_FOUND'
      | 'ATTEMPT_NOT_FOUND'
      | 'INVALID_ATTEMPT_STATE'
      | 'INVALID_TRACKING_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'TrackingOperationError';
  }
}

export interface LockedTrackingRun {
  sessionGeneration: number;
  fetchMode: FetchMode | null;
  id: string;
  externalId: string;
  trigger: TrackingRunRecord['trigger'];
  status: TrackingRunRecord['status'];
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  carrierCode: string;
  carrierIsActive: boolean;
  carrierDeletedAt: Date | null;
}

export interface TrackingShipmentCandidate {
  id: number;
  externalId: string;
  monitoringStatus: string;
  monitoringReason: string | null;
}

export interface TrackingRunTarget extends TrackingShipmentCandidate {
  attemptId: string;
  trackingReference: string;
  lockVersion: number;
  deletedAt: Date | null;
}

export interface LockedTrackingAttempt {
  runId: string;
  runTrigger: TrackingRunRecord['trigger'];
  runStatus: TrackingRunRecord['status'];
  attemptId: string;
  attemptOutcome: string;
  shipmentId: number;
  shipmentExternalId: string;
  trackingReference: string;
  verificationUrl: string | null;
  currentTrackingSnapshotId: string | null;
  monitoringStatus: string;
  monitoringReason: string | null;
  consecutiveNotFoundCount: number;
  consecutiveFailureCount: number;
  failurePauseEnabled: boolean;
  failurePauseThreshold: number;
  lockVersion: number;
  deletedAt: Date | null;
  carrierCode: string;
  notFoundPauseThreshold: number;
}

export interface TrackingAttemptCounts {
  total: number;
  pending: number;
  failed: number;
}

export interface TrackingTransaction {
  recordSessionOutcome(runId: string, healthy: boolean): Promise<boolean>;
  lockAvailableCarrier(externalId: string): Promise<{ id: number } | null>;
  lockTargetShipments(
    externalIds: string[],
    carrierId: number,
  ): Promise<TrackingShipmentCandidate[]>;
  insertRun(
    command: CreateTrackingRun,
    carrierId: number,
  ): Promise<LockedTrackingRun>;
  insertAttempts(runId: string, shipmentIds: number[]): Promise<void>;
  lockRun(externalId: string): Promise<LockedTrackingRun | null>;
  markRunRunning(runId: string): Promise<void>;
  loadRunTargets(runId: string): Promise<TrackingRunTarget[]>;
  databaseNow(): Promise<Date>;
  lockAttempt(
    runExternalId: string,
    shipmentExternalId: string,
  ): Promise<LockedTrackingAttempt | null>;
  loadCurrentSnapshot(
    shipmentId: number,
    snapshotId: string,
  ): Promise<NormalizedTrackingState | null>;
  insertSnapshot(
    shipmentId: number,
    snapshot: NormalizedTrackingState,
    observedAt: Date,
  ): Promise<string>;
  updateShipmentFound(input: {
    shipmentId: number;
    snapshotId: string;
    verificationUrl: string | null;
    completedAt: Date;
    delivered: boolean;
    scheduleNext: boolean;
    reactivate: boolean;
    effectiveIntervalMinutes: number;
    expectedLockVersion: number;
  }): Promise<boolean>;
  updateShipmentNotFound(input: {
    shipmentId: number;
    notFoundCount: number;
    completedAt: Date;
    thresholdReached: boolean;
    scheduleNext: boolean;
    effectiveIntervalMinutes: number;
    expectedLockVersion: number;
  }): Promise<boolean>;
  updateShipmentFailed(input: {
    shipmentId: number;
    failureCount: number;
    thresholdReached: boolean;
    completedAt: Date;
    scheduleNext: boolean;
    effectiveIntervalMinutes: number;
    expectedLockVersion: number;
  }): Promise<boolean>;
  finalizeAttempt(input: {
    attemptId: string;
    outcome: 'found' | 'not_found' | 'failed' | 'skipped';
    snapshotId: string | null;
    snapshotChanged: boolean;
    sourceData: Record<string, unknown> | null;
    retryable: boolean | null;
    reasonCode: string | null;
    message: string | null;
    completedAt: Date;
  }): Promise<void>;
  countAttempts(runId: string): Promise<TrackingAttemptCounts>;
  updateRun(input: {
    runId: string;
    status: TrackingRunRecord['status'];
    reasonCode: string | null;
    message: string | null;
    completedAt: Date;
  }): Promise<void>;
  finalizePendingAttempts(input: {
    runId: string;
    outcome: 'failed' | 'skipped';
    retryable: boolean | null;
    reasonCode: string;
    message: string | null;
    completedAt: Date;
  }): Promise<void>;
}

export interface TrackingRepository {
  transaction<T>(
    work: (transaction: TrackingTransaction) => Promise<T>,
  ): Promise<T>;
}

export function trackingRunRecord(
  run: Omit<TrackingRunRecord, 'attemptCount'>,
  attemptCount: number,
): TrackingRunRecord {
  return {
    externalId: run.externalId,
    fetchMode: run.fetchMode,
    trigger: run.trigger,
    status: run.status,
    attemptCount,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

export const TRACKING_REPOSITORY = Symbol('TRACKING_REPOSITORY');
