import type { EntityManager } from 'typeorm';

/** Reconcile delivery follow-up windows without undoing explicit or safeguard pauses. */
export async function reconcileDeliveredMonitoring(
  manager: EntityManager,
  shipmentId: number | null = null,
  actorId: number | null = null,
): Promise<void> {
  await manager.query(
    `UPDATE shipments shipment
        SET monitoring_status = 'active', monitoring_reason = NULL,
            next_check_at = clock_timestamp(), updated_at = clock_timestamp(),
            updated_by_id = $2, lock_version = lock_version + 1
      WHERE shipment.deleted_at IS NULL AND shipment.monitoring_status = 'completed'
        AND shipment.carrier_id NOT IN (SELECT id FROM carriers WHERE code = 'other')
        AND ($1::integer IS NULL OR shipment.id = $1)
        AND shipment.follow_up_on > (clock_timestamp() AT TIME ZONE 'America/New_York')::date`,
    [shipmentId, actorId],
  );

  await manager.query(
    `UPDATE shipments shipment
        SET monitoring_status = 'completed', monitoring_reason = 'delivered',
            next_check_at = NULL, updated_at = clock_timestamp(),
            updated_by_id = $2, lock_version = lock_version + 1
       FROM shipment_tracking_snapshots snapshot
      WHERE snapshot.id = shipment.current_tracking_snapshot_id
        AND snapshot.shipment_id = shipment.id AND snapshot.delivered_on IS NOT NULL
        AND shipment.deleted_at IS NULL AND shipment.monitoring_status <> 'completed'
        AND shipment.carrier_id NOT IN (SELECT id FROM carriers WHERE code = 'other')
        AND ($1::integer IS NULL OR shipment.id = $1)
        AND (shipment.follow_up_on IS NULL
          OR shipment.follow_up_on <= (clock_timestamp() AT TIME ZONE 'America/New_York')::date)`,
    [shipmentId, actorId],
  );
}

/** SQL expression for a current Shipment alias, evaluated using the database clock. */
export function monitoringWindowOpenSql(alias: string): string {
  return `(NOT EXISTS (SELECT 1 FROM shipment_tracking_snapshots window_snapshot
    WHERE window_snapshot.id = ${alias}.current_tracking_snapshot_id
      AND window_snapshot.shipment_id = ${alias}.id AND window_snapshot.delivered_on IS NOT NULL)
    OR COALESCE(${alias}.follow_up_on > (clock_timestamp() AT TIME ZONE 'America/New_York')::date, false))`;
}
