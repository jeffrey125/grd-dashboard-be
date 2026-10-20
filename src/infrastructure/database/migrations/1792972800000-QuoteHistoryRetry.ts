import type { MigrationInterface, QueryRunner } from 'typeorm';

export class QuoteHistoryRetry1792972800000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE quote_requests ADD COLUMN restored_at timestamptz,
        ADD COLUMN last_deleted_at timestamptz,
        ADD COLUMN restored_by_id integer CONSTRAINT quote_requests_restored_by_id_fkey REFERENCES auth_users(id) ON DELETE NO ACTION;
      CREATE INDEX ix_quote_requests_restored_by ON quote_requests(restored_by_id);
      CREATE UNIQUE INDEX uq_quote_attempts_number ON quote_provider_attempts(request_id,account_id,attempt_number);
      CREATE UNIQUE INDEX uq_quote_attempts_active ON quote_provider_attempts(request_id,account_id) WHERE status IN ('queued','running');
      CREATE OR REPLACE FUNCTION protect_quote_input() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (to_jsonb(NEW) - ARRAY['status','deleted_at','deleted_by_id','restored_at','restored_by_id','last_deleted_at']) IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status','deleted_at','deleted_by_id','restored_at','restored_by_id','last_deleted_at']) THEN
          RAISE EXCEPTION 'Comparison input is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
      UPDATE quote_requests SET last_deleted_at=deleted_at WHERE deleted_at IS NOT NULL;
      CREATE FUNCTION signal_quote_lifecycle_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_notify('grd_changes', json_build_object('type','quote.changed','externalId',NEW.external_id)::text);
        RETURN NEW;
      END $$;
      CREATE TRIGGER quote_lifecycle_change AFTER UPDATE OF deleted_at,restored_at ON quote_requests
        FOR EACH ROW EXECUTE FUNCTION signal_quote_lifecycle_change();
    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(`
      DROP TRIGGER quote_lifecycle_change ON quote_requests;
      DROP FUNCTION signal_quote_lifecycle_change();
      DROP INDEX uq_quote_attempts_active;
      DROP INDEX uq_quote_attempts_number;
      DROP INDEX ix_quote_requests_restored_by;
      ALTER TABLE quote_requests DROP COLUMN restored_by_id, DROP COLUMN restored_at, DROP COLUMN last_deleted_at;
      CREATE OR REPLACE FUNCTION protect_quote_input() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (to_jsonb(NEW) - ARRAY['status','deleted_at','deleted_by_id']) IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status','deleted_at','deleted_by_id']) THEN
          RAISE EXCEPTION 'Comparison input is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
    `);
  }
}
