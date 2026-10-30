import { Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';

@Entity('shipment_purchase_orders')
@ForeignKey('ShipmentEntity', ['shipmentId'], ['id'], {
  name: 'fk_shipment_purchase_orders_shipment',
  onDelete: 'NO ACTION',
})
@ForeignKey('PurchaseOrderEntity', ['poNumber'], ['poNumber'], {
  name: 'fk_shipment_purchase_orders_order',
  onDelete: 'NO ACTION',
})
@Index('ix_shipment_purchase_orders_number', ['poNumber'])
export class ShipmentPurchaseOrderEntity {
  @PrimaryColumn({ name: 'shipment_id', type: 'integer' })
  shipmentId: number;

  @PrimaryColumn({ name: 'po_number', type: 'varchar', length: 255 })
  poNumber: string;
}
