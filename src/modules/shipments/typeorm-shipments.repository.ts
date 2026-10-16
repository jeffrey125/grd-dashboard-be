import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { SalesRepEntity } from '@modules/sales-reps/sales-rep.entity.js';
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
    return this.update(externalId, { notes }, actorId);
  }

  async update(
    externalId: string,
    changes: import('./shipments.schemas.js').ShipmentUpdate,
    actorId: number | null = null,
  ) {
    return this.source.transaction(async (manager) => {
      const rows = manager.getRepository(ShipmentEntity);
      const shipment = await rows
        .createQueryBuilder('shipment')
        .where('shipment.external_id = :externalId', { externalId })
        .andWhere('shipment.deleted_at IS NULL')
        .setLock('pessimistic_write')
        .getOne();

      if (!shipment) return null;

      let salesRepId = shipment.salesRepId;
      if (changes.salesRepExternalId !== undefined) {
        salesRepId = null;

        if (changes.salesRepExternalId) {
          const salesRep = await manager
            .getRepository(SalesRepEntity)
            .findOneBy({ externalId: changes.salesRepExternalId });

          if (!salesRep) return null;

          salesRepId = salesRep.id;
        }
      }

      const salesRepChanged =
        changes.salesRepExternalId !== undefined &&
        salesRepId !== shipment.salesRepId;
      const followUpChanged =
        changes.followUpOn !== undefined &&
        changes.followUpOn !== shipment.followUpOn;
      const patch: Record<string, unknown> = { updatedById: actorId };

      if (changes.notes !== undefined) patch.notes = changes.notes;
      if (changes.salesRepExternalId !== undefined)
        patch.salesRepId = salesRepId;
      if (changes.followUpOn !== undefined)
        patch.followUpOn = changes.followUpOn;
      if (salesRepChanged || followUpChanged) {
        patch.recordUpdatedAt = () => 'clock_timestamp()';
        patch.recordUpdatedById = actorId;
      }

      await rows.update({ id: shipment.id }, patch);

      return find(manager, externalId);
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

      const salesRepIds = [
        ...new Set(
          items
            .map((item) => item.salesRepExternalId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const salesReps = salesRepIds.length
        ? await manager
            .getRepository(SalesRepEntity)
            .createQueryBuilder('sales_rep')
            .where('sales_rep.external_id IN (:...salesRepIds)', {
              salesRepIds,
            })
            .andWhere('sales_rep.deleted_at IS NULL')
            .setLock('pessimistic_read')
            .getMany()
        : [];
      const availableSalesReps = new Map(
        salesReps.map((row) => [row.externalId, row]),
      );
      const unavailableSalesReps = salesRepIds.filter(
        (id) => !availableSalesReps.has(id),
      );

      if (unavailableSalesReps.length)
        return {
          kind: 'sales_rep_unavailable',
          salesRepExternalIds: unavailableSalesReps,
        };

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
            `INSERT INTO shipments
              (carrier_id, tracking_reference, notes, sales_rep_id, follow_up_on,
               next_check_at, created_by_id, updated_by_id)
             VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6, $6)
             ON CONFLICT (carrier_id, tracking_reference) WHERE deleted_at IS NULL DO NOTHING
             RETURNING external_id`,
            [
              carrierId,
              item.trackingReference,
              item.notes,
              item.salesRepExternalId
                ? availableSalesReps.get(item.salesRepExternalId)!.id
                : null,
              item.followUpOn,
              actorId,
            ],
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
