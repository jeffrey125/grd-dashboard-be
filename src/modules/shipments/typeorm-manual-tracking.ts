import type { EntityManager } from 'typeorm';
import type { z } from 'zod';
import type { manualTrackingSchema } from './shipments.schemas.js';

export async function saveManualTracking(
  manager: EntityManager,
  shipmentId: number,
  input: z.infer<typeof manualTrackingSchema>,
  actorId: number | null,
): Promise<void> {
  const [current] = await manager.query(
    `SELECT snapshot.carrier_status, snapshot.picked_up_on::text, snapshot.estimated_delivery_on::text,
      snapshot.delivered_on::text, (clock_timestamp() AT TIME ZONE 'America/New_York')::date::text AS today
     FROM shipments shipment LEFT JOIN shipment_tracking_snapshots snapshot
       ON snapshot.id = shipment.current_tracking_snapshot_id
     WHERE shipment.id = $1`,
    [shipmentId],
  );
  if (
    current.carrier_status === input.carrierStatus &&
    current.picked_up_on === input.pickedUpOn &&
    current.estimated_delivery_on === input.estimatedDeliveryOn
  )
    return;

  const delivered =
    input.carrierStatus === 'Delivered'
      ? (current.delivered_on ?? current.today)
      : null;
  const [snapshot] = await manager.query(
    `INSERT INTO shipment_tracking_snapshots
       (shipment_id, carrier_status, picked_up_on, estimated_delivery_on, delivered_on)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      shipmentId,
      input.carrierStatus,
      input.pickedUpOn,
      input.estimatedDeliveryOn,
      delivered,
    ],
  );
  await manager.query(
    `UPDATE shipments SET current_tracking_snapshot_id = $2,
       monitoring_status = $3, monitoring_reason = $4, next_check_at = NULL,
       updated_at = clock_timestamp(), updated_by_id = $5,
       record_updated_at = clock_timestamp(), record_updated_by_id = $5,
       lock_version = lock_version + 1 WHERE id = $1`,
    [
      shipmentId,
      snapshot.id,
      delivered ? 'completed' : 'active',
      delivered ? 'delivered' : null,
      actorId,
    ],
  );
}
