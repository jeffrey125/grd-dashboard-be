import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SalesRepEmails1793577600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE sales_reps ADD COLUMN email varchar(254)');

    // Full-name matches must be unambiguous; never guess from a first name alone.
    await runner.query(`
      WITH matches AS (
        SELECT lower(btrim(first_name)) AS first_name,
               lower(btrim(last_name)) AS last_name, min(email) AS email
        FROM auth_users
        GROUP BY lower(btrim(first_name)), lower(btrim(last_name))
        HAVING count(*) = 1
      )
      UPDATE sales_reps rep SET email = matches.email
      FROM matches
      WHERE lower(btrim(rep.first_name)) = matches.first_name
        AND lower(btrim(rep.last_name)) = matches.last_name
    `);

    // Approved seed addresses also work on a fresh database before accounts exist.
    await runner.query(`
      WITH approved(first_name, last_name, email) AS (
        VALUES
          ('Jake', 'Wald', 'jake@globalresourcesdirect.com'),
          ('Brendan', 'Laird', 'brendan@globalresourcesdirect.com'),
          ('Andrew', 'Henshaw', 'andrew@globalresourcesdirect.com'),
          ('Don', 'Schene', 'don@globalresourcesdirect.com'),
          ('Vinnie', 'Patti', 'vinnie@globalresourcesdirect.com'),
          ('Daniel', 'Vazquez', 'daniel@globalresourcesdirect.com'),
          ('Ryan', 'Walsh', 'ryan@globalresourcesdirect.com'),
          ('Tom', 'O''Brien', 'tom@globalresourcesdirect.com'),
          ('Milly', 'Drobnjak', 'milly@globalresourcesdirect.com')
      )
      UPDATE sales_reps rep SET email = approved.email
      FROM approved
      WHERE rep.email IS NULL
        AND lower(btrim(rep.first_name)) = lower(approved.first_name)
        AND lower(btrim(rep.last_name)) = lower(approved.last_name)
    `);

    const [unmatched] = await runner.query(
      'SELECT count(*)::text AS count FROM sales_reps WHERE email IS NULL',
    );

    if (unmatched.count !== '0')
      throw new Error(
        'Sales Rep email backfill has unmatched rows; supply verified account emails before retrying',
      );

    await runner.query(`ALTER TABLE sales_reps
      ALTER COLUMN email SET NOT NULL,
      ADD CONSTRAINT uq_sales_reps_email UNIQUE (email),
      ADD CONSTRAINT ck_sales_reps_email CHECK (
        email = lower(btrim(email)) AND length(email) > 0
      )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE sales_reps DROP CONSTRAINT uq_sales_reps_email',
    );
    await runner.query(
      'ALTER TABLE sales_reps DROP CONSTRAINT ck_sales_reps_email',
    );
    await runner.query('ALTER TABLE sales_reps DROP COLUMN email');
  }
}
