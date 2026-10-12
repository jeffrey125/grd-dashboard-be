import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TrackingRunTrigger {
  Scheduled = 'scheduled',
  Manual = 'manual',
}

export enum TrackingRunStatus {
  Queued = 'queued',
  Running = 'running',
  Succeeded = 'succeeded',
  PartiallySucceeded = 'partially_succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

@Entity('tracking_runs')
@ForeignKey('CarrierEntity', ['carrierId'], ['id'], {
  name: 'fk_runs_carrier',
  onDelete: 'NO ACTION',
})
@Index('ix_runs_carrier_created', { synchronize: false })
@Index('ix_runs_status_created', ['status', 'createdAt'])
@Check(
  'ck_runs_timestamps',
  `(status = 'queued' AND started_at IS NULL AND completed_at IS NULL)
  OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
  OR (status IN ('succeeded', 'partially_succeeded', 'failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL)
  OR (status = 'cancelled' AND completed_at IS NOT NULL)`,
)
export class TrackingRunEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  readonly id: string;

  @Column({
    name: 'external_id',
    type: 'uuid',
    unique: true,
    default: () => 'gen_random_uuid()',
    insert: false,
    update: false,
  })
  @Generated('uuid')
  readonly externalId: string;

  @Column({ name: 'carrier_id', type: 'integer' })
  carrierId: number;

  @Column({
    type: 'enum',
    enum: TrackingRunTrigger,
    enumName: 'tracking_run_trigger',
  })
  trigger: TrackingRunTrigger;

  @Column({
    type: 'enum',
    enum: TrackingRunStatus,
    enumName: 'tracking_run_status',
    default: TrackingRunStatus.Queued,
  })
  status: TrackingRunStatus;

  @Column({ name: 'reason_code', type: 'varchar', length: 100, nullable: true })
  reasonCode: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ name: 'requested_by_id', type: 'integer', nullable: true })
  requestedById: number | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  updatedAt: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
