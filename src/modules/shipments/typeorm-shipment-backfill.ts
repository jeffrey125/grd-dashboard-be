import type { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import {
  ensurePurchaseOrders,
  replacePurchaseOrders,
  purchaseOrderNumbersSql,
} from './typeorm-purchase-orders.js';

const text = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('\0'));
const list = z
  .array(text)
  .max(100)
  .transform((values) => [...new Set(values)].sort());
const fields = z.strictObject({
  customer: text.nullable(),
  vendor: text.nullable(),
  poNumber: z.string().nullable(),
  poNumbers: list,
  soNumbers: list,
  products: list,
});
const changes = z
  .strictObject({
    customer: text.optional(),
    vendor: text.optional(),
    poNumbers: list.optional(),
    soNumbers: list.optional(),
    products: list.optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export const shipmentBackfillPlanSchema = z
  .strictObject({
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    updates: z
      .array(
        z.strictObject({
          externalId: z.uuidv4().transform((value) => value.toLowerCase()),
          carrierId: z.int().positive(),
          trackingReference: text,
          sourceRows: z.array(z.int().min(2)).min(1),
          expected: fields,
          changes,
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((plan, context) => {
    const seen = new Set<string>();
    for (const [index, update] of plan.updates.entries()) {
      if (seen.has(update.externalId))
        context.addIssue({
          code: 'custom',
          path: ['updates', index],
          message: 'Duplicate shipment',
        });
      seen.add(update.externalId);
      for (const key of Object.keys(update.changes) as Array<
        keyof z.infer<typeof changes>
      >) {
        const old = update.expected[key];
        if (Array.isArray(old) ? old.length > 0 : old !== null)
          context.addIssue({
            code: 'custom',
            path: ['updates', index, 'changes', key],
            message: 'Only empty fields may be filled',
          });
      }
      if (
        update.changes.poNumbers !== undefined &&
        update.expected.poNumber !== null
      )
        context.addIssue({
          code: 'custom',
          path: ['updates', index],
          message: 'Existing PO display must be empty',
        });
    }
  });
export type ShipmentBackfillPlan = z.infer<typeof shipmentBackfillPlanSchema>;

async function read(manager: EntityManager, externalId: string, lock: boolean) {
  const [row]: Array<Record<string, unknown>> = await manager.query(
    `SELECT shipment.id, shipment.carrier_id, shipment.tracking_reference,
      shipment.customer, shipment.vendor, shipment.po_number AS "poNumber",
      ${purchaseOrderNumbersSql('shipment.id')} AS "poNumbers",
      shipment.so_numbers AS "soNumbers", shipment.products,
      shipment.notes, shipment.monitoring_status, shipment.monitoring_reason,
      shipment.current_tracking_snapshot_id, shipment.next_check_at
     FROM shipments shipment WHERE shipment.external_id = $1 AND shipment.deleted_at IS NULL
     ${lock ? 'FOR UPDATE OF shipment' : ''}`,
    [externalId],
  );
  if (row) (row.poNumbers as string[]).sort();

  return row;
}

/** No source values are guessed here: the operator supplies the exact reviewed plan. */
export async function runShipmentBackfill(
  source: DataSource,
  input: unknown,
  apply = false,
) {
  const plan = shipmentBackfillPlanSchema.parse(input);
  const ordered = [...plan.updates].sort((a, b) =>
    a.externalId.localeCompare(b.externalId),
  );
  return source.transaction(async (manager) => {
    if (!apply) await manager.query('SET TRANSACTION READ ONLY');
    const before = new Map<string, Record<string, unknown>>();
    for (const update of ordered) {
      const current = await read(manager, update.externalId, apply);
      if (
        !current ||
        current.carrier_id !== update.carrierId ||
        current.tracking_reference !== update.trackingReference
      )
        throw new Error(`Shipment identity changed: ${update.externalId}`);
      for (const [key, expected] of Object.entries(update.expected))
        if (JSON.stringify(current[key]) !== JSON.stringify(expected))
          throw new Error(
            `Shipment field changed: ${update.externalId} (${key})`,
          );
      before.set(update.externalId, current);
    }

    if (apply) {
      await ensurePurchaseOrders(
        manager,
        ordered.flatMap((update) => update.changes.poNumbers ?? []),
      );
      for (const update of ordered) {
        const previous = before.get(update.externalId)!;
        const values = update.changes;
        const poNumber =
          values.poNumbers === undefined
            ? previous.poNumber
            : values.poNumbers.join(', ') || null;
        await manager.query(
          `UPDATE shipments SET customer = $2, vendor = $3, po_number = $4,
            so_numbers = $5, products = $6, updated_at = clock_timestamp(),
            updated_by_id = NULL, record_updated_at = clock_timestamp(),
            record_updated_by_id = NULL, lock_version = lock_version + 1 WHERE id = $1`,
          [
            previous.id,
            values.customer ?? previous.customer,
            values.vendor ?? previous.vendor,
            poNumber,
            values.soNumbers ?? previous.soNumbers,
            values.products ?? previous.products,
          ],
        );
        if (values.poNumbers !== undefined)
          await replacePurchaseOrders(
            manager,
            Number(previous.id),
            values.poNumbers,
          );
      }
      for (const update of ordered) {
        const previous = before.get(update.externalId)!;
        const current = await read(manager, update.externalId, false);
        const expected = {
          ...previous,
          ...update.changes,
          ...(update.changes.poNumbers !== undefined
            ? { poNumber: update.changes.poNumbers.join(', ') || null }
            : {}),
        };
        if (JSON.stringify(current) !== JSON.stringify(expected))
          throw new Error(`Backfill verification failed: ${update.externalId}`);
      }
    }
    return {
      mode: apply ? 'applied' : 'read-only preview',
      shipments: ordered.length,
      fields: ordered.reduce(
        (total, update) => total + Object.keys(update.changes).length,
        0,
      ),
    };
  });
}
