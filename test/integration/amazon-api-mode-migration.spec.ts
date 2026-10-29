import { afterAll, beforeAll, expect, it } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;

beforeAll(async () => {
  db = await shipmentDatabase();
});

afterAll(async () => {
  await db?.close();
});

it('migrates populated Amazon state to API mode without rewriting history', async () => {
  await db.source.undoLastMigration(); // Shipment business fields.
  await db.source.undoLastMigration(); // Sales Rep email.
  await db.source.undoLastMigration(); // Manual Other carrier.
  await db.source.undoLastMigration(); // Monitoring safeguards migration.
  await db.source.undoLastMigration(); // Provider weight limits migration.
  await db.source.undoLastMigration(); // Amazon API mode migration.
  const [actor] = await db.source.query(
    `INSERT INTO auth_users (name,first_name,last_name,email)
     VALUES ('Migration Admin','Migration','Admin','migration-admin@example.test') RETURNING id`,
  );
  const [provider] = await db.source.query(
    "SELECT id,revision FROM shipping_providers WHERE code='amazon'",
  );
  const [account] = await db.source.query(
    'SELECT id FROM shipping_accounts WHERE provider_id=$1',
    [provider.id],
  );
  const cached = {
    address: { name: 'Retired default' },
    retrievedAt: '2026-10-22T00:00:00.000Z',
  };
  await db.source.query(
    'UPDATE shipping_accounts SET default_refresh=$1,last_default=$2 WHERE id=$3',
    [{ state: 'succeeded', ...cached }, cached, account.id],
  );
  const [readiness] = await db.source.query(
    `INSERT INTO shipping_provider_tests
      (provider_id,actor_id,mode,revision,state,deadline)
     VALUES ($1,$2,'request',$3,'running',now()+interval '5 minutes') RETURNING id`,
    [provider.id, actor.id, provider.revision],
  );
  const [request] = await db.source.query(
    `INSERT INTO quote_requests (idempotency_key,created_by_id,input,senders,status)
     VALUES (gen_random_uuid(),$1,'{}','{}','completed') RETURNING id`,
    [actor.id],
  );
  const [attempt] = await db.source.query(
    `INSERT INTO quote_provider_attempts
      (request_id,account_id,sender,execution_mode,status,outcome,completed_at)
     VALUES ($1,$2,'{}','request','completed','success',now()) RETURNING id`,
    [request.id, account.id],
  );

  await db.source.runMigrations();

  expect(
    await db.source.query(
      "SELECT execution_mode,revision FROM shipping_providers WHERE code='amazon'",
    ),
  ).toEqual([{ execution_mode: 'api', revision: provider.revision + 1 }]);
  expect(
    await db.source.query(
      'SELECT default_refresh,last_default FROM shipping_accounts WHERE id=$1',
      [account.id],
    ),
  ).toEqual([{ default_refresh: null, last_default: null }]);
  expect(
    await db.source.query(
      'SELECT mode,state,failure_summary,completed_at IS NOT NULL AS completed FROM shipping_provider_tests WHERE id=$1',
      [readiness.id],
    ),
  ).toEqual([
    {
      mode: 'request',
      state: 'failed',
      failure_summary: 'readiness_failed',
      completed: true,
    },
  ]);
  expect(
    await db.source.query(
      'SELECT execution_mode FROM quote_provider_attempts WHERE id=$1',
      [attempt.id],
    ),
  ).toEqual([{ execution_mode: 'request' }]);
});
