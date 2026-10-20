import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderAdministration1793059200000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE shipping_providers ADD COLUMN revision integer NOT NULL DEFAULT 0,
        ADD COLUMN updated_by_id integer CONSTRAINT shipping_providers_updated_by_id_fkey REFERENCES auth_users(id) ON DELETE NO ACTION;
      CREATE INDEX ix_shipping_providers_updated_by ON shipping_providers(updated_by_id);
      ALTER TABLE shipping_providers ALTER COLUMN stale_hours SET DEFAULT 1;
      UPDATE shipping_providers SET stale_hours=1 WHERE stale_hours=24;
      UPDATE shipping_providers SET stale_hours=168 WHERE stale_hours>168;
      ALTER TABLE shipping_providers DROP CONSTRAINT shipping_providers_stale_hours_check;
      ALTER TABLE shipping_providers ADD CONSTRAINT shipping_providers_stale_hours_check CHECK (stale_hours BETWEEN 1 AND 168);
      ALTER TABLE shipping_accounts ADD COLUMN last_default jsonb;
      UPDATE shipping_accounts SET last_default=jsonb_build_object('address',default_refresh->'address','retrievedAt',default_refresh->'retrievedAt')
        WHERE default_refresh->>'state'='succeeded';
      CREATE TABLE shipping_provider_tests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id integer NOT NULL CONSTRAINT shipping_provider_tests_provider_id_fkey REFERENCES shipping_providers(id) ON DELETE NO ACTION,
        actor_id integer NOT NULL CONSTRAINT shipping_provider_tests_actor_id_fkey REFERENCES auth_users(id) ON DELETE NO ACTION,
        mode varchar(10) NOT NULL CONSTRAINT shipping_provider_tests_mode_check CHECK (mode IN ('request','browser')),
        revision integer NOT NULL,
        state varchar(10) NOT NULL DEFAULT 'queued' CONSTRAINT shipping_provider_tests_state_check CHECK (state IN ('queued','running','succeeded','failed')),
        failure_summary varchar(30) CONSTRAINT shipping_provider_tests_failure_check CHECK (failure_summary IN ('readiness_failed','readiness_timeout')),
        created_at timestamptz NOT NULL DEFAULT now(),
        deadline timestamptz NOT NULL,
        completed_at timestamptz,
        consumed_at timestamptz
      );
      CREATE INDEX ix_shipping_provider_tests_provider ON shipping_provider_tests(provider_id);
      CREATE INDEX ix_shipping_provider_tests_actor ON shipping_provider_tests(actor_id);
      CREATE UNIQUE INDEX uq_shipping_provider_tests_pending ON shipping_provider_tests(provider_id) WHERE state IN ('queued','running');
    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(`
      DROP TABLE shipping_provider_tests;
      ALTER TABLE shipping_accounts DROP COLUMN last_default;
      DROP INDEX ix_shipping_providers_updated_by;
      ALTER TABLE shipping_providers DROP COLUMN updated_by_id,DROP COLUMN revision;
      ALTER TABLE shipping_providers DROP CONSTRAINT shipping_providers_stale_hours_check;
      ALTER TABLE shipping_providers ADD CONSTRAINT shipping_providers_stale_hours_check CHECK (stale_hours>0);
      ALTER TABLE shipping_providers ALTER COLUMN stale_hours SET DEFAULT 24;
    `);
  }
}
