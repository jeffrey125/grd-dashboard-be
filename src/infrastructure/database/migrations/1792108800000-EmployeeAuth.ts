import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmployeeAuth1792108800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE auth_users (
id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
external_id uuid NOT NULL DEFAULT gen_random_uuid(),
name text NOT NULL,
first_name varchar(100) NOT NULL,
last_name varchar(100) NOT NULL,
email varchar(254) NOT NULL,
email_verified boolean NOT NULL DEFAULT false,
image text,
role varchar(5) NOT NULL DEFAULT 'staff',
active boolean NOT NULL DEFAULT true,
must_change_password boolean NOT NULL DEFAULT true,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
created_by_id integer,
updated_by_id integer,
CONSTRAINT fk_auth_users_creator FOREIGN KEY (created_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION,
CONSTRAINT fk_auth_users_updater FOREIGN KEY (updated_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION,
CONSTRAINT ck_auth_users_role CHECK (role IN ('admin', 'staff')),
CONSTRAINT ck_auth_users_email CHECK (email = lower(btrim(email))),
CONSTRAINT ck_auth_users_names CHECK (length(btrim(first_name)) > 0 AND length(btrim(last_name)) > 0)
)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_auth_users_external ON auth_users (external_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_auth_users_email ON auth_users (email)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_auth_users_created_by ON auth_users (created_by_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_auth_users_updated_by ON auth_users (updated_by_id)`,
    );
    await queryRunner.query(`CREATE TABLE auth_accounts (
id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
user_id integer NOT NULL,
account_id text NOT NULL,
provider_id text NOT NULL,
password text,
access_token text,
refresh_token text,
id_token text,
scope text,
access_token_expires_at timestamptz,
refresh_token_expires_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT fk_auth_accounts_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE NO ACTION
)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_auth_accounts_provider ON auth_accounts (provider_id, account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_auth_accounts_user ON auth_accounts (user_id)`,
    );
    await queryRunner.query(`CREATE TABLE auth_sessions (
id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
user_id integer NOT NULL,
token text NOT NULL,
expires_at timestamptz NOT NULL,
ip_address text,
user_agent text,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE NO ACTION
)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_auth_sessions_token ON auth_sessions (token)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_auth_sessions_user ON auth_sessions (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_auth_sessions_expires ON auth_sessions (expires_at)`,
    );
    await queryRunner.query(`CREATE TABLE auth_verifications (
id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
identifier text NOT NULL,
value text NOT NULL,
expires_at timestamptz NOT NULL,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
)`);
    await queryRunner.query(
      `CREATE INDEX ix_auth_verifications_identifier ON auth_verifications (identifier)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_auth_verifications_expires ON auth_verifications (expires_at)`,
    );
    await queryRunner.query(
      `ALTER TABLE carriers ADD CONSTRAINT fk_carriers_created_by_id FOREIGN KEY (created_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_carriers_created_by_id ON carriers (created_by_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE carriers ADD CONSTRAINT fk_carriers_updated_by_id FOREIGN KEY (updated_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_carriers_updated_by_id ON carriers (updated_by_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE carriers ADD CONSTRAINT fk_carriers_deleted_by_id FOREIGN KEY (deleted_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_carriers_deleted_by_id ON carriers (deleted_by_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE shipments ADD CONSTRAINT fk_shipments_created_by_id FOREIGN KEY (created_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_shipments_created_by_id ON shipments (created_by_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE shipments ADD CONSTRAINT fk_shipments_updated_by_id FOREIGN KEY (updated_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_shipments_updated_by_id ON shipments (updated_by_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE shipments ADD CONSTRAINT fk_shipments_deleted_by_id FOREIGN KEY (deleted_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_shipments_deleted_by_id ON shipments (deleted_by_id)`,
    );
    await queryRunner.query(
      `ALTER TABLE tracking_runs ADD CONSTRAINT fk_runs_requester FOREIGN KEY (requested_by_id) REFERENCES auth_users(id) ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_runs_requester ON tracking_runs (requested_by_id)`,
    );
    await queryRunner.query(
      `CREATE FUNCTION protect_auth_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id IS DISTINCT FROM OLD.id OR NEW.external_id IS DISTINCT FROM OLD.external_id THEN RAISE EXCEPTION 'Employee identity is immutable'; END IF; RETURN NEW; END $$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER auth_user_identity BEFORE UPDATE ON auth_users FOR EACH ROW EXECUTE FUNCTION protect_auth_user_identity()`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER auth_user_identity ON auth_users`);
    await queryRunner.query(`DROP FUNCTION protect_auth_user_identity()`);
    await queryRunner.query(`DROP INDEX ix_runs_requester`);
    await queryRunner.query(
      `ALTER TABLE tracking_runs DROP CONSTRAINT fk_runs_requester`,
    );
    await queryRunner.query(`DROP INDEX ix_carriers_created_by_id`);
    await queryRunner.query(
      `ALTER TABLE carriers DROP CONSTRAINT fk_carriers_created_by_id`,
    );
    await queryRunner.query(`DROP INDEX ix_carriers_updated_by_id`);
    await queryRunner.query(
      `ALTER TABLE carriers DROP CONSTRAINT fk_carriers_updated_by_id`,
    );
    await queryRunner.query(`DROP INDEX ix_carriers_deleted_by_id`);
    await queryRunner.query(
      `ALTER TABLE carriers DROP CONSTRAINT fk_carriers_deleted_by_id`,
    );
    await queryRunner.query(`DROP INDEX ix_shipments_created_by_id`);
    await queryRunner.query(
      `ALTER TABLE shipments DROP CONSTRAINT fk_shipments_created_by_id`,
    );
    await queryRunner.query(`DROP INDEX ix_shipments_updated_by_id`);
    await queryRunner.query(
      `ALTER TABLE shipments DROP CONSTRAINT fk_shipments_updated_by_id`,
    );
    await queryRunner.query(`DROP INDEX ix_shipments_deleted_by_id`);
    await queryRunner.query(
      `ALTER TABLE shipments DROP CONSTRAINT fk_shipments_deleted_by_id`,
    );
    await queryRunner.query(`DROP TABLE auth_verifications`);
    await queryRunner.query(`DROP TABLE auth_sessions`);
    await queryRunner.query(`DROP TABLE auth_accounts`);
    await queryRunner.query(`DROP TABLE auth_users`);
  }
}
