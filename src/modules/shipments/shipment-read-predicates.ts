import type { ShipmentSearchQuery } from './shipments.schemas.js';

export const SHIPMENT_TAB_PREDICATES = {
  all: 'TRUE',
  other: "carrier_code = 'other'",
  active: `carrier_code <> 'other' AND monitoring_status = 'active'
    AND lookup_outcome IS DISTINCT FROM 'failed'
    AND (follow_up_on IS NULL OR follow_up_on > (clock_timestamp() AT TIME ZONE 'America/New_York')::date)`,
  paused: "monitoring_status = 'paused'",
  delivered: "carrier_code <> 'other' AND monitoring_status = 'completed'",
  attention: `monitoring_status = 'paused'
    OR (monitoring_status <> 'completed' AND lookup_outcome = 'failed')
    OR (follow_up_on IS NOT NULL AND follow_up_on <= (clock_timestamp() AT TIME ZONE 'America/New_York')::date)`,
} as const satisfies Record<ShipmentSearchQuery['tab'], string>;

const businessDateExpression = `(clock_timestamp() AT TIME ZONE 'America/New_York')::date`;

export function shipmentTabPredicateAt(
  tab: ShipmentSearchQuery['tab'],
  businessDate: string,
): string {
  return SHIPMENT_TAB_PREDICATES[tab].replaceAll(
    businessDateExpression,
    businessDate,
  );
}

export function shipmentTabPredicate(tab: ShipmentSearchQuery['tab']): string {
  return SHIPMENT_TAB_PREDICATES[tab];
}
