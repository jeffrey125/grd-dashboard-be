import type { TrackingRunRecord } from './tracking.repository.js';

export interface RunStatus extends TrackingRunRecord {
  carrierExternalId: string;
  reasonCode: string | null;
  attempts: Array<{
    shipmentExternalId: string;
    outcome: string;
    snapshotChanged: boolean;
    retryable: boolean | null;
    reasonCode: string | null;
    completedAt: string | null;
  }>;
}

export interface TrackingHttpRepository {
  queue(
    shipmentExternalId: string,
    actorId: number,
  ): Promise<
    | { kind: 'accepted'; run: TrackingRunRecord }
    | { kind: 'missing' | 'unavailable' }
  >;
  find(externalId: string): Promise<RunStatus | null>;
}

export const TRACKING_HTTP_REPOSITORY = Symbol('TRACKING_HTTP_REPOSITORY');
