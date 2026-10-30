import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  VersionColumn,
} from 'typeorm';
import { ExternallyIdentifiedEntity } from '@infrastructure/database/entities/externally-identified.entity.js';

export enum ShipmentMonitoringStatus {
  Active = 'active',
  Paused = 'paused',
  Completed = 'completed',
}

export enum ShipmentMonitoringReason {
  Manual = 'manual',
  NotFoundThreshold = 'not_found_threshold',
  FailureThreshold = 'failure_threshold',
  Delivered = 'delivered',
}

@Entity('shipments')
@ForeignKey('CarrierEntity', ['carrierId'], ['id'], {
  name: 'fk_shipments_carrier',
  onDelete: 'NO ACTION',
})
@ForeignKey(
  'ShipmentTrackingSnapshotEntity',
  ['id', 'currentTrackingSnapshotId'],
  ['shipmentId', 'id'],
  { name: 'fk_shipments_current_snapshot', onDelete: 'NO ACTION' },
)
@Index('uq_shipments_active_reference', ['carrierId', 'trackingReference'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
@Index('ix_shipments_carrier', ['carrierId'])
@Index('ix_shipments_due', ['nextCheckAt', 'id'], {
  where: "deleted_at IS NULL AND monitoring_status = 'active'",
})
@Check('ck_shipments_failures', 'consecutive_failure_count >= 0')
@Check('ck_shipments_not_found', 'consecutive_not_found_count >= 0')
@Check('ck_shipments_version', 'lock_version >= 1')
@Check(
  'ck_shipments_monitoring',
  `((monitoring_status = 'active' AND monitoring_reason IS NULL)
  OR (monitoring_status = 'paused' AND monitoring_reason IN ('manual', 'not_found_threshold', 'failure_threshold'))
  OR (monitoring_status = 'completed' AND monitoring_reason = 'delivered')) IS TRUE`,
)
@ForeignKey('AuthUserEntity', ['createdById'], ['id'], {
  name: 'fk_shipments_created_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_shipments_created_by_id', ['createdById'])
@ForeignKey('AuthUserEntity', ['updatedById'], ['id'], {
  name: 'fk_shipments_updated_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_shipments_updated_by_id', ['updatedById'])
@ForeignKey('SalesRepEntity', ['salesRepId'], ['id'], {
  name: 'fk_shipments_sales_rep_id',
  onDelete: 'NO ACTION',
})
@Index('ix_shipments_sales_rep_id', ['salesRepId'])
@ForeignKey('AuthUserEntity', ['recordUpdatedById'], ['id'], {
  name: 'fk_shipments_record_updated_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_shipments_record_updated_by_id', ['recordUpdatedById'])
@Index('ix_shipments_follow_up_on', ['followUpOn', 'id'], {
  where: 'deleted_at IS NULL',
})
@ForeignKey('AuthUserEntity', ['deletedById'], ['id'], {
  name: 'fk_shipments_deleted_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_shipments_deleted_by_id', ['deletedById'])
export class ShipmentEntity extends ExternallyIdentifiedEntity {
  @Column({ name: 'carrier_id', type: 'integer' })
  carrierId: number;

  @Column({ name: 'tracking_reference', type: 'varchar', length: 255 })
  trackingReference: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ name: 'po_number', type: 'text', nullable: true })
  poNumber: string | null;

  @Column({
    name: 'so_numbers',
    type: 'varchar',
    length: 255,
    array: true,
    default: () => "'{}'",
  })
  soNumbers: string[];

  @Column({ type: 'varchar', length: 255, array: true, default: () => "'{}'" })
  products: string[];

  @Column({ name: 'customer', type: 'varchar', length: 255, nullable: true })
  customer: string | null;

  @Column({ name: 'vendor', type: 'varchar', length: 255, nullable: true })
  vendor: string | null;

  @Column({ name: 'sales_rep_id', type: 'integer', nullable: true })
  salesRepId: number | null;

  @Column({ name: 'follow_up_on', type: 'date', nullable: true })
  followUpOn: string | null;

  @Column({ name: 'record_updated_at', type: 'timestamptz', nullable: true })
  recordUpdatedAt: Date | null;

  @Column({ name: 'record_updated_by_id', type: 'integer', nullable: true })
  recordUpdatedById: number | null;

  @Column({ name: 'verification_url', type: 'text', nullable: true })
  verificationUrl: string | null;

  @Column({
    name: 'monitoring_status',
    type: 'enum',
    enum: ShipmentMonitoringStatus,
    enumName: 'shipment_monitoring_status',
    default: ShipmentMonitoringStatus.Active,
  })
  monitoringStatus: ShipmentMonitoringStatus;

  @Column({
    name: 'monitoring_reason',
    type: 'enum',
    enum: ShipmentMonitoringReason,
    enumName: 'shipment_monitoring_reason',
    nullable: true,
  })
  monitoringReason: ShipmentMonitoringReason | null;

  // PostgreSQL bigint values stay strings to preserve precision beyond 2^53.
  @Column({
    name: 'current_tracking_snapshot_id',
    type: 'bigint',
    nullable: true,
  })
  currentTrackingSnapshotId: string | null;

  @Column({ name: 'last_attempted_at', type: 'timestamptz', nullable: true })
  lastAttemptedAt: Date | null;

  @Column({ name: 'next_check_at', type: 'timestamptz', nullable: true })
  nextCheckAt: Date | null;

  @Column({ name: 'consecutive_not_found_count', type: 'integer', default: 0 })
  consecutiveNotFoundCount: number;

  @Column({ name: 'consecutive_failure_count', type: 'integer', default: 0 })
  consecutiveFailureCount: number;

  @VersionColumn({ name: 'lock_version', type: 'integer', default: 1 })
  lockVersion: number;
}
