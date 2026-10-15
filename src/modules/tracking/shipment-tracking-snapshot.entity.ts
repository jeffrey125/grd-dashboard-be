import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('shipment_tracking_snapshots')
@ForeignKey('ShipmentEntity', ['shipmentId'], ['id'], {
  name: 'fk_snapshots_shipment',
  onDelete: 'NO ACTION',
})
@Unique('uq_snapshots_external_id', ['externalId'])
@Unique('uq_snapshots_owner', ['shipmentId', 'id'])
// TypeORM cannot model mixed ASC/DESC keys. The migration and catalog tests own this index.
@Index('ix_snapshots_history', { synchronize: false })
@Check(
  'ck_snapshots_tracking_data',
  `carrier_status IS NOT NULL OR carrier_status_detail IS NOT NULL
  OR picked_up_on IS NOT NULL OR estimated_delivery_on IS NOT NULL OR delivered_on IS NOT NULL`,
)
export class ShipmentTrackingSnapshotEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  readonly id: string;

  @Column({
    name: 'external_id',
    type: 'uuid',
    default: () => 'gen_random_uuid()',
    insert: false,
    update: false,
  })
  @Generated('uuid')
  readonly externalId: string;

  @Column({ name: 'shipment_id', type: 'integer', update: false })
  readonly shipmentId: number;

  @Column({
    name: 'carrier_status',
    type: 'varchar',
    length: 255,
    nullable: true,
    update: false,
  })
  readonly carrierStatus: string | null;

  @Column({
    name: 'carrier_status_detail',
    type: 'text',
    nullable: true,
    update: false,
  })
  readonly carrierStatusDetail: string | null;

  @Column({ name: 'picked_up_on', type: 'date', nullable: true, update: false })
  readonly pickedUpOn: string | null;

  @Column({
    name: 'estimated_delivery_on',
    type: 'date',
    nullable: true,
    update: false,
  })
  readonly estimatedDeliveryOn: string | null;

  @Column({ name: 'delivered_on', type: 'date', nullable: true, update: false })
  readonly deliveredOn: string | null;

  @CreateDateColumn({
    name: 'observed_at',
    type: 'timestamptz',
    default: () => 'now()',
    update: false,
  })
  readonly observedAt: Date;
}
