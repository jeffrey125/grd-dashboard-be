import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InternationalQuoteOptions1792886400000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      ALTER TABLE shipping_providers
        ADD COLUMN used_internationally boolean NOT NULL DEFAULT false;
      UPDATE shipping_providers SET used_internationally=true WHERE code='unishippers';

      ALTER TABLE quote_provider_attempts
        ADD COLUMN conversion_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

      CREATE OR REPLACE FUNCTION protect_quote_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ROW(NEW.id,NEW.external_id,NEW.request_id,NEW.account_id,NEW.sender,NEW.conversion_snapshot,NEW.created_at) IS DISTINCT FROM
           ROW(OLD.id,OLD.external_id,OLD.request_id,OLD.account_id,OLD.sender,OLD.conversion_snapshot,OLD.created_at) THEN
          RAISE EXCEPTION 'Attempt identity, sender, and conversion snapshot are immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(`
      CREATE OR REPLACE FUNCTION protect_quote_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ROW(NEW.id,NEW.external_id,NEW.request_id,NEW.account_id,NEW.sender,NEW.created_at) IS DISTINCT FROM
           ROW(OLD.id,OLD.external_id,OLD.request_id,OLD.account_id,OLD.sender,OLD.created_at) THEN
          RAISE EXCEPTION 'Attempt identity and sender are immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;

      ALTER TABLE quote_provider_attempts DROP COLUMN conversion_snapshot;
      ALTER TABLE shipping_providers DROP COLUMN used_internationally;
    `);
  }
}
