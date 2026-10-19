import type { MigrationInterface, QueryRunner } from 'typeorm';

export class QuoteComparisons1792540800000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      CREATE TABLE shipping_providers (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code varchar(20) NOT NULL CONSTRAINT shipping_providers_code_key UNIQUE CONSTRAINT shipping_providers_code_check CHECK (code IN ('amazon','unishippers')),
        name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        maintenance_message text,
        execution_mode varchar(10) NOT NULL DEFAULT 'request' CONSTRAINT shipping_providers_execution_mode_check CHECK (execution_mode IN ('request','browser')),
        stale_hours integer NOT NULL DEFAULT 24 CONSTRAINT shipping_providers_stale_hours_check CHECK (stale_hours > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE shipping_accounts (
        default_refresh jsonb,
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        provider_id integer NOT NULL CONSTRAINT shipping_accounts_provider_id_key UNIQUE CONSTRAINT shipping_accounts_provider_id_fkey REFERENCES shipping_providers(id) ON DELETE NO ACTION,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO shipping_providers(code,name) VALUES ('amazon','Amazon Shipping'),('unishippers','myUnishippers');
      INSERT INTO shipping_accounts(provider_id) SELECT id FROM shipping_providers;
      CREATE TABLE quote_requests (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        external_id uuid NOT NULL CONSTRAINT quote_requests_external_id_key UNIQUE DEFAULT gen_random_uuid(),
        idempotency_key uuid NOT NULL,
        created_by_id integer NOT NULL CONSTRAINT quote_requests_created_by_id_fkey REFERENCES auth_users(id) ON DELETE NO ACTION,
        input jsonb NOT NULL,
        senders jsonb NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'saved' CONSTRAINT quote_requests_status_check CHECK(status IN ('saved','queued','running','completed','failed')),
        created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by_id integer CONSTRAINT quote_requests_deleted_by_id_fkey REFERENCES auth_users(id) ON DELETE NO ACTION,
        CONSTRAINT quote_requests_created_by_id_idempotency_key_key UNIQUE(created_by_id,idempotency_key)
      );
      CREATE INDEX ix_quote_requests_history ON quote_requests(created_at DESC,id DESC) WHERE deleted_at IS NULL;
      CREATE INDEX ix_quote_requests_deleted_by ON quote_requests(deleted_by_id);
      CREATE TABLE quote_package_groups (
        normalized jsonb NOT NULL,
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_id bigint NOT NULL CONSTRAINT quote_package_groups_request_id_fkey REFERENCES quote_requests(id) ON DELETE NO ACTION,
        position integer NOT NULL CONSTRAINT quote_package_groups_position_check CHECK(position >= 0),
        quantity integer NOT NULL CONSTRAINT quote_package_groups_quantity_check CHECK(quantity > 0),
        units varchar(10) NOT NULL CONSTRAINT quote_package_groups_units_check CHECK(units IN ('imperial','metric')),
        length_original text NOT NULL,
        width_original text NOT NULL,
        height_original text NOT NULL,
        weight_original text NOT NULL,
        length_value numeric(15,6) NOT NULL CONSTRAINT quote_package_groups_length_value_check CHECK(length_value > 0),
        width_value numeric(15,6) NOT NULL CONSTRAINT quote_package_groups_width_value_check CHECK(width_value > 0),
        height_value numeric(15,6) NOT NULL CONSTRAINT quote_package_groups_height_value_check CHECK(height_value > 0),
        weight_value numeric(15,6) NOT NULL CONSTRAINT quote_package_groups_weight_value_check CHECK(weight_value > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT quote_package_groups_request_id_position_key UNIQUE(request_id,position)
      );
      CREATE TABLE quote_customs_items (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        package_group_id bigint NOT NULL CONSTRAINT quote_customs_items_package_group_id_fkey REFERENCES quote_package_groups(id) ON DELETE NO ACTION,
        position integer NOT NULL CONSTRAINT quote_customs_items_position_check CHECK(position >= 0),
        description text NOT NULL,
        quantity integer NOT NULL CONSTRAINT quote_customs_items_quantity_check CHECK(quantity > 0),
        unit_value numeric(15,6) NOT NULL CONSTRAINT quote_customs_items_unit_value_check CHECK(unit_value > 0),
        currency varchar(3) NOT NULL CONSTRAINT quote_customs_items_currency_check CHECK(currency ~ '^[A-Z]{3}$'),
        country_of_manufacture varchar(2) NOT NULL,
        weight numeric(15,6) NOT NULL CONSTRAINT quote_customs_items_weight_check CHECK(weight > 0),
        hs_code varchar(10),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT quote_customs_items_package_group_id_position_key UNIQUE(package_group_id,position)
      );
      CREATE TABLE quote_provider_attempts (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        external_id uuid NOT NULL CONSTRAINT quote_provider_attempts_external_id_key UNIQUE DEFAULT gen_random_uuid(),
        request_id bigint NOT NULL CONSTRAINT quote_provider_attempts_request_id_fkey REFERENCES quote_requests(id) ON DELETE NO ACTION,
        account_id integer NOT NULL CONSTRAINT quote_provider_attempts_account_id_fkey REFERENCES shipping_accounts(id) ON DELETE NO ACTION,
        sender jsonb NOT NULL,
        execution_mode varchar(10) NOT NULL CONSTRAINT quote_provider_attempts_execution_mode_check CHECK(execution_mode IN ('request','browser')),
        status varchar(12) NOT NULL CONSTRAINT quote_provider_attempts_status_check CHECK(status IN ('saved','queued','running','completed','failed')),
        lease_until timestamptz,
        recovery_count integer NOT NULL DEFAULT 0 CONSTRAINT quote_provider_attempts_recovery_count_check CHECK(recovery_count BETWEEN 0 AND 1),
        reason_code varchar(80),
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      CREATE INDEX ix_quote_attempts_request ON quote_provider_attempts(request_id,id);
      CREATE INDEX ix_quote_attempts_account ON quote_provider_attempts(account_id);
      CREATE INDEX ix_quote_attempts_queue ON quote_provider_attempts(status,created_at);
      CREATE UNIQUE INDEX uq_quote_attempts_running ON quote_provider_attempts(account_id) WHERE status='running';
      CREATE TABLE shipping_quotes (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        attempt_id bigint NOT NULL CONSTRAINT shipping_quotes_attempt_id_fkey REFERENCES quote_provider_attempts(id) ON DELETE NO ACTION,
        carrier text NOT NULL,
        service text NOT NULL,
        transportation_total numeric(18,6) NOT NULL CONSTRAINT shipping_quotes_transportation_total_check CHECK(transportation_total >= 0),
        currency varchar(3) NOT NULL CONSTRAINT shipping_quotes_currency_check CHECK(currency ~ '^[A-Z]{3}$'),
        estimate_method varchar(20) NOT NULL CONSTRAINT shipping_quotes_estimate_method_check CHECK(estimate_method IN ('native','calculated')),
        transit_description text,
        expires_at timestamptz,
        retrieved_at timestamptz NOT NULL,
        option_coverage varchar(12) NOT NULL CONSTRAINT shipping_quotes_option_coverage_check CHECK(option_coverage IN ('included','unsupported','unverified')),
        duty_status varchar(10) NOT NULL CONSTRAINT shipping_quotes_duty_status_check CHECK(duty_status IN ('included','excluded','unknown')),
        tax_status varchar(10) NOT NULL CONSTRAINT shipping_quotes_tax_status_check CHECK(tax_status IN ('included','excluded','unknown')),
        clearance_status varchar(10) NOT NULL CONSTRAINT shipping_quotes_clearance_status_check CHECK(clearance_status IN ('included','excluded','unknown')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_shipping_quotes_attempt ON shipping_quotes(attempt_id);
      CREATE TABLE shipping_quote_items (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        quote_id bigint NOT NULL CONSTRAINT shipping_quote_items_quote_id_fkey REFERENCES shipping_quotes(id) ON DELETE NO ACTION,
        package_group_id bigint CONSTRAINT shipping_quote_items_package_group_id_fkey REFERENCES quote_package_groups(id) ON DELETE NO ACTION,
        description text NOT NULL,
        amount numeric(18,6) NOT NULL,
        scope varchar(10) NOT NULL CONSTRAINT shipping_quote_items_scope_check CHECK(scope IN ('package','shipment','pickup')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_quote_items_quote ON shipping_quote_items(quote_id);
      CREATE INDEX ix_quote_items_package ON shipping_quote_items(package_group_id);
      CREATE FUNCTION protect_quote_input() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (to_jsonb(NEW) - ARRAY['status','deleted_at','deleted_by_id']) IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['status','deleted_at','deleted_by_id']) THEN
          RAISE EXCEPTION 'Comparison input is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER immutable_quote_input BEFORE UPDATE ON quote_requests FOR EACH ROW EXECUTE FUNCTION protect_quote_input();
      CREATE FUNCTION protect_quote_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Quote snapshot is immutable' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$;
      CREATE FUNCTION protect_quote_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ROW(NEW.id,NEW.external_id,NEW.request_id,NEW.account_id,NEW.sender,NEW.created_at) IS DISTINCT FROM
           ROW(OLD.id,OLD.external_id,OLD.request_id,OLD.account_id,OLD.sender,OLD.created_at) THEN
          RAISE EXCEPTION 'Attempt identity and sender are immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER immutable_quote_attempt BEFORE UPDATE ON quote_provider_attempts FOR EACH ROW EXECUTE FUNCTION protect_quote_attempt();
      CREATE TRIGGER immutable_quote_packages BEFORE UPDATE ON quote_package_groups FOR EACH ROW EXECUTE FUNCTION protect_quote_snapshot();
      CREATE TRIGGER immutable_quote_customs BEFORE UPDATE ON quote_customs_items FOR EACH ROW EXECUTE FUNCTION protect_quote_snapshot();
      CREATE TRIGGER immutable_shipping_quotes BEFORE UPDATE ON shipping_quotes FOR EACH ROW EXECUTE FUNCTION protect_quote_snapshot();
      CREATE TRIGGER immutable_quote_items BEFORE UPDATE ON shipping_quote_items FOR EACH ROW EXECUTE FUNCTION protect_quote_snapshot();

    `);
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query(
      'DROP TABLE shipping_quote_items, shipping_quotes, quote_provider_attempts, quote_customs_items, quote_package_groups, quote_requests, shipping_accounts, shipping_providers; DROP FUNCTION protect_quote_attempt(); DROP FUNCTION protect_quote_input(); DROP FUNCTION protect_quote_snapshot()',
    );
  }
}
