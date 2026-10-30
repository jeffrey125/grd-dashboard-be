import { Entity, PrimaryColumn } from 'typeorm';

@Entity('purchase_orders')
export class PurchaseOrderEntity {
  @PrimaryColumn({ name: 'po_number', type: 'varchar', length: 255 })
  poNumber: string;
}
