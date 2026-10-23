import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderWeightLimits1793232000000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`ALTER TABLE shipping_providers ADD COLUMN max_package_weight_lb numeric(15,6);
      UPDATE shipping_providers SET max_package_weight_lb=CASE WHEN code='amazon' THEN 50 ELSE 150 END;
      ALTER TABLE shipping_providers ALTER COLUMN max_package_weight_lb SET NOT NULL;
      ALTER TABLE shipping_providers ADD CONSTRAINT shipping_providers_weight_limit_check
        CHECK (max_package_weight_lb > 0 AND max_package_weight_lb <> 'NaN'::numeric);
      ALTER TABLE quote_provider_attempts ADD COLUMN weight_policy jsonb;
      CREATE FUNCTION protect_quote_weight_policy() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (OLD.started_at IS NOT NULL OR OLD.status IN ('completed','failed'))
          AND NEW.weight_policy IS DISTINCT FROM OLD.weight_policy THEN
          RAISE EXCEPTION 'Started or completed weight policy is immutable';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER quote_weight_policy_immutable BEFORE UPDATE ON quote_provider_attempts
        FOR EACH ROW EXECUTE FUNCTION protect_quote_weight_policy();`);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(
      `DROP TRIGGER quote_weight_policy_immutable ON quote_provider_attempts;
       DROP FUNCTION protect_quote_weight_policy();
       ALTER TABLE quote_provider_attempts DROP COLUMN weight_policy;
       ALTER TABLE shipping_providers DROP COLUMN max_package_weight_lb`,
    );
  }
}
