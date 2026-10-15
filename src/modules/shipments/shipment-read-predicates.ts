import type { ShipmentSearchQuery } from './shipments.schemas.js';

export const SHIPMENT_TAB_PREDICATES = {
  all: 'TRUE',
  active: "monitoring_status = 'active'",
  paused: "monitoring_status = 'paused'",
  delivered: "monitoring_status = 'completed'",
  attention: `monitoring_status <> 'completed'
    AND (lookup_outcome = 'failed'
      OR (monitoring_status = 'paused' AND monitoring_reason = 'not_found_threshold'))`,
} as const satisfies Record<ShipmentSearchQuery['tab'], string>;

export function shipmentTabPredicate(tab: ShipmentSearchQuery['tab']): string {
  return SHIPMENT_TAB_PREDICATES[tab];
}
