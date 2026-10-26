import type { CarrierUpdate } from './carriers.schemas.js';
import type { FetchMode } from './carrier-fetch-mode.js';

export interface CarrierRecord {
  externalId: string;
  code: string;
  name: string;
  isActive: boolean;
  fetchMode: FetchMode;
  failurePauseEnabled: boolean;
  failurePauseThreshold: number;
  sessionFailureDisableEnabled: boolean;
  sessionFailureDisableThreshold: number;
  consecutiveSessionFailures: number;
  sessionGeneration: number;
  autoDisabledReason: 'session_failures' | null;
  notFoundPauseThreshold: number;
  pollIntervalMinutes: number;
  rateLimitPerMinute: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CarriersRepository {
  list(): Promise<CarrierRecord[]>;
  /** Eligible Carriers for future scheduled work; always excludes deleted rows. */
  listActive(): Promise<CarrierRecord[]>;
  find(externalId: string): Promise<CarrierRecord | null>;
  update(
    externalId: string,
    changes: CarrierUpdate,
    actorId?: number | null,
  ): Promise<CarrierRecord | null>;
}

export const CARRIERS_REPOSITORY = Symbol('CARRIERS_REPOSITORY');
