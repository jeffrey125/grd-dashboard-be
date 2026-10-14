import type { CarrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import type { TrackingResult } from './carrier-result.js';
import type { FetchMode } from '@modules/carriers/carrier-fetch-mode.js';

export type { TrackingResult } from './carrier-result.js';

/** Only sanitized, allowlisted source data and messages may cross this boundary. */
export interface TrackingSession {
  read(reference: string, signal: AbortSignal): Promise<TrackingResult>;
  /** One export may serve the complete run. Missing entries are technical failures. */
  readMany?(
    references: readonly string[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, TrackingResult>>;
  close(): Promise<void>;
}

export interface CarrierAdapter {
  readonly code: string;
  readonly minimumIntervalMinutes: number;
  readonly referencePolicy: CarrierReferencePolicy;
  /** Validate local configuration only; do not open a network/browser session. */
  validateConfiguration(): void;
  /** Adapters own bounded I/O, retries and every physical request's rate limiting. */
  openSession(options: {
    fetchMode?: FetchMode;
    signal: AbortSignal;
    rateLimitPerMinute: number | null;
  }): Promise<TrackingSession>;
}

export const CARRIER_ADAPTERS = Symbol('CARRIER_ADAPTERS');
