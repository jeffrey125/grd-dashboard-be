import type { NormalizedTrackingState } from '@modules/tracking/tracking.schemas.js';

export interface TrackingNotice {
  carrierCode: string;
  shipmentExternalId: string;
  trackingReference: string;
  outcome: 'found' | 'not_found' | 'failed';
  changed?: boolean;
  initial?: boolean;
  snapshot?: NormalizedTrackingState;
  previous?: NormalizedTrackingState | null;
  stopped?: 'delivered' | 'not_found_threshold' | 'failure_threshold';
}

export abstract class TrackingNotifications {
  abstract record(notice: TrackingNotice): Promise<void>;
}
