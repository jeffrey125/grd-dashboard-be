import type { ShipmentSearchQuery } from './shipments.schemas.js';

export const SHIPMENT_TAB_PREDICATES = {
  all: 'TRUE',
  active: `monitoring_status = 'active'
    AND lookup_outcome IS DISTINCT FROM 'failed'`,
  paused: "monitoring_status = 'paused'",
  delivered: "monitoring_status = 'completed'",
  attention: `monitoring_status = 'paused'
    OR (monitoring_status <> 'completed' AND lookup_outcome = 'failed')`,
} as const satisfies Record<ShipmentSearchQuery['tab'], string>;

export function shipmentTabPredicate(tab: ShipmentSearchQuery['tab']): string {
  return SHIPMENT_TAB_PREDICATES[tab];
}
