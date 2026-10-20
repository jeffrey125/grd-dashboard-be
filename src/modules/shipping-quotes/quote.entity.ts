import {
  Entity,
  Generated,
  Column,
  PrimaryGeneratedColumn,
  ForeignKey,
  Unique,
  Index,
  Check,
} from 'typeorm';

@Entity('shipping_providers')
@Unique('shipping_providers_code_key', ['code'])
@Check('shipping_providers_code_check', "code IN ('amazon','unishippers')")
@Check(
  'shipping_providers_execution_mode_check',
  "execution_mode IN ('request','browser')",
)
@Check('shipping_providers_stale_hours_check', 'stale_hours > 0')
export class ShippingProvidersEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'integer',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'shipping_providers_pkey',
  })
  id: number;

  @Column({ type: 'varchar', nullable: false, length: 20 })
  code: string;

  @Column({ type: 'text', nullable: false })
  name: string;

  @Column({ type: 'boolean', nullable: false, default: () => 'true' })
  enabled: boolean;

  @Column({ type: 'boolean', nullable: false, default: () => 'false' })
  used_internationally: boolean;

  @Column({ type: 'text', nullable: true })
  maintenance_message: string | null;

  @Column({
    type: 'varchar',
    nullable: false,
    length: 10,
    default: () => "'request'",
  })
  execution_mode: string;

  @Column({ type: 'integer', nullable: false, default: 24 })
  stale_hours: number;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  updated_at: Date;
}

@Entity('shipping_accounts')
@Unique('shipping_accounts_provider_id_key', ['provider_id'])
@ForeignKey('ShippingProvidersEntity', ['provider_id'], ['id'], {
  name: 'shipping_accounts_provider_id_fkey',
  onDelete: 'NO ACTION',
})
export class ShippingAccountsEntity {
  @Column({ type: 'jsonb', nullable: true })
  default_refresh: Record<string, unknown> | null;

  @PrimaryGeneratedColumn('identity', {
    type: 'integer',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'shipping_accounts_pkey',
  })
  id: number;

  @Column({ type: 'integer', nullable: false })
  provider_id: number;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  updated_at: Date;
}

@Entity('quote_requests')
@Unique('quote_requests_external_id_key', ['external_id'])
@Unique('quote_requests_created_by_id_idempotency_key_key', [
  'created_by_id',
  'idempotency_key',
])
@Index('ix_quote_requests_history', ['created_at', 'id'], {
  where: 'deleted_at IS NULL',
})
@Index('ix_quote_requests_deleted_by', ['deleted_by_id'], {})
@Index('ix_quote_requests_restored_by', ['restored_by_id'], {})
@ForeignKey('AuthUserEntity', ['restored_by_id'], ['id'], {
  name: 'quote_requests_restored_by_id_fkey',
  onDelete: 'NO ACTION',
})
@Check(
  'quote_requests_status_check',
  "status IN ('saved','queued','running','completed','failed')",
)
@ForeignKey('AuthUserEntity', ['created_by_id'], ['id'], {
  name: 'quote_requests_created_by_id_fkey',
  onDelete: 'NO ACTION',
})
@ForeignKey('AuthUserEntity', ['deleted_by_id'], ['id'], {
  name: 'quote_requests_deleted_by_id_fkey',
  onDelete: 'NO ACTION',
})
export class QuoteRequestsEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'quote_requests_pkey',
  })
  id: string;

  @Column({ type: 'uuid', nullable: false, default: () => 'gen_random_uuid()' })
  @Generated('uuid')
  external_id: string;

  @Column({ type: 'uuid', nullable: false })
  idempotency_key: string;

  @Column({ type: 'integer', nullable: false })
  created_by_id: number;

  @Column({ type: 'jsonb', nullable: false })
  input: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: false })
  senders: Record<string, unknown>;

  @Column({
    type: 'varchar',
    nullable: false,
    length: 12,
    default: () => "'saved'",
  })
  status: string;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  deleted_by_id: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_deleted_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  restored_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  restored_by_id: number | null;
}

