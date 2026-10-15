import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import {
  ShipmentEntity,
  ShipmentMonitoringReason,
  ShipmentMonitoringStatus,
} from './shipment.entity.js';
import type { NewShipment } from './shipments.schemas.js';
import { readShipmentHistory } from './typeorm-shipment-history.js';
import { readShipments } from './typeorm-shipment-read.js';
import { searchShipments } from './typeorm-shipment-search.js';
import {
  SHIPMENTS_REPOSITORY,
  type MonitoringCommand,
  type MonitoringResult,
  type ShipmentsRepository,
  type ShipmentCreationResult,
  type ShipmentRecord,
} from './shipments.repository.js';

async function find(
  manager: EntityManager,
  externalId: string,
): Promise<ShipmentRecord | null> {
  return (await readShipments(manager, [externalId]))[0] ?? null;
}

export class TypeOrmShipmentsRepository implements ShipmentsRepository {
  constructor(private readonly source: DataSource) {}

  async list() {
    return readShipments(this.source.manager);
  }

  search(query: Parameters<ShipmentsRepository['search']>[0]) {
    return searchShipments(this.source.manager, query);
  }

  history(
    externalId: string,
    query: Parameters<ShipmentsRepository['history']>[1],
  ) {
    return readShipmentHistory(this.source.manager, externalId, query);
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
        { inserted: boolean; externalId: string }
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
          externalId,
        });
      }

      // Resolve all public records in one statement after pair writes/locks.
      const records = new Map(
        (
          await readShipments(
            manager,
            [...results.values()].map((result) => result.externalId),
          )
        ).map((row) => [row.externalId, row]),
      );
      const inserted: ShipmentRecord[] = [];
      const duplicates: ShipmentRecord[] = [];

      for (const item of items) {
        const result = results.get(item)!;

        (result.inserted ? inserted : duplicates).push(
          records.get(result.externalId)!,
        );
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
