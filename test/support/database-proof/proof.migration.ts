import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProofMigration1791800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE repository_proof (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      external_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      created_by_id integer,
      updated_by_id integer,
      deleted_by_id integer,
      label varchar(100) NOT NULL
    )`);
    await runner.query(`CREATE FUNCTION reject_proof_identifier_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.external_id IS DISTINCT FROM OLD.external_id THEN
          RAISE EXCEPTION 'Identifiers are immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER immutable_proof_identifiers
      BEFORE UPDATE ON repository_proof FOR EACH ROW EXECUTE FUNCTION reject_proof_identifier_update()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE repository_proof');
    await runner.query('DROP FUNCTION reject_proof_identifier_update()');
  }
}
