import type { z } from 'zod';
import type {
  NewShipment,
  ShipmentHistoryQuery,
  ShipmentSearchQuery,
  shipmentHistoryResponseSchema,
  shipmentRecordSchema,
  shipmentSearchResponseSchema,
} from './shipments.schemas.js';

export type ShipmentRecord = z.infer<typeof shipmentRecordSchema>;
export type ShipmentSearchResponse = z.infer<
  typeof shipmentSearchResponseSchema
>;
export type ShipmentHistoryResponse = z.infer<
  typeof shipmentHistoryResponseSchema
>;

export interface BulkShipmentResult {
  inserted: ShipmentRecord[];
  duplicates: ShipmentRecord[];
}

export type ShipmentCreationResult =
  | ({ kind: 'created' } & BulkShipmentResult)
  | { kind: 'unavailable'; carrierExternalIds: string[] };

export type MonitoringCommand = 'pause' | 'resume';

export type MonitoringResult =
  | { kind: 'updated'; shipment: ShipmentRecord }
  | { kind: 'missing' }
  | { kind: 'conflict' };

export interface ShipmentsRepository {
  list(): Promise<ShipmentRecord[]>;
  search(query: ShipmentSearchQuery): Promise<ShipmentSearchResponse>;
  history(
    externalId: string,
    query: ShipmentHistoryQuery,
  ): Promise<ShipmentHistoryResponse | null>;
  find(externalId: string): Promise<ShipmentRecord | null>;
  createMany(
    items: NewShipment[],
    actorId?: number | null,
  ): Promise<ShipmentCreationResult>;
  updateNotes(
    externalId: string,
    notes: string | null,
    actorId?: number | null,
  ): Promise<ShipmentRecord | null>;
  remove(externalId: string, actorId?: number | null): Promise<boolean>;
  changeMonitoring(
    externalId: string,
    command: MonitoringCommand,
    actorId?: number | null,
  ): Promise<MonitoringResult>;
}

export const SHIPMENTS_REPOSITORY = Symbol('SHIPMENTS_REPOSITORY');