@Entity('quote_package_groups')
@Unique('quote_package_groups_request_id_position_key', [
  'request_id',
  'position',
])
@Check('quote_package_groups_position_check', 'position >= 0')
@Check('quote_package_groups_quantity_check', 'quantity > 0')
@Check('quote_package_groups_units_check', "units IN ('imperial','metric')")
@Check('quote_package_groups_length_value_check', 'length_value > 0')
@Check('quote_package_groups_width_value_check', 'width_value > 0')
@Check('quote_package_groups_height_value_check', 'height_value > 0')
@Check('quote_package_groups_weight_value_check', 'weight_value > 0')
@ForeignKey('QuoteRequestsEntity', ['request_id'], ['id'], {
  name: 'quote_package_groups_request_id_fkey',
  onDelete: 'NO ACTION',
})
export class QuotePackageGroupsEntity {
  @Column({ type: 'jsonb' })
  normalized: Record<string, string>;

  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'quote_package_groups_pkey',
  })
  id: string;

  @Column({ type: 'bigint', nullable: false })
  request_id: string;

  @Column({ type: 'integer', nullable: false })
  position: number;

  @Column({ type: 'integer', nullable: false })
  quantity: number;

  @Column({ type: 'varchar', nullable: false, length: 10 })
  units: string;

  @Column({ type: 'text', nullable: false })
  length_original: string;

  @Column({ type: 'text', nullable: false })
  width_original: string;

  @Column({ type: 'text', nullable: false })
  height_original: string;

  @Column({ type: 'text', nullable: false })
  weight_original: string;

  @Column({ type: 'numeric', nullable: true, precision: 15, scale: 6 })
  length_value: string | null;

  @Column({ type: 'numeric', nullable: true, precision: 15, scale: 6 })
  width_value: string | null;

  @Column({ type: 'numeric', nullable: true, precision: 15, scale: 6 })
  height_value: string | null;

  @Column({ type: 'numeric', nullable: false, precision: 15, scale: 6 })
  weight_value: string;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;
}

@Entity('quote_customs_items')
@Unique('quote_customs_items_package_group_id_position_key', [
  'package_group_id',
  'position',
])
@Check('quote_customs_items_position_check', 'position >= 0')
@Check('quote_customs_items_quantity_check', 'quantity > 0')
@Check('quote_customs_items_unit_value_check', 'unit_value > 0')
@Check('quote_customs_items_currency_check', "currency ~ '^[A-Z]{3}$'")
@Check('quote_customs_items_weight_check', 'weight > 0')
@ForeignKey('QuotePackageGroupsEntity', ['package_group_id'], ['id'], {
  name: 'quote_customs_items_package_group_id_fkey',
  onDelete: 'NO ACTION',
})
export class QuoteCustomsItemsEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'quote_customs_items_pkey',
  })
  id: string;

  @Column({ type: 'bigint', nullable: false })
  package_group_id: string;

  @Column({ type: 'integer', nullable: false })
  position: number;

  @Column({ type: 'text', nullable: false })
  description: string;

  @Column({ type: 'integer', nullable: false })
  quantity: number;

  @Column({ type: 'numeric', nullable: false, precision: 15, scale: 6 })
  unit_value: string;

  @Column({ type: 'varchar', nullable: false, length: 3 })
  currency: string;

  @Column({ type: 'varchar', nullable: false, length: 2 })
  country_of_manufacture: string;

  @Column({ type: 'numeric', nullable: false, precision: 15, scale: 6 })
  weight: string;

  @Column({ type: 'varchar', nullable: true, length: 10 })
  hs_code: string | null;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;
}

@Entity('quote_provider_attempts')
@Unique('quote_provider_attempts_external_id_key', ['external_id'])
@Index('ix_quote_attempts_request', ['request_id', 'id'], {})
@Index('ix_quote_attempts_account', ['account_id'], {})
@Index('ix_quote_attempts_queue', ['status', 'created_at'], {})
@Index(
  'uq_quote_attempts_number',
  ['request_id', 'account_id', 'attempt_number'],
  { unique: true },
)
@Index('uq_quote_attempts_active', ['request_id', 'account_id'], {
  unique: true,
  where: "status IN ('queued','running')",
})
@Index('uq_quote_attempts_running', ['account_id'], {
  unique: true,
  where: "status='running'",
})
@Check(
  'quote_provider_attempts_execution_mode_check',
  "execution_mode IN ('request','browser')",
)
@Check(
  'quote_provider_attempts_status_check',
  "status IN ('saved','queued','running','completed','failed')",
)
@Check(
  'quote_provider_attempts_recovery_count_check',
  'recovery_count BETWEEN 0 AND 1',
)
@Check('quote_attempt_number_check', 'attempt_number > 0')
@Check(
  'quote_attempt_outcome_check',
  "outcome IN ('success','validation_failed','unsupported','timeout','authentication_failed','failed')",
)
@ForeignKey('QuoteRequestsEntity', ['request_id'], ['id'], {
  name: 'quote_provider_attempts_request_id_fkey',
  onDelete: 'NO ACTION',
})
@ForeignKey('ShippingAccountsEntity', ['account_id'], ['id'], {
  name: 'quote_provider_attempts_account_id_fkey',
  onDelete: 'NO ACTION',
})
export class QuoteProviderAttemptsEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'quote_provider_attempts_pkey',
  })
  id: string;

  @Column({ type: 'uuid', nullable: false, default: () => 'gen_random_uuid()' })
  @Generated('uuid')
  external_id: string;

  @Column({ type: 'bigint', nullable: false })
  request_id: string;

  @Column({ type: 'integer', nullable: false })
  account_id: number;

  @Column({ type: 'jsonb', nullable: false })
  sender: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: false, default: {} })
  conversion_snapshot: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true, length: 10 })
  execution_mode: string | null;

  @Column({ type: 'varchar', nullable: false, length: 12 })
  status: string;

  @Column({ type: 'timestamptz', nullable: true })
  lease_until: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lease_owner: string | null;

  @Column({ type: 'integer', nullable: false, default: 1 })
  attempt_number: number;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  outcome: string | null;

  @Column({ type: 'boolean', nullable: false, default: false })
  simulated: boolean;

  @Column({ type: 'jsonb', nullable: false, default: {} })
  diagnostics: Record<string, unknown>;

  @Column({ type: 'integer', nullable: false, default: 0 })
  recovery_count: number;

  @Column({ type: 'varchar', nullable: true, length: 80 })
  reason_code: string | null;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;
}

