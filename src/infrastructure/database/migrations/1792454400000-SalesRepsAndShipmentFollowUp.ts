import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SalesRepsAndShipmentFollowUp1792454400000 implements MigrationInterface {
  name = 'SalesRepsAndShipmentFollowUp1792454400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE sales_reps (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      external_id uuid NOT NULL DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz,
      created_by_id integer,
      updated_by_id integer,
      deleted_by_id integer,
      first_name varchar(100) NOT NULL,
      last_name varchar(100) NOT NULL,
      CONSTRAINT uq_sales_reps_external UNIQUE (external_id),
      CONSTRAINT ck_sales_reps_names CHECK (
        length(btrim(first_name)) > 0 AND length(btrim(last_name)) > 0
      ),
      CONSTRAINT fk_sales_reps_created_by_id FOREIGN KEY (created_by_id)
        REFERENCES auth_users(id) ON DELETE NO ACTION,
      CONSTRAINT fk_sales_reps_updated_by_id FOREIGN KEY (updated_by_id)
        REFERENCES auth_users(id) ON DELETE NO ACTION,
      CONSTRAINT fk_sales_reps_deleted_by_id FOREIGN KEY (deleted_by_id)
        REFERENCES auth_users(id) ON DELETE NO ACTION
    )`);
    await runner.query(
      'CREATE INDEX ix_sales_reps_created_by_id ON sales_reps (created_by_id)',
    );
    await runner.query(
      'CREATE INDEX ix_sales_reps_updated_by_id ON sales_reps (updated_by_id)',
    );
    await runner.query(
      'CREATE INDEX ix_sales_reps_deleted_by_id ON sales_reps (deleted_by_id)',
    );
    await runner.query(
      'CREATE INDEX ix_sales_reps_name ON sales_reps (last_name, first_name, id)',
    );

    await runner.query(`ALTER TABLE shipments
      ADD COLUMN sales_rep_id integer,
      ADD COLUMN follow_up_on date,
      ADD COLUMN record_updated_at timestamptz,
      ADD COLUMN record_updated_by_id integer,
      ADD CONSTRAINT fk_shipments_sales_rep_id FOREIGN KEY (sales_rep_id)
        REFERENCES sales_reps(id) ON DELETE NO ACTION,
      ADD CONSTRAINT fk_shipments_record_updated_by_id FOREIGN KEY (record_updated_by_id)
        REFERENCES auth_users(id) ON DELETE NO ACTION`);
    await runner.query(
      'CREATE INDEX ix_shipments_sales_rep_id ON shipments (sales_rep_id)',
    );
    await runner.query(
      'CREATE INDEX ix_shipments_record_updated_by_id ON shipments (record_updated_by_id)',
    );
    await runner.query(
      'CREATE INDEX ix_shipments_follow_up_on ON shipments (follow_up_on, id) WHERE deleted_at IS NULL',
    );

    await runner.query(`
      WITH admin_actor AS (
        SELECT id
        FROM auth_users
        WHERE role = 'admin' AND active = true
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      ), seed(first_name, last_name) AS (
        VALUES
          ('Jake', 'Wald'),
          ('Brendan', 'Laird'),
          ('Andrew', 'Henshaw'),
          ('Don', 'Schene'),
          ('Vinnie', 'Patti'),
          ('Daniel', 'Vazquez'),
          ('Ryan', 'Walsh'),
          ('Tom', 'O''Brien'),
          ('Milly', 'Drobnjak')
      )
      INSERT INTO sales_reps (first_name, last_name, created_by_id, updated_by_id)
      SELECT seed.first_name, seed.last_name, admin_actor.id, admin_actor.id
      FROM seed
      LEFT JOIN admin_actor ON TRUE
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX ix_shipments_follow_up_on');
    await runner.query('DROP INDEX ix_shipments_record_updated_by_id');
    await runner.query('DROP INDEX ix_shipments_sales_rep_id');
    await runner.query(
      'ALTER TABLE shipments DROP CONSTRAINT fk_shipments_record_updated_by_id',
    );
    await runner.query(
      'ALTER TABLE shipments DROP CONSTRAINT fk_shipments_sales_rep_id',
    );
    await runner.query(
      'ALTER TABLE shipments DROP COLUMN record_updated_by_id, DROP COLUMN record_updated_at, DROP COLUMN follow_up_on, DROP COLUMN sales_rep_id',
    );
    await runner.query('DROP INDEX ix_sales_reps_name');
    await runner.query('DROP INDEX ix_sales_reps_deleted_by_id');
    await runner.query('DROP INDEX ix_sales_reps_updated_by_id');
    await runner.query('DROP INDEX ix_sales_reps_created_by_id');
    await runner.query('DROP TABLE sales_reps');
  }
}
