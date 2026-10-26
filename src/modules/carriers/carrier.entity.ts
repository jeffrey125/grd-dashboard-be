import { ForeignKey, Index, Check, Column, Entity, Unique } from 'typeorm';
import type { FetchMode } from './carrier-fetch-mode.js';
import { ExternallyIdentifiedEntity } from '@infrastructure/database/entities/externally-identified.entity.js';

@Entity('carriers')
@Check(
  'ck_carriers_failure_threshold',
  'failure_pause_threshold BETWEEN 1 AND 10',
)
@Check(
  'ck_carriers_session_threshold',
  'session_failure_disable_threshold BETWEEN 1 AND 10',
)
@Check('ck_carriers_session_failures', 'consecutive_session_failures >= 0')
@Check('ck_carriers_session_generation', 'session_generation >= 0')
@Check(
  'ck_carriers_disabled_reason',
  "auto_disabled_reason IS NULL OR (auto_disabled_reason = 'session_failures' AND NOT is_active)",
)
@Check('ck_carriers_fetch_mode', "fetch_mode IN ('request', 'browser')")
@Unique('uq_carriers_code', ['code'])
@Check('ck_carriers_threshold', 'not_found_pause_threshold >= 2')
@Check('ck_carriers_interval', 'poll_interval_minutes >= 1')
@Check(
  'ck_carriers_rate_limit',
  'rate_limit_per_minute IS NULL OR rate_limit_per_minute >= 1',
)
@ForeignKey('AuthUserEntity', ['createdById'], ['id'], {
  name: 'fk_carriers_created_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_carriers_created_by_id', ['createdById'])
@ForeignKey('AuthUserEntity', ['updatedById'], ['id'], {
  name: 'fk_carriers_updated_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_carriers_updated_by_id', ['updatedById'])
@ForeignKey('AuthUserEntity', ['deletedById'], ['id'], {
  name: 'fk_carriers_deleted_by_id',
  onDelete: 'NO ACTION',
})
@Index('ix_carriers_deleted_by_id', ['deletedById'])
export class CarrierEntity extends ExternallyIdentifiedEntity {
  @Column({ type: 'varchar', length: 50, update: false })
  readonly code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({
    name: 'fetch_mode',
    type: 'varchar',
    length: 10,
    default: 'request',
  })
  fetchMode: FetchMode;

  @Column({ name: 'failure_pause_enabled', type: 'boolean', default: true })
  failurePauseEnabled: boolean;

  @Column({ name: 'failure_pause_threshold', type: 'smallint', default: 2 })
  failurePauseThreshold: number;

  @Column({
    name: 'session_failure_disable_enabled',
    type: 'boolean',
    default: true,
  })
  sessionFailureDisableEnabled: boolean;

  @Column({
    name: 'session_failure_disable_threshold',
    type: 'smallint',
    default: 2,
  })
  sessionFailureDisableThreshold: number;

  @Column({ name: 'consecutive_session_failures', type: 'integer', default: 0 })
  consecutiveSessionFailures: number;

  @Column({ name: 'session_generation', type: 'integer', default: 0 })
  sessionGeneration: number;

  @Column({
    name: 'auto_disabled_reason',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  autoDisabledReason: 'session_failures' | null;

  @Column({ name: 'not_found_pause_threshold', type: 'smallint', default: 5 })
  notFoundPauseThreshold: number;

  @Column({ name: 'poll_interval_minutes', type: 'smallint' })
  pollIntervalMinutes: number;

  @Column({ name: 'rate_limit_per_minute', type: 'smallint', nullable: true })
  rateLimitPerMinute: number | null;
}
