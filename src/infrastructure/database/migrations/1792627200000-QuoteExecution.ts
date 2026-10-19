import type { MigrationInterface, QueryRunner } from 'typeorm';

export class QuoteExecution1792627200000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE quote_provider_attempts
        ALTER COLUMN execution_mode DROP NOT NULL,
        ADD COLUMN lease_owner uuid,
        ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CONSTRAINT quote_attempt_number_check CHECK (attempt_number > 0),
        ADD COLUMN started_at timestamptz,
        ADD COLUMN outcome varchar(30) CONSTRAINT quote_attempt_outcome_check CHECK (outcome IN ('success','validation_failed','unsupported','timeout','authentication_failed','failed')),
        ADD COLUMN simulated boolean NOT NULL DEFAULT false,
        ADD COLUMN diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;
      CREATE FUNCTION signal_quote_change() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE comparison_id uuid;
      BEGIN
        SELECT external_id INTO comparison_id FROM quote_requests WHERE id=NEW.request_id;
        PERFORM pg_notify('grd_changes', json_build_object('type','quote.changed','externalId',comparison_id)::text);
        RETURN NEW;
      END $$;
      CREATE TRIGGER quote_attempt_change AFTER INSERT OR UPDATE ON quote_provider_attempts
        FOR EACH ROW EXECUTE FUNCTION signal_quote_change();
    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(`
      DROP TRIGGER quote_attempt_change ON quote_provider_attempts;
      DROP FUNCTION signal_quote_change();
      UPDATE quote_provider_attempts a SET execution_mode=p.execution_mode
        FROM shipping_accounts s JOIN shipping_providers p ON p.id=s.provider_id
        WHERE a.account_id=s.id AND a.execution_mode IS NULL;
      ALTER TABLE quote_provider_attempts ALTER COLUMN execution_mode SET NOT NULL,
        DROP COLUMN lease_owner, DROP COLUMN attempt_number, DROP COLUMN started_at,
        DROP COLUMN outcome, DROP COLUMN simulated, DROP COLUMN diagnostics;
    `);
  }
}
