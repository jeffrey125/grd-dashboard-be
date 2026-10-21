import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AmazonApiMode1793145600000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE shipping_providers DROP CONSTRAINT shipping_providers_execution_mode_check;
      ALTER TABLE shipping_providers ADD CONSTRAINT shipping_providers_execution_mode_check
        CHECK (execution_mode IN ('api','request','browser'));
      ALTER TABLE quote_provider_attempts DROP CONSTRAINT quote_provider_attempts_execution_mode_check;
      ALTER TABLE quote_provider_attempts ADD CONSTRAINT quote_provider_attempts_execution_mode_check
        CHECK (execution_mode IN ('api','request','browser'));
      ALTER TABLE shipping_provider_tests DROP CONSTRAINT shipping_provider_tests_mode_check;
      ALTER TABLE shipping_provider_tests ADD CONSTRAINT shipping_provider_tests_mode_check
        CHECK (mode IN ('api','request','browser'));
      UPDATE shipping_provider_tests t SET state='failed',failure_summary='readiness_failed',completed_at=clock_timestamp()
        FROM shipping_providers p WHERE t.provider_id=p.id AND p.code='amazon' AND t.state IN ('queued','running');
      UPDATE shipping_providers SET execution_mode='api',revision=revision+1,updated_at=clock_timestamp()
        WHERE code='amazon';
      UPDATE shipping_accounts a SET last_default=NULL,default_refresh=NULL
        FROM shipping_providers p WHERE a.provider_id=p.id AND p.code='amazon';
      ALTER TABLE shipping_providers DROP CONSTRAINT shipping_providers_execution_mode_check;
      ALTER TABLE shipping_providers ADD CONSTRAINT shipping_providers_execution_mode_check
        CHECK ((code='amazon' AND execution_mode='api') OR (code='unishippers' AND execution_mode IN ('request','browser')));
    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE shipping_providers DROP CONSTRAINT shipping_providers_execution_mode_check;
      ALTER TABLE quote_provider_attempts DROP CONSTRAINT quote_provider_attempts_execution_mode_check;
      ALTER TABLE shipping_provider_tests DROP CONSTRAINT shipping_provider_tests_mode_check;
      UPDATE shipping_providers SET execution_mode='request',revision=revision+1,updated_at=clock_timestamp()
        WHERE code='amazon' AND execution_mode='api';
      UPDATE quote_provider_attempts SET execution_mode='request' WHERE execution_mode='api';
      UPDATE shipping_provider_tests SET mode='request' WHERE mode='api';
      ALTER TABLE shipping_providers ADD CONSTRAINT shipping_providers_execution_mode_check
        CHECK (execution_mode IN ('request','browser'));
      ALTER TABLE quote_provider_attempts ADD CONSTRAINT quote_provider_attempts_execution_mode_check
        CHECK (execution_mode IN ('request','browser'));
      ALTER TABLE shipping_provider_tests ADD CONSTRAINT shipping_provider_tests_mode_check
        CHECK (mode IN ('request','browser'));
    `);
  }
}
