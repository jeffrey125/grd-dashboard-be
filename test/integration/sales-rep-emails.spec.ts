import { afterAll, beforeAll, expect, it } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;

beforeAll(async () => {
  db = await shipmentDatabase();
});

afterAll(async () => {
  await db?.close();
});

it('backfills all nine approved emails on a fresh database', async () => {
  const rows = await db.source.query(
    'SELECT first_name, email FROM sales_reps ORDER BY first_name',
  );

  expect(rows).toEqual(
    [
      'Andrew',
      'Brendan',
      'Daniel',
      'Don',
      'Jake',
      'Milly',
      'Ryan',
      'Tom',
      'Vinnie',
    ].map((first_name) => ({
      first_name,
      email: `${first_name.toLowerCase()}@globalresourcesdirect.com`,
    })),
  );
});

it('enforces required normalized email without a fabricated default', async () => {
  for (const email of [
    null,
    '',
    'UPPER@example.test',
    ' padded@example.test ',
  ]) {
    await expect(
      db.source.query(
        'INSERT INTO sales_reps (first_name,last_name,email) VALUES ($1,$2,$3)',
        ['Missing', 'Email', email],
      ),
    ).rejects.toThrow();
  }
});

it('rolls back unmatched data and safely retries with a unique full-name account match', async () => {
  await db.source.undoLastMigration(); // Shipment order details.
  await db.source.undoLastMigration(); // Shipment business fields.
  await db.source.undoLastMigration(); // Sales Rep email.
  await db.source.query(
    "INSERT INTO sales_reps(first_name,last_name,deleted_at) VALUES ('Extra','Representative',now())",
  );

  await expect(db.source.runMigrations()).rejects.toThrow('unmatched rows');
  expect(
    await db.source.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='sales_reps' AND column_name='email'",
    ),
  ).toEqual([]);
  await db.source.query(`INSERT INTO auth_users(name,first_name,last_name,email)
    VALUES ('Extra Representative','Extra','Representative','verified@example.test')`);
  await db.source.runMigrations();

  expect(
    await db.source.query(
      "SELECT email,deleted_at IS NOT NULL AS inactive FROM sales_reps WHERE first_name='Extra'",
    ),
  ).toEqual([{ email: 'verified@example.test', inactive: true }]);

  await db.source.undoLastMigration(); // Shipment order details.
  await db.source.undoLastMigration(); // Shipment business fields.
  await db.source.undoLastMigration(); // Sales Rep email.
  expect(
    await db.source.query('SELECT count(*)::int AS count FROM sales_reps'),
  ).toEqual([{ count: 10 }]);
  await db.source.runMigrations();
});

it('rejects duplicate emails on insert and update, including inactive reps', async () => {
  await expect(
    db.source.query(
      "INSERT INTO sales_reps(first_name,last_name,email) VALUES ('Duplicate','Jake','jake@globalresourcesdirect.com')",
    ),
  ).rejects.toMatchObject({
    driverError: { code: '23505', constraint: 'uq_sales_reps_email' },
  });
  await expect(
    db.source.query(
      "UPDATE sales_reps SET email='jake@globalresourcesdirect.com' WHERE first_name='Milly'",
    ),
  ).rejects.toMatchObject({
    driverError: { code: '23505', constraint: 'uq_sales_reps_email' },
  });
  await expect(
    db.source.query(
      "INSERT INTO sales_reps(first_name,last_name,email) VALUES ('Duplicate','Inactive','verified@example.test')",
    ),
  ).rejects.toMatchObject({
    driverError: { code: '23505', constraint: 'uq_sales_reps_email' },
  });
});