@Entity('shipping_quotes')
@Index('ix_shipping_quotes_attempt', ['attempt_id'], {})
@Check(
  'shipping_quotes_transportation_total_check',
  'transportation_total >= 0',
)
@Check('shipping_quotes_currency_check', "currency ~ '^[A-Z]{3}$'")
@Check(
  'shipping_quotes_estimate_method_check',
  "estimate_method IN ('native','calculated')",
)
@Check(
  'shipping_quotes_option_coverage_check',
  "option_coverage IN ('included','unsupported','unverified')",
)
@Check(
  'shipping_quotes_duty_status_check',
  "duty_status IN ('included','excluded','unknown')",
)
@Check(
  'shipping_quotes_tax_status_check',
  "tax_status IN ('included','excluded','unknown')",
)
@Check(
  'shipping_quotes_clearance_status_check',
  "clearance_status IN ('included','excluded','unknown')",
)
@Check(
  'shipping_quotes_group_contributions_array_check',
  "jsonb_typeof(group_contributions) = 'array'",
)
@ForeignKey('QuoteProviderAttemptsEntity', ['attempt_id'], ['id'], {
  name: 'shipping_quotes_attempt_id_fkey',
  onDelete: 'NO ACTION',
})
export class ShippingQuotesEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'shipping_quotes_pkey',
  })
  id: string;

  @Column({ type: 'bigint', nullable: false })
  attempt_id: string;

  @Column({ type: 'text', nullable: false })
  carrier: string;

  @Column({ type: 'text', nullable: false })
  service: string;

  @Column({ type: 'numeric', nullable: false, precision: 18, scale: 6 })
  transportation_total: string;

  @Column({ type: 'varchar', nullable: false, length: 3 })
  currency: string;

  @Column({ type: 'varchar', nullable: false, length: 20 })
  estimate_method: string;

  @Column({ type: 'text', nullable: true })
  transit_description: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: false })
  retrieved_at: Date;

  @Column({ type: 'varchar', nullable: false, length: 12 })
  option_coverage: string;

  @Column({ type: 'varchar', nullable: false, length: 10 })
  duty_status: string;

  @Column({ type: 'varchar', nullable: false, length: 10 })
  tax_status: string;

  @Column({ type: 'varchar', nullable: false, length: 10 })
  clearance_status: string;

  @Column({ type: 'jsonb', nullable: false, default: [] })
  group_contributions: unknown[];

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;
}

@Entity('shipping_quote_items')
@Index('ix_quote_items_quote', ['quote_id'], {})
@Index('ix_quote_items_package', ['package_group_id'], {})
@Check(
  'shipping_quote_items_scope_check',
  "scope IN ('package','shipment','pickup')",
)
@ForeignKey('ShippingQuotesEntity', ['quote_id'], ['id'], {
  name: 'shipping_quote_items_quote_id_fkey',
  onDelete: 'NO ACTION',
})
@ForeignKey('QuotePackageGroupsEntity', ['package_group_id'], ['id'], {
  name: 'shipping_quote_items_package_group_id_fkey',
  onDelete: 'NO ACTION',
})
export class ShippingQuoteItemsEntity {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'shipping_quote_items_pkey',
  })
  id: string;

  @Column({ type: 'bigint', nullable: false })
  quote_id: string;

  @Column({ type: 'bigint', nullable: true })
  package_group_id: string | null;

  @Column({ type: 'text', nullable: false })
  description: string;

  @Column({ type: 'numeric', nullable: false, precision: 18, scale: 6 })
  amount: string;

  @Column({ type: 'varchar', nullable: false, length: 10 })
  scope: string;

  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  created_at: Date;
}
