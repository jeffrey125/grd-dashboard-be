import type { EntityManager } from 'typeorm';

/** Seed shared references in one global order before a batch acquires order locks. */
export async function ensurePurchaseOrders(
  manager: EntityManager,
  values: string[],
): Promise<void> {
  for (const value of [...new Set(values)].sort())
    await manager.query(
      'INSERT INTO purchase_orders (po_number) VALUES ($1) ON CONFLICT DO NOTHING',
      [value],
    );
}

/** Called only while the owning shipment is locked, inside its write transaction. */
export async function replacePurchaseOrders(
  manager: EntityManager,
  shipmentId: number,
  values: string[],
): Promise<void> {
  const numbers = [...new Set(values)].sort();
  await ensurePurchaseOrders(manager, numbers);

  await manager.query(
    'DELETE FROM shipment_purchase_orders WHERE shipment_id = $1',
    [shipmentId],
  );

  if (numbers.length)
    await manager.query(
      `INSERT INTO shipment_purchase_orders (shipment_id, po_number)
       SELECT $1, unnest($2::varchar[])`,
      [shipmentId, numbers],
    );
}

export function purchaseOrderNumbersSql(shipmentId: string): string {
  return `ARRAY(SELECT purchase_order.po_number FROM shipment_purchase_orders purchase_order
    WHERE purchase_order.shipment_id = ${shipmentId} ORDER BY purchase_order.po_number)`;
}
