import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum TrackingAttemptOutcome {
  Pending = 'pending',
  Found = 'found',
  NotFound = 'not_found',
  Failed = 'failed',
  Skipped = 'skipped',
}

@Entity('tracking_attempts')
@ForeignKey('TrackingRunEntity', ['trackingRunId'], ['id'], {
  name: 'fk_attempts_run',
  onDelete: 'NO ACTION',
})
@ForeignKey('ShipmentEntity', ['shipmentId'], ['id'], {
  name: 'fk_attempts_shipment',
  onDelete: 'NO ACTION',
})
@ForeignKey(
  'ShipmentTrackingSnapshotEntity',
  ['shipmentId', 'snapshotId'],
  ['shipmentId', 'id'],
  { name: 'fk_attempts_snapshot', onDelete: 'NO ACTION' },
)
@Unique('uq_attempts_run_shipment', ['trackingRunId', 'shipmentId'])
@Index('ix_attempts_shipment_completed', { synchronize: false })
@Index('ix_attempts_shipment_started', { synchronize: false })
@Index('ix_attempts_run_outcome', ['trackingRunId', 'outcome'])
@Check(
  'ck_attempts_source_object',
  "source_data IS NULL OR jsonb_typeof(source_data) = 'object'",
)
@Check(
  'ck_attempts_completion',
  "(outcome = 'pending' AND completed_at IS NULL) OR (outcome <> 'pending' AND completed_at IS NOT NULL)",
)
@Check(
  'ck_attempts_snapshot',
  "(outcome = 'found' AND snapshot_id IS NOT NULL) OR (outcome <> 'found' AND snapshot_id IS NULL)",
)
@Check('ck_attempts_changed', "NOT snapshot_changed OR outcome = 'found'")
@Check(
  'ck_attempts_failure',
  "(outcome = 'failed' AND retryable IS NOT NULL AND reason_code IS NOT NULL) OR (outcome <> 'failed' AND retryable IS NULL)",
)
@Check('ck_attempts_skip', "outcome <> 'skipped' OR reason_code IS NOT NULL")
export class TrackingAttemptEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  readonly id: string;

  @Column({ name: 'tracking_run_id', type: 'bigint' })
  trackingRunId: string;

  @Column({ name: 'shipment_id', type: 'integer' })
  shipmentId: number;

  @Column({
    type: 'enum',
    enum: TrackingAttemptOutcome,
    enumName: 'tracking_attempt_outcome',
    default: TrackingAttemptOutcome.Pending,
  })
  outcome: TrackingAttemptOutcome;

  @Column({ name: 'snapshot_id', type: 'bigint', nullable: true })
  snapshotId: string | null;

  @Column({ name: 'snapshot_changed', type: 'boolean', default: false })
  snapshotChanged: boolean;

  @Column({ name: 'source_data', type: 'jsonb', nullable: true })
  sourceData: Record<string, unknown> | null;

  @Column({ type: 'boolean', nullable: true })
  retryable: boolean | null;

  @Column({ name: 'reason_code', type: 'varchar', length: 100, nullable: true })
  reasonCode: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @CreateDateColumn({
    name: 'started_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
