import { shipmentRecordSchema } from './shipments.schemas.js';
import type { ShipmentRecord } from './shipments.repository.js';

type JsonObject = Record<string, unknown>;

function asNullableDate(value: unknown): Date | null {
  return value === null ? null : new Date(String(value));
}

export function shipmentRecord(value: unknown): ShipmentRecord {
  const item = value as JsonObject;
  const currentTracking = item.currentTracking as JsonObject | null;
  const latestLookup = item.latestLookup as JsonObject | null;
  const latestRun = item.latestRun as JsonObject | null;

  return shipmentRecordSchema.parse({
    ...item,
    currentTracking: currentTracking
      ? {
          ...currentTracking,
          observedAt: new Date(String(currentTracking.observedAt)),
        }
      : null,
    latestLookup: latestLookup
      ? {
          ...latestLookup,
          completedAt: new Date(String(latestLookup.completedAt)),
        }
      : null,
    latestRun: latestRun
      ? {
          ...latestRun,
          createdAt: new Date(String(latestRun.createdAt)),
          startedAt: asNullableDate(latestRun.startedAt),
          completedAt: asNullableDate(latestRun.completedAt),
        }
      : null,
    lastAttemptedAt: asNullableDate(item.lastAttemptedAt),
    nextCheckAt: asNullableDate(item.nextCheckAt),
    createdAt: new Date(String(item.createdAt)),
    updatedAt: new Date(String(item.updatedAt)),
  });
}

export function shipmentJsonSql(alias: string): string {
  return `jsonb_build_object(
    'externalId', ${alias}.shipment_external_id,
    'carrier', jsonb_build_object(
      'externalId', ${alias}.carrier_external_id,
      'code', ${alias}.carrier_code,
      'name', ${alias}.carrier_name,
      'isActive', ${alias}.carrier_is_active
    ),
    'trackingReference', ${alias}.tracking_reference,
    'notes', ${alias}.notes,
    'verificationUrl', ${alias}.verification_url,
    'currentTracking', CASE WHEN ${alias}.snapshot_external_id IS NULL THEN NULL ELSE jsonb_build_object(
      'externalId', ${alias}.snapshot_external_id,
      'carrierStatus', ${alias}.snapshot_carrier_status,
      'carrierStatusDetail', ${alias}.snapshot_carrier_status_detail,
      'pickedUpOn', ${alias}.snapshot_picked_up_on,
      'estimatedDeliveryOn', ${alias}.snapshot_estimated_delivery_on,
      'deliveredOn', ${alias}.snapshot_delivered_on,
      'observedAt', ${alias}.snapshot_observed_at
    ) END,
    'latestLookup', CASE WHEN ${alias}.lookup_id IS NULL THEN NULL ELSE jsonb_build_object(
      'runExternalId', ${alias}.lookup_run_external_id,
      'outcome', ${alias}.lookup_outcome,
      'snapshotChanged', ${alias}.lookup_snapshot_changed,
      'retryable', ${alias}.lookup_retryable,
      'reasonCode', ${alias}.lookup_reason_code,
      'completedAt', ${alias}.lookup_completed_at
    ) END,
    'latestRun', CASE WHEN ${alias}.latest_run_id IS NULL THEN NULL ELSE jsonb_build_object(
      'externalId', ${alias}.latest_run_external_id,
      'trigger', ${alias}.latest_run_trigger,
      'fetchMode', ${alias}.latest_run_fetch_mode,
      'status', ${alias}.latest_run_status,
      'attemptCount', ${alias}.latest_run_attempt_count,
      'createdAt', ${alias}.latest_run_created_at,
      'startedAt', ${alias}.latest_run_started_at,
      'completedAt', ${alias}.latest_run_completed_at
    ) END,
    'monitoringStatus', ${alias}.monitoring_status,
    'monitoringReason', ${alias}.monitoring_reason,
    'lastAttemptedAt', ${alias}.last_attempted_at,
    'nextCheckAt', ${alias}.next_check_at,
    'consecutiveNotFoundCount', ${alias}.consecutive_not_found_count,
    'createdAt', ${alias}.created_at,
    'updatedAt', ${alias}.updated_at
  )`;
}
