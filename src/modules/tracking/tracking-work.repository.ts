export interface QueuedTrackingWork {
  externalId: string;
  carrierExternalId: string;
}

/** Read-side scheduling queries; all lifecycle writes belong to TrackingService. */
export interface TrackingWorkRepository {
  findDue(
    carrierExternalId: string,
    minimumIntervalMinutes: number,
  ): Promise<string[]>;
  nextManual(): Promise<QueuedTrackingWork | null>;
  interruptedRuns(): Promise<string[]>;
  abandonedScheduledRuns(): Promise<string[]>;
}

export const TRACKING_WORK_REPOSITORY = Symbol('TRACKING_WORK_REPOSITORY');
