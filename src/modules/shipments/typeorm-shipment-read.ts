import type { EntityManager } from 'typeorm';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { ShipmentTrackingSnapshotEntity } from '@modules/tracking/shipment-tracking-snapshot.entity.js';
import { TrackingAttemptEntity } from '@modules/tracking/tracking-attempt.entity.js';
import { TrackingRunEntity } from '@modules/tracking/tracking-run.entity.js';
import { trackingRunRecord } from '@modules/tracking/tracking.repository.js';
import { ShipmentEntity } from './shipment.entity.js';
import { shipmentRecordSchema } from './shipments.schemas.js';
import type { ShipmentRecord } from './shipments.repository.js';

type JoinedShipment = ShipmentEntity & {
  carrier: CarrierEntity;
  currentTracking: ShipmentTrackingSnapshotEntity | null;
  latestLookup: TrackingAttemptEntity | null;
  latestRun: TrackingRunEntity | null;
};

interface ReadExtras {
  shipment_external_id: string;
  lookup_run_external_id: string | null;
  latest_run_attempt_count: number;
}

function record(row: JoinedShipment, extras: ReadExtras): ShipmentRecord {
  const snapshot = row.currentTracking;
  const lookup = row.latestLookup;

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
    currentTracking: snapshot
      ? {
          externalId: snapshot.externalId,
          carrierStatus: snapshot.carrierStatus,
          carrierStatusDetail: snapshot.carrierStatusDetail,
          pickedUpOn: snapshot.pickedUpOn,
          estimatedDeliveryOn: snapshot.estimatedDeliveryOn,
          deliveredOn: snapshot.deliveredOn,
          observedAt: snapshot.observedAt,
        }
      : null,
    latestLookup: lookup
      ? {
          runExternalId: extras.lookup_run_external_id,
          outcome: lookup.outcome,
          snapshotChanged: lookup.snapshotChanged,
          retryable: lookup.retryable,
          reasonCode: lookup.reasonCode,
          completedAt: lookup.completedAt,
        }
      : null,
    latestRun: row.latestRun
      ? trackingRunRecord(row.latestRun, extras.latest_run_attempt_count)
      : null,
    monitoringStatus: row.monitoringStatus,
    monitoringReason: row.monitoringReason,
    lastAttemptedAt: row.lastAttemptedAt,
    nextCheckAt: row.nextCheckAt,
    consecutiveNotFoundCount: row.consecutiveNotFoundCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** One PostgreSQL statement snapshot for every Shipment and its related read state. */
export async function readShipments(
  manager: EntityManager,
  externalIds?: string[],
): Promise<ShipmentRecord[]> {
  if (externalIds?.length === 0) return [];

  // Carrier retirement does not hide existing Shipments. Snapshot identity comes
  // from the pointer; latest completed lookup and latest associated run are independent.
  const query = manager
    .getRepository(ShipmentEntity)
    .createQueryBuilder('shipment')
    .withDeleted()
    .innerJoinAndMapOne(
      'shipment.carrier',
      CarrierEntity,
      'carrier',
      'carrier.id = shipment.carrier_id',
    )
    .leftJoinAndMapOne(
      'shipment.currentTracking',
      ShipmentTrackingSnapshotEntity,
      'snapshot',
      'snapshot.id = shipment.current_tracking_snapshot_id AND snapshot.shipment_id = shipment.id',
    )
    .leftJoinAndMapOne(
      'shipment.latestLookup',
      TrackingAttemptEntity,
      'lookup',
      `lookup.id = (
      SELECT candidate.id FROM tracking_attempts candidate
      WHERE candidate.shipment_id = shipment.id AND candidate.completed_at IS NOT NULL
      ORDER BY candidate.completed_at DESC, candidate.id DESC LIMIT 1
    )`,
    )
    .leftJoin(
      TrackingRunEntity,
      'lookup_run',
      'lookup_run.id = lookup.tracking_run_id',
    )
    .leftJoinAndMapOne(
      'shipment.latestRun',
      TrackingRunEntity,
      'latest_run',
      `latest_run.id = (
      SELECT associated.id FROM tracking_runs associated
      JOIN tracking_attempts membership ON membership.tracking_run_id = associated.id
      WHERE membership.shipment_id = shipment.id
      ORDER BY associated.created_at DESC, associated.id DESC LIMIT 1
    )`,
    )
    .select([
      'shipment',
      'snapshot',
      'carrier.id',
      'carrier.externalId',
      'carrier.code',
      'carrier.name',
      'carrier.isActive',
      'lookup.id',
      'lookup.outcome',
      'lookup.snapshotChanged',
      'lookup.retryable',
      'lookup.reasonCode',
      'lookup.completedAt',
      'latest_run.id',
      'latest_run.externalId',
      'latest_run.trigger',
      'latest_run.fetchMode',
      'latest_run.status',
      'latest_run.createdAt',
      'latest_run.startedAt',
      'latest_run.completedAt',
    ])
    .addSelect('lookup_run.external_id', 'lookup_run_external_id')
    .addSelect(
      '(SELECT count(*)::integer FROM tracking_attempts counted WHERE counted.tracking_run_id = latest_run.id)',
      'latest_run_attempt_count',
    )
    .where('shipment.deleted_at IS NULL')
    .orderBy('shipment.created_at', 'DESC')
    .addOrderBy('shipment.id', 'DESC');

  if (externalIds)
    query.andWhere('shipment.external_id IN (:...externalIds)', {
      externalIds,
    });

  const { entities, raw } = await query.getRawAndEntities<ReadExtras>();
  const extras = new Map(raw.map((row) => [row.shipment_external_id, row]));

  return entities.map((row) =>
    record(row as JoinedShipment, extras.get(row.externalId)!),
  );
}
