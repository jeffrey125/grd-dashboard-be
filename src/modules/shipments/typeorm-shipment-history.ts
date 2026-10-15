import type { EntityManager } from 'typeorm';
import { trackingSnapshotRecordSchema } from '@modules/tracking/tracking-read.schemas.js';
import {
  shipmentHistoryResponseSchema,
  type ShipmentHistoryQuery,
} from './shipments.schemas.js';
import type { ShipmentHistoryResponse } from './shipments.repository.js';

interface HistoryEnvelopeRow {
  items: unknown[];
  total: number;
}

function snapshotRecord(value: unknown) {
  const item = value as Record<string, unknown>;

  return trackingSnapshotRecordSchema.parse({
    ...item,
    observedAt: new Date(String(item.observedAt)),
  });
}

/** Existence, total, and page data share one PostgreSQL statement snapshot. */
export async function readShipmentHistory(
  manager: EntityManager,
  externalId: string,
  query: ShipmentHistoryQuery,
): Promise<ShipmentHistoryResponse | null> {
  const offset = (query.page - 1) * query.pageSize;
  const rows: HistoryEnvelopeRow[] = await manager.query(
    `WITH requested_shipment AS MATERIALIZED (
      SELECT id
      FROM shipments
      WHERE external_id = $1::uuid AND deleted_at IS NULL
    ), history AS MATERIALIZED (
      SELECT
        snapshot.id,
        snapshot.external_id,
        snapshot.carrier_status,
        snapshot.carrier_status_detail,
        snapshot.picked_up_on,
        snapshot.estimated_delivery_on,
        snapshot.delivered_on,
        snapshot.observed_at
      FROM shipment_tracking_snapshots snapshot
      JOIN requested_shipment shipment ON shipment.id = snapshot.shipment_id
    ), page_rows AS (
      SELECT *
      FROM history
      ORDER BY observed_at DESC, id DESC
      LIMIT $2 OFFSET $3
    )
    SELECT
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'externalId', external_id,
            'carrierStatus', carrier_status,
            'carrierStatusDetail', carrier_status_detail,
            'pickedUpOn', picked_up_on,
            'estimatedDeliveryOn', estimated_delivery_on,
            'deliveredOn', delivered_on,
            'observedAt', observed_at
          ) ORDER BY observed_at DESC, id DESC
        )
        FROM page_rows
      ), '[]'::jsonb) AS items,
      (SELECT count(*)::integer FROM history) AS total
    WHERE EXISTS (SELECT 1 FROM requested_shipment)`,
    [externalId, query.pageSize, offset],
  );
  const row = rows[0];

  if (!row) return null;

  return shipmentHistoryResponseSchema.parse({
    items: row.items.map(snapshotRecord),
    page: query.page,
    pageSize: query.pageSize,
    total: row.total,
  });
}
