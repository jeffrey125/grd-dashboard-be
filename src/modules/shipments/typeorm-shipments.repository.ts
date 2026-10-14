import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import {
  ShipmentEntity,
  ShipmentMonitoringReason,
  ShipmentMonitoringStatus,
} from './shipment.entity.js';
import { shipmentRecordSchema, type NewShipment } from './shipments.schemas.js';
import {
  SHIPMENTS_REPOSITORY,
  type MonitoringCommand,
  type MonitoringResult,
  type ShipmentsRepository,
  type ShipmentCreationResult,
  type ShipmentRecord,
} from './shipments.repository.js';

type JoinedShipment = ShipmentEntity & { carrier: CarrierEntity };

function record(row: JoinedShipment): ShipmentRecord {
  return shipmentRecordSchema.parse({
    externalId: row.externalId,
    carrier: {
      externalId: row.carrier.externalId,
      code: row.carrier.code,
      name: row.carrier.name,
      isActive: row.carrier.isActive,
    },
    trackingReference: row.trackingReference,
    notes: row.notes,
    verificationUrl: row.verificationUrl,
    monitoringStatus: row.monitoringStatus,
    monitoringReason: row.monitoringReason,
    lastAttemptedAt: row.lastAttemptedAt,
    nextCheckAt: row.nextCheckAt,
    consecutiveNotFoundCount: row.consecutiveNotFoundCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function readable(manager: EntityManager) {
  // Carrier retirement never hides its existing Shipments. Only the Shipment's
  // deletion flag controls access, and all joined fields are projected explicitly.
  return manager
    .getRepository(ShipmentEntity)
    .createQueryBuilder('shipment')
    .withDeleted()
    .innerJoinAndMapOne(
      'shipment.carrier',
      CarrierEntity,
      'carrier',
      'carrier.id = shipment.carrier_id',
    )
    .where('shipment.deleted_at IS NULL');
}

async function find(
  manager: EntityManager,
  externalId: string,
): Promise<ShipmentRecord | null> {
  const row = await readable(manager)
    .andWhere('shipment.external_id = :externalId', { externalId })
    .getOne();
  return row ? record(row as JoinedShipment) : null;
}

export class TypeOrmShipmentsRepository implements ShipmentsRepository {
  constructor(private readonly source: DataSource) {}

  async list() {
    const rows = await readable(this.source.manager)
      .orderBy('shipment.created_at', 'DESC')
      .addOrderBy('shipment.id', 'DESC')
      .getMany();
    return rows.map((row) => record(row as JoinedShipment));
  }

  find(externalId: string) {
    return find(this.source.manager, externalId);
  }

  async updateNotes(
    externalId: string,
    notes: string | null,
    actorId: number | null = null,
  ) {
    return this.source.transaction(async (manager) => {
      const result = await manager
        .getRepository(ShipmentEntity)
        .update(
          { externalId, deletedAt: IsNull() },
          { notes, updatedById: actorId },
        );
      return result.affected ? find(manager, externalId) : null;
    });
  }

  async remove(externalId: string, actorId: number | null = null) {
    const result = await this.source
      .getRepository(ShipmentEntity)
      .createQueryBuilder()
      .update()
      .set({
        deletedAt: () => 'clock_timestamp()',
        nextCheckAt: null,
        updatedById: actorId,
        deletedById: actorId,
      })
      .where('external_id = :externalId AND deleted_at IS NULL', { externalId })
      .execute();
    return Boolean(result.affected);
  }

  async changeMonitoring(
    externalId: string,
    command: MonitoringCommand,
    actorId: number | null = null,
  ): Promise<MonitoringResult> {
    return this.source.transaction(async (manager) => {
      const rows = manager.getRepository(ShipmentEntity);
      const row = await rows
        .createQueryBuilder('shipment')
        .where('shipment.external_id = :externalId', { externalId })
        .setLock('pessimistic_write')
        .getOne();
      if (!row) return { kind: 'missing' };
      const permitted =
        command === 'pause'
          ? row.monitoringStatus === ShipmentMonitoringStatus.Active
          : row.monitoringStatus === ShipmentMonitoringStatus.Paused &&
            row.monitoringReason === ShipmentMonitoringReason.Manual;
      if (!permitted) return { kind: 'conflict' };
      await rows.update(
        { id: row.id, deletedAt: IsNull() },
        command === 'pause'
          ? {
              updatedById: actorId,
              monitoringStatus: ShipmentMonitoringStatus.Paused,
              monitoringReason: ShipmentMonitoringReason.Manual,
              nextCheckAt: null,
            }
          : {
              updatedById: actorId,
              monitoringStatus: ShipmentMonitoringStatus.Active,
              monitoringReason: null,
              nextCheckAt: () => 'clock_timestamp()',
            },
      );
      return { kind: 'updated', shipment: (await find(manager, externalId))! };
    });
  }

  async createMany(
    items: NewShipment[],
    actorId: number | null = null,
  ): Promise<ShipmentCreationResult> {
    return this.source.transaction('READ COMMITTED', async (manager) => {
      const carrierIds = [
        ...new Set(items.map((item) => item.carrierExternalId)),
      ];
      if (!carrierIds.length)
        return { kind: 'created', inserted: [], duplicates: [] };
      // A shared Carrier lock serializes eligibility against disable/delete
      // writes, while allowing concurrent creations for the same Carrier.
      const carriers = await manager
        .getRepository(CarrierEntity)
        .createQueryBuilder('carrier')
        .withDeleted()
        .where('carrier.external_id IN (:...carrierIds)', { carrierIds })
        .orderBy('carrier.id', 'ASC')
        .setLock('pessimistic_read')
        .getMany();
      const available = new Map(
        carriers
          .filter((row) => row.isActive && !row.deletedAt)
          .map((row) => [row.externalId, row]),
      );
      const unavailable = carrierIds.filter((id) => !available.has(id));
      if (unavailable.length)
        return { kind: 'unavailable', carrierExternalIds: unavailable };

      const results = new Map<
        NewShipment,
        { inserted: boolean; shipment: ShipmentRecord }
      >();
      // Acquire conflicting pair locks in a global order, including batches
      // submitted in reverse order, to prevent cross-request deadlocks.
      const key = (item: NewShipment) =>
        JSON.stringify([item.carrierExternalId, item.trackingReference]);
      const ordered = [...items].sort((a, b) =>
        key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
      );
      for (const item of ordered) {
        const carrierId = available.get(item.carrierExternalId)!.id;
        let externalId: string | undefined;
        let inserted = false;
        while (!externalId) {
          const created: Array<{ external_id: string }> = await manager.query(
            `INSERT INTO shipments (carrier_id, tracking_reference, notes, next_check_at, created_by_id, updated_by_id)
             VALUES ($1, $2, $3, clock_timestamp(), $4, $4)
             ON CONFLICT (carrier_id, tracking_reference) WHERE deleted_at IS NULL DO NOTHING
             RETURNING external_id`,
            [carrierId, item.trackingReference, item.notes, actorId],
          );
          externalId = created[0]?.external_id;
          inserted = Boolean(externalId);
          if (!externalId) {
            // Use a new READ COMMITTED statement snapshot after ON CONFLICT
            // waits for another transaction. Lock duplicates until the response
            // is read; retry if a concurrent deletion removed the conflicting row.
            const existing: Array<{ external_id: string }> =
              await manager.query(
                `SELECT external_id FROM shipments WHERE carrier_id = $1
               AND tracking_reference = $2 AND deleted_at IS NULL FOR UPDATE`,
                [carrierId, item.trackingReference],
              );
            externalId = existing[0]?.external_id;
          }
        }
        results.set(item, {
          inserted,
          shipment: (await find(manager, externalId))!,
        });
      }
      const inserted: ShipmentRecord[] = [];
      const duplicates: ShipmentRecord[] = [];
      for (const item of items) {
        const result = results.get(item)!;
        (result.inserted ? inserted : duplicates).push(result.shipment);
      }
      return { kind: 'created', inserted, duplicates };
    });
  }
}

export const shipmentsRepositoryProvider = {
  provide: SHIPMENTS_REPOSITORY,
  inject: [DataSource],
  useFactory: (source: DataSource): ShipmentsRepository =>
    new TypeOrmShipmentsRepository(source),
};
