import type { z } from 'zod';
import type { NewShipment, shipmentRecordSchema } from './shipments.schemas.js';

export type ShipmentRecord = z.infer<typeof shipmentRecordSchema>;
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
  find(externalId: string): Promise<ShipmentRecord | null>;
  createMany(items: NewShipment[]): Promise<ShipmentCreationResult>;
  updateNotes(
    externalId: string,
    notes: string | null,
  ): Promise<ShipmentRecord | null>;
  remove(externalId: string): Promise<boolean>;
  changeMonitoring(
    externalId: string,
    command: MonitoringCommand,
  ): Promise<MonitoringResult>;
}
export const SHIPMENTS_REPOSITORY = Symbol('SHIPMENTS_REPOSITORY');
