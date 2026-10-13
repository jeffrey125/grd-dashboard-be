import { Check, Column, Entity, Unique } from 'typeorm';
import type { FetchMode } from './carrier-fetch-mode.js';
import { ExternallyIdentifiedEntity } from '@infrastructure/database/entities/externally-identified.entity.js';

@Entity('carriers')
@Check('ck_carriers_fetch_mode', "fetch_mode IN ('request', 'browser')")
@Unique('uq_carriers_code', ['code'])
@Check('ck_carriers_threshold', 'not_found_pause_threshold >= 2')
@Check('ck_carriers_interval', 'poll_interval_minutes >= 1')
@Check(
  'ck_carriers_rate_limit',
  'rate_limit_per_minute IS NULL OR rate_limit_per_minute >= 1',
)
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

  @Column({ name: 'not_found_pause_threshold', type: 'smallint', default: 5 })
  notFoundPauseThreshold: number;

  @Column({ name: 'poll_interval_minutes', type: 'smallint' })
  pollIntervalMinutes: number;

  @Column({ name: 'rate_limit_per_minute', type: 'smallint', nullable: true })
  rateLimitPerMinute: number | null;
}
