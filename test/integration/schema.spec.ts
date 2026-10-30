import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import {
  postgresqlEnvironment,
  startPostgresqlContainer,
} from '@test/support/postgresql-container.js';

describe('initial application schema', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let source: DataSource;

  async function history() {
    const [carrier] = await source.query(
      `INSERT INTO carriers (code, name, poll_interval_minutes)
      VALUES ($1, 'Test Carrier', 5) RETURNING *`,
      [randomUUID()],
    );
    const [shipment] = await source.query(
      `INSERT INTO shipments (carrier_id, tracking_reference)
      VALUES ($1, $2) RETURNING *`,
      [carrier.id, randomUUID()],
    );
    const [snapshot] = await source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status)
      VALUES ($1, 'Moving') RETURNING *`,
      [shipment.id],
    );
    const [run] = await source.query(
      `INSERT INTO tracking_runs (carrier_id, trigger)
      VALUES ($1, 'manual') RETURNING *`,
      [carrier.id],
    );
    const [attempt] = await source.query(
      `INSERT INTO tracking_attempts (tracking_run_id, shipment_id)
      VALUES ($1, $2) RETURNING *`,
      [run.id, shipment.id],
    );

    return { carrier, shipment, snapshot, run, attempt };
  }

  beforeAll(async () => {
    container = await startPostgresqlContainer();
    source = new DataSource({
      ...createDatabaseOptions(
        createConfiguration(postgresqlEnvironment(container)),
      ),
      entities: [join(process.cwd(), 'dist/modules/**/*.entity.js')],
      migrations: [
        join(process.cwd(), 'dist/infrastructure/database/migrations/*.js'),
      ],
    });
    await source.initialize();
    await source.runMigrations();
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();

    await container?.stop();
  });

  it('seeds automated carriers and the manual Other carrier', async () => {
    expect(
      await source.query(`SELECT code, name, is_active, poll_interval_minutes,
      not_found_pause_threshold, rate_limit_per_minute FROM carriers ORDER BY code`),
    ).toEqual([
      {
        code: 'echoship',
        name: 'EchoShip',
        is_active: true,
        poll_interval_minutes: 5,
        not_found_pause_threshold: 5,
        rate_limit_per_minute: null,
      },
      {
        code: 'ffe',
        name: 'FFE',
        is_active: true,
        poll_interval_minutes: 5,
        not_found_pause_threshold: 5,
        rate_limit_per_minute: null,
      },
      {
        code: 'other',
        name: 'Other',
        is_active: true,
        poll_interval_minutes: 30,
        not_found_pause_threshold: 5,
        rate_limit_per_minute: null,
      },
      {
        code: 'ups',
        name: 'UPS',
        is_active: true,
        poll_interval_minutes: 30,
        not_found_pause_threshold: 5,
        rate_limit_per_minute: 10,
      },
    ]);
  });

  it('seeds the approved Sales Reps as active, independently named rows', async () => {
    expect(
      await source.query(
        `SELECT first_name, last_name, deleted_at FROM sales_reps ORDER BY id`,
      ),
    ).toEqual([
      { first_name: 'Jake', last_name: 'Wald', deleted_at: null },
      { first_name: 'Brendan', last_name: 'Laird', deleted_at: null },
      { first_name: 'Andrew', last_name: 'Henshaw', deleted_at: null },
      { first_name: 'Don', last_name: 'Schene', deleted_at: null },
      { first_name: 'Vinnie', last_name: 'Patti', deleted_at: null },
      { first_name: 'Daniel', last_name: 'Vazquez', deleted_at: null },
      { first_name: 'Ryan', last_name: 'Walsh', deleted_at: null },
      { first_name: 'Tom', last_name: "O'Brien", deleted_at: null },
      { first_name: 'Milly', last_name: 'Drobnjak', deleted_at: null },
    ]);
  });

  it('persists an ownership-safe tracking history with generated IDs and defaults', async () => {
    const [shipment] =
      await source.query(`INSERT INTO shipments (carrier_id, tracking_reference)
      SELECT id, 'initial-history' FROM carriers WHERE code = 'ups' RETURNING *`);

    expect(shipment).toMatchObject({
      monitoring_status: 'active',
      monitoring_reason: null,
      consecutive_not_found_count: 0,
      lock_version: 1,
      current_tracking_snapshot_id: null,
    });
    expect(shipment.external_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const [snapshot] = await source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status)
      VALUES ($1, 'In transit') RETURNING *`,
      [shipment.id],
    );

    expect(typeof snapshot.id).toBe('string');

    await source.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [snapshot.id, shipment.id],
    );

    const [run] = await source.query(
      `INSERT INTO tracking_runs (carrier_id, trigger)
      VALUES ($1, 'manual') RETURNING *`,
      [shipment.carrier_id],
    );

    expect(run).toMatchObject({
      status: 'queued',
      started_at: null,
      completed_at: null,
    });
    expect(typeof run.id).toBe('string');

    const [attempt] = await source.query(
      `INSERT INTO tracking_attempts (tracking_run_id, shipment_id)
      VALUES ($1, $2) RETURNING *`,
      [run.id, shipment.id],
    );

    expect(attempt).toMatchObject({
      outcome: 'pending',
      snapshot_id: null,
      snapshot_changed: false,
      completed_at: null,
      retryable: null,
      source_data: null,
    });
    expect(typeof attempt.id).toBe('string');

    await source.query(
      `UPDATE tracking_attempts SET outcome = 'found', snapshot_id = $1,
      completed_at = now(), snapshot_changed = true WHERE id = $2`,
      [snapshot.id, attempt.id],
    );
  });

  it('maps all production entities without schema drift', async () => {
    expect(
      source.entityMetadatas.map((metadata) => metadata.tableName).sort(),
    ).toEqual([
      'auth_accounts',
      'auth_sessions',
      'auth_users',
      'auth_verifications',
      'carriers',
      'purchase_orders',
      'quote_customs_items',
      'quote_package_groups',
      'quote_provider_attempts',
      'quote_requests',
      'sales_reps',
      'shipment_purchase_orders',
      'shipment_tracking_snapshots',
      'shipments',
      'shipping_accounts',
      'shipping_provider_tests',
      'shipping_providers',
      'shipping_quote_items',
      'shipping_quotes',
      'tracking_attempts',
      'tracking_runs',
    ]);

    const changes = await source.driver.createSchemaBuilder().log();

    expect(changes.upQueries.map((query) => query.query)).toEqual([]);
    expect(changes.downQueries).toEqual([]);
  });

  it('rejects identifier changes on every table, including identity resets', async () => {
    const { carrier, shipment, snapshot, run, attempt } = await history();

    for (const [table, row] of [
      ['carriers', carrier],
      ['shipments', shipment],
      ['shipment_tracking_snapshots', snapshot],
      ['tracking_runs', run],
      ['tracking_attempts', attempt],
    ] as const) {
      await expect(
        source.query(`INSERT INTO ${table} (id) VALUES (999999)`),
      ).rejects.toMatchObject({ driverError: { code: '428C9' } });
      await expect(
        source.query(`UPDATE ${table} SET id = DEFAULT WHERE id = $1`, [
          row.id,
        ]),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
      await expect(
        source.query(`UPDATE ${table} SET id = 999999 WHERE id = $1`, [row.id]),
      ).rejects.toMatchObject({ driverError: { code: '428C9' } });

      if ('external_id' in row) {
        await expect(
          source.query(
            `UPDATE ${table} SET external_id = gen_random_uuid() WHERE id = $1`,
            [row.id],
          ),
        ).rejects.toMatchObject({ driverError: { code: '23514' } });
        await source.query(
          `UPDATE ${table} SET external_id = external_id WHERE id = $1`,
          [row.id],
        );
      }
    }
  });

  it('rejects changes to snapshot facts, ownership, and observation time', async () => {
    const { snapshot } = await history();
    const other = await history();

    for (const [column, value] of [
      ['carrier_status', 'Delivered'],
      ['carrier_status_detail', 'Different'],
      ['picked_up_on', '2026-10-01'],
      ['estimated_delivery_on', '2026-10-02'],
      ['delivered_on', '2026-10-03'],
      ['observed_at', '2026-10-04T00:00:00Z'],
      ['shipment_id', other.shipment.id],
    ]) {
      await expect(
        source.query(
          `UPDATE shipment_tracking_snapshots SET ${column} = $1 WHERE id = $2`,
          [value, snapshot.id],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }

    await source.query(
      'UPDATE shipment_tracking_snapshots SET carrier_status = carrier_status WHERE id = $1',
      [snapshot.id],
    );
  });

  it('rejects active duplicate references concurrently and allows re-add after soft deletion', async () => {
    const { carrier } = await history();
    const insert = () =>
      source.query(
        `INSERT INTO shipments (carrier_id, tracking_reference) VALUES ($1, 'duplicate') RETURNING id`,
        [carrier.id],
      );
    const results = await Promise.allSettled([insert(), insert()]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { driverError: { code: '23505' } } });

    await source.query(
      `UPDATE shipments SET deleted_at = now() WHERE carrier_id = $1 AND tracking_reference = 'duplicate'`,
      [carrier.id],
    );
    await expect(insert()).resolves.toHaveLength(1);

    expect(
      await source.query(
        `SELECT count(*)::integer AS count FROM shipments WHERE carrier_id = $1 AND tracking_reference = 'duplicate'`,
        [carrier.id],
      ),
    ).toEqual([{ count: 2 }]);

    await expect(
      source.query(
        `UPDATE shipments SET deleted_at = NULL WHERE carrier_id = $1 AND tracking_reference = 'duplicate'`,
        [carrier.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('keeps Carrier codes and public UUIDs unique even after soft deletion', async () => {
    const { carrier, shipment, run } = await history();

    await source.query('UPDATE carriers SET deleted_at = now() WHERE id = $1', [
      carrier.id,
    ]);
    await source.query(
      'UPDATE shipments SET deleted_at = now() WHERE id = $1',
      [shipment.id],
    );

    const cases = [
      [
        `INSERT INTO carriers (code, name, poll_interval_minutes) VALUES ($1, 'Duplicate', 5)`,
        [carrier.code],
      ],
      [
        `INSERT INTO carriers (external_id, code, name, poll_interval_minutes) VALUES ($1, $2, 'Duplicate', 5)`,
        [carrier.external_id, randomUUID()],
      ],
      [
        `INSERT INTO shipments (external_id, carrier_id, tracking_reference) VALUES ($1, $2, 'other')`,
        [shipment.external_id, carrier.id],
      ],
      [
        `INSERT INTO tracking_runs (external_id, carrier_id, trigger) VALUES ($1, $2, 'scheduled')`,
        [run.external_id, carrier.id],
      ],
    ] as const;

    for (const [sql, parameters] of cases) {
      await expect(source.query(sql, [...parameters])).rejects.toMatchObject({
        driverError: { code: '23505' },
      });
    }
  });

  it('protects snapshot ownership from both Shipments and found attempts', async () => {
    const first = await history();
    const second = await history();

    await expect(
      source.query(
        'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
        [second.snapshot.id, first.shipment.id],
      ),
    ).rejects.toMatchObject({
      driverError: {
        code: '23503',
        constraint: 'fk_shipments_current_snapshot',
      },
    });
    await expect(
      source.query(
        `UPDATE tracking_attempts SET outcome = 'found', snapshot_id = $1, completed_at = now() WHERE id = $2`,
        [second.snapshot.id, first.attempt.id],
      ),
    ).rejects.toMatchObject({
      driverError: { code: '23503', constraint: 'fk_attempts_snapshot' },
    });
    await source.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [first.snapshot.id, first.shipment.id],
    );
    await source.query(
      `UPDATE tracking_attempts SET outcome = 'found', snapshot_id = $1, completed_at = now() WHERE id = $2`,
      [first.snapshot.id, first.attempt.id],
    );
  });

  it('blocks parent deletion and permits explicit ordered cleanup in one transaction', async () => {
    const { carrier, shipment, snapshot, run, attempt } = await history();

    await source.query(
      'UPDATE shipments SET current_tracking_snapshot_id = $1 WHERE id = $2',
      [snapshot.id, shipment.id],
    );
    await source.query(
      `UPDATE tracking_attempts SET outcome = 'found', snapshot_id = $1, completed_at = now() WHERE id = $2`,
      [snapshot.id, attempt.id],
    );

    for (const [table, id] of [
      ['carriers', carrier.id],
      ['shipments', shipment.id],
      ['tracking_runs', run.id],
      ['shipment_tracking_snapshots', snapshot.id],
    ]) {
      await expect(
        source.query(`DELETE FROM ${table} WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ driverError: { code: '23503' } });
    }

    await source.query(
      'UPDATE shipments SET deleted_at = now() WHERE id = $1',
      [shipment.id],
    );

    expect(
      await source.query(
        'SELECT id FROM shipment_tracking_snapshots WHERE id = $1',
        [snapshot.id],
      ),
    ).toHaveLength(1);
    expect(
      await source.query('SELECT id FROM tracking_attempts WHERE id = $1', [
        attempt.id,
      ]),
    ).toHaveLength(1);

    await source.transaction(async (manager) => {
      await manager.query(
        'UPDATE shipments SET current_tracking_snapshot_id = NULL WHERE id = $1',
        [shipment.id],
      );
      await manager.query(
        'DELETE FROM tracking_attempts WHERE shipment_id = $1',
        [shipment.id],
      );
      await manager.query(
        'DELETE FROM shipment_tracking_snapshots WHERE shipment_id = $1',
        [shipment.id],
      );
      await manager.query('DELETE FROM shipments WHERE id = $1', [shipment.id]);
      await manager.query('DELETE FROM tracking_runs WHERE id = $1', [run.id]);
      await manager.query('DELETE FROM carriers WHERE id = $1', [carrier.id]);
    });

    for (const [table, id] of [
      ['carriers', carrier.id],
      ['shipments', shipment.id],
      ['tracking_runs', run.id],
      ['shipment_tracking_snapshots', snapshot.id],
      ['tracking_attempts', attempt.id],
    ]) {
      expect(
        await source.query(`SELECT id FROM ${table} WHERE id = $1`, [id]),
      ).toEqual([]);
    }
  });

  it('enforces Carrier configuration bounds and varchar limits', async () => {
    const { carrier, shipment } = await history();

    for (const column of [
      'not_found_pause_threshold',
      'poll_interval_minutes',
      'rate_limit_per_minute',
    ]) {
      await expect(
        source.query(`UPDATE carriers SET ${column} = 0 WHERE id = $1`, [
          carrier.id,
        ]),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }

    await expect(
      source.query(
        'UPDATE carriers SET not_found_pause_threshold = 1 WHERE id = $1',
        [carrier.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await source.query(
      'UPDATE carriers SET not_found_pause_threshold = 2, poll_interval_minutes = 1, rate_limit_per_minute = 1 WHERE id = $1',
      [carrier.id],
    );
    await source.query(
      'UPDATE carriers SET rate_limit_per_minute = NULL WHERE id = $1',
      [carrier.id],
    );

    for (const [table, id, column, length] of [
      ['carriers', carrier.id, 'code', 51],
      ['carriers', carrier.id, 'name', 101],
      ['shipments', shipment.id, 'tracking_reference', 256],
      ['shipments', shipment.id, 'notes', 501],
    ] as const) {
      await expect(
        source.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [
          'x'.repeat(length),
          id,
        ]),
      ).rejects.toMatchObject({ driverError: { code: '22001' } });
    }
  });

  it('accepts exactly the documented monitoring state/reason combinations', async () => {
    const { shipment } = await history();

    for (const status of ['active', 'paused', 'completed']) {
      for (const reason of [
        null,
        'manual',
        'not_found_threshold',
        'delivered',
      ]) {
        const valid =
          (status === 'active' && reason === null) ||
          (status === 'paused' &&
            (reason === 'manual' || reason === 'not_found_threshold')) ||
          (status === 'completed' && reason === 'delivered');
        const update = source.query(
          'UPDATE shipments SET monitoring_status = $1, monitoring_reason = $2 WHERE id = $3',
          [status, reason, shipment.id],
        );

        if (valid) await update;
        else
          await expect(update).rejects.toMatchObject({
            driverError: { code: '23514' },
          });
      }
    }

    for (const [column, value] of [
      ['consecutive_not_found_count', -1],
      ['lock_version', 0],
    ]) {
      await expect(
        source.query(`UPDATE shipments SET ${column} = $1 WHERE id = $2`, [
          value,
          shipment.id,
        ]),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }
  });

  it('requires snapshot facts and accepts each individual tracking field', async () => {
    const { shipment } = await history();

    await expect(
      source.query(
        'INSERT INTO shipment_tracking_snapshots (shipment_id) VALUES ($1)',
        [shipment.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });

    for (const [column, value] of [
      ['carrier_status', 'Moving'],
      ['carrier_status_detail', 'At terminal'],
      ['picked_up_on', '2026-10-01'],
      ['estimated_delivery_on', '2026-10-02'],
      ['delivered_on', '2026-10-03'],
    ]) {
      await source.query(
        `INSERT INTO shipment_tracking_snapshots (shipment_id, ${column}) VALUES ($1, $2)`,
        [shipment.id, value],
      );
    }

    await expect(
      source.query(
        'INSERT INTO shipment_tracking_snapshots (shipment_id, delivered_on) VALUES ($1, $2)',
        [shipment.id, '2026-02-30'],
      ),
    ).rejects.toMatchObject({ driverError: { code: '22008' } });
  });

  it('enforces every run status/timestamp combination', async () => {
    const { run } = await history();

    for (const status of [
      'queued',
      'running',
      'succeeded',
      'partially_succeeded',
      'failed',
      'cancelled',
    ]) {
      for (const started of [null, '2026-10-01T00:00:00Z']) {
        for (const completed of [null, '2026-10-01T00:01:00Z']) {
          const valid =
            status === 'queued'
              ? started === null && completed === null
              : status === 'running'
                ? started !== null && completed === null
                : status === 'cancelled'
                  ? completed !== null
                  : started !== null && completed !== null;
          const update = source.query(
            'UPDATE tracking_runs SET status = $1, started_at = $2, completed_at = $3 WHERE id = $4',
            [status, started, completed, run.id],
          );

          if (valid) await update;
          else
            await expect(update).rejects.toMatchObject({
              driverError: { code: '23514' },
            });
        }
      }
    }
  });

  it('enforces attempt completion, snapshot, failure, skip, source-data, and uniqueness rules', async () => {
    const { run, shipment, attempt, snapshot } = await history();

    await expect(
      source.query(
        'INSERT INTO tracking_attempts (tracking_run_id, shipment_id) VALUES ($1, $2)',
        [run.id, shipment.id],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });

    for (const invalid of [
      'completed_at = now()',
      'snapshot_id = ' + snapshot.id,
      'snapshot_changed = true',
      'retryable = false',
      "outcome = 'not_found'",
      "outcome = 'found', completed_at = now()",
      "outcome = 'failed', completed_at = now(), reason_code = 'TIMEOUT'",
      "outcome = 'failed', completed_at = now(), retryable = true",
      "outcome = 'skipped', completed_at = now()",
    ]) {
      await expect(
        source.query(`UPDATE tracking_attempts SET ${invalid} WHERE id = $1`, [
          attempt.id,
        ]),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }

    for (const value of ['[]', 'null', '"text"', '1', 'true']) {
      await expect(
        source.query(
          'UPDATE tracking_attempts SET source_data = $1::jsonb WHERE id = $2',
          [value, attempt.id],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }

    await source.query(
      'UPDATE tracking_attempts SET source_data = $1::jsonb WHERE id = $2',
      ['{"statusText":"Moving"}', attempt.id],
    );

    for (const valid of [
      "outcome = 'not_found', completed_at = now(), snapshot_id = NULL, snapshot_changed = false, retryable = NULL, reason_code = NULL",
      "outcome = 'failed', retryable = false, reason_code = 'TIMEOUT'",
      "outcome = 'skipped', retryable = NULL, reason_code = 'DISABLED'",
      "outcome = 'found', snapshot_id = " +
        snapshot.id +
        ', snapshot_changed = true, reason_code = NULL',
      'snapshot_changed = false',
    ])
      await source.query(
        `UPDATE tracking_attempts SET ${valid} WHERE id = $1`,
        [attempt.id],
      );

    for (const outcome of ['pending', 'not_found', 'failed', 'skipped']) {
      await expect(
        source.query(
          'UPDATE tracking_attempts SET outcome = $1 WHERE id = $2',
          [outcome, attempt.id],
        ),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    }
  });

  it('rejects unknown values for every database enum', async () => {
    const { shipment, run, attempt } = await history();

    for (const [table, id, column] of [
      ['shipments', shipment.id, 'monitoring_status'],
      ['shipments', shipment.id, 'monitoring_reason'],
      ['tracking_runs', run.id, 'trigger'],
      ['tracking_runs', run.id, 'status'],
      ['tracking_attempts', attempt.id, 'outcome'],
    ]) {
      await expect(
        source.query(
          `UPDATE ${table} SET ${column} = 'invalid' WHERE id = $1`,
          [id],
        ),
      ).rejects.toMatchObject({ driverError: { code: '22P02' } });
    }
  });

  it('uses only NO ACTION foreign keys and the exact scheduler/history indexes', async () => {
    const foreignKeys =
      await source.query(`SELECT conname, confdeltype, confupdtype, condeferrable
      FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY conname`);

    expect(foreignKeys).toEqual(
      [
        'quote_customs_items_package_group_id_fkey',
        'quote_package_groups_request_id_fkey',
        'quote_provider_attempts_account_id_fkey',
        'quote_provider_attempts_request_id_fkey',
        'quote_requests_created_by_id_fkey',
        'quote_requests_deleted_by_id_fkey',
        'quote_requests_restored_by_id_fkey',
        'shipping_accounts_provider_id_fkey',
        'shipping_provider_tests_actor_id_fkey',
        'shipping_provider_tests_provider_id_fkey',
        'shipping_providers_updated_by_id_fkey',
        'shipping_quote_items_package_group_id_fkey',
        'shipping_quote_items_quote_id_fkey',
        'shipping_quotes_attempt_id_fkey',
        'fk_attempts_run',
        'fk_attempts_shipment',
        'fk_attempts_snapshot',
        'fk_auth_accounts_user',
        'fk_auth_sessions_user',
        'fk_auth_users_creator',
        'fk_auth_users_updater',
        'fk_carriers_created_by_id',
        'fk_carriers_deleted_by_id',
        'fk_carriers_updated_by_id',
        'fk_sales_reps_created_by_id',
        'fk_sales_reps_deleted_by_id',
        'fk_sales_reps_updated_by_id',
        'fk_runs_requester',
        'fk_shipments_created_by_id',
        'fk_shipments_deleted_by_id',
        'fk_shipments_record_updated_by_id',
        'fk_shipments_sales_rep_id',
        'fk_shipments_updated_by_id',
        'fk_runs_carrier',
        'fk_shipment_purchase_orders_order',
        'fk_shipment_purchase_orders_shipment',
        'fk_shipments_carrier',
        'fk_shipments_current_snapshot',
        'fk_snapshots_shipment',
      ]
        .sort()
        .map((conname) => ({
          conname,
          confdeltype: 'a',
          confupdtype: 'a',
          condeferrable: false,
        })),
    );

    const indexes = await source.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );

    for (const [name, definition] of [
      [
        'uq_shipments_active_reference',
        'UNIQUE INDEX uq_shipments_active_reference ON public.shipments USING btree (carrier_id, tracking_reference) WHERE (deleted_at IS NULL)',
      ],
      [
        'ix_shipments_carrier',
        'INDEX ix_shipments_carrier ON public.shipments USING btree (carrier_id)',
      ],
      [
        'ix_shipments_due',
        "INDEX ix_shipments_due ON public.shipments USING btree (next_check_at, id) WHERE ((deleted_at IS NULL) AND (monitoring_status = 'active'::shipment_monitoring_status))",
      ],
      [
        'ix_shipments_sales_rep_id',
        'INDEX ix_shipments_sales_rep_id ON public.shipments USING btree (sales_rep_id)',
      ],
      [
        'ix_shipments_record_updated_by_id',
        'INDEX ix_shipments_record_updated_by_id ON public.shipments USING btree (record_updated_by_id)',
      ],
      [
        'ix_shipments_follow_up_on',
        'INDEX ix_shipments_follow_up_on ON public.shipments USING btree (follow_up_on, id) WHERE (deleted_at IS NULL)',
      ],
      [
        'ix_sales_reps_created_by_id',
        'INDEX ix_sales_reps_created_by_id ON public.sales_reps USING btree (created_by_id)',
      ],
      [
        'ix_sales_reps_updated_by_id',
        'INDEX ix_sales_reps_updated_by_id ON public.sales_reps USING btree (updated_by_id)',
      ],
      [
        'ix_sales_reps_deleted_by_id',
        'INDEX ix_sales_reps_deleted_by_id ON public.sales_reps USING btree (deleted_by_id)',
      ],
      [
        'ix_sales_reps_name',
        'INDEX ix_sales_reps_name ON public.sales_reps USING btree (last_name, first_name, id)',
      ],
      [
        'ix_snapshots_history',
        'INDEX ix_snapshots_history ON public.shipment_tracking_snapshots USING btree (shipment_id, observed_at DESC, id DESC)',
      ],
      [
        'ix_runs_carrier_created',
        'INDEX ix_runs_carrier_created ON public.tracking_runs USING btree (carrier_id, created_at DESC)',
      ],
      [
        'ix_runs_status_created',
        'INDEX ix_runs_status_created ON public.tracking_runs USING btree (status, created_at)',
      ],
      [
        'ix_attempts_shipment_started',
        'INDEX ix_attempts_shipment_started ON public.tracking_attempts USING btree (shipment_id, started_at DESC)',
      ],
      [
        'ix_attempts_run_outcome',
        'INDEX ix_attempts_run_outcome ON public.tracking_attempts USING btree (tracking_run_id, outcome)',
      ],
    ])
      expect(indexes).toContainEqual({
        indexname: name,
        indexdef: 'CREATE ' + definition,
      });
  });

  it('has every documented column and no deferred columns or tables', async () => {
    const audit =
      'id external_id created_at updated_at deleted_at created_by_id updated_by_id deleted_by_id';
    const expected = {
      shipping_providers:
        'id code name enabled maintenance_message execution_mode stale_hours created_at updated_at used_internationally revision updated_by_id max_package_weight_lb',
      shipping_accounts:
        'default_refresh id provider_id created_at updated_at last_default',
      shipping_provider_tests:
        'id provider_id actor_id mode revision state failure_summary created_at deadline completed_at consumed_at',
      quote_requests:
        'id external_id idempotency_key created_by_id input senders status created_at deleted_at deleted_by_id restored_at last_deleted_at restored_by_id',
      quote_package_groups:
        'normalized id request_id position quantity units length_original width_original height_original weight_original length_value width_value height_value weight_value created_at',
      quote_customs_items:
        'id package_group_id position description quantity unit_value currency country_of_manufacture weight hs_code created_at',
      quote_provider_attempts:
        'id external_id request_id account_id sender execution_mode status lease_until recovery_count reason_code created_at completed_at lease_owner attempt_number started_at outcome simulated diagnostics conversion_snapshot weight_policy',
      shipping_quotes:
        'id attempt_id carrier service transportation_total currency estimate_method transit_description expires_at retrieved_at option_coverage duty_status tax_status clearance_status created_at group_contributions',
      shipping_quote_items:
        'id quote_id package_group_id description amount scope created_at',

      auth_users:
        'id external_id name first_name last_name email email_verified image role active must_change_password created_at updated_at created_by_id updated_by_id',
      auth_accounts:
        'id user_id account_id provider_id password access_token refresh_token id_token scope access_token_expires_at refresh_token_expires_at created_at updated_at',
      auth_sessions:
        'id user_id token expires_at ip_address user_agent created_at updated_at',
      auth_verifications:
        'id identifier value expires_at created_at updated_at',

      carriers:
        audit +
        ' code name is_active not_found_pause_threshold poll_interval_minutes rate_limit_per_minute fetch_mode failure_pause_enabled failure_pause_threshold session_failure_disable_enabled session_failure_disable_threshold consecutive_session_failures session_generation auto_disabled_reason',
      shipments:
        audit +
        ' carrier_id tracking_reference notes verification_url monitoring_status monitoring_reason current_tracking_snapshot_id last_attempted_at next_check_at consecutive_not_found_count lock_version sales_rep_id follow_up_on record_updated_at record_updated_by_id consecutive_failure_count po_number customer vendor so_numbers products',
      purchase_orders: 'po_number',
      shipment_purchase_orders: 'shipment_id po_number',
      sales_reps: audit + ' first_name last_name email',
      shipment_tracking_snapshots:
        'id shipment_id carrier_status carrier_status_detail picked_up_on estimated_delivery_on delivered_on observed_at external_id',
      tracking_runs:
        'id external_id carrier_id trigger status reason_code message requested_by_id created_at updated_at started_at completed_at fetch_mode session_failure_recorded session_generation',
      tracking_attempts:
        'id tracking_run_id shipment_id outcome snapshot_id snapshot_changed source_data retryable reason_code message started_at completed_at',
    };
    const columns =
      await source.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> 'migrations' ORDER BY table_name, ordinal_position`);

    expect(columns).toEqual(
      Object.entries(expected)
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([table_name, names]) =>
          names.split(' ').map((column_name) => ({ table_name, column_name })),
        ),
    );

    const identities =
      await source.query(`SELECT table_name, data_type, identity_generation FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'id' AND table_name <> 'migrations' ORDER BY table_name`);

    expect(identities).toEqual(
      [
        ['auth_accounts', 'integer'],
        ['auth_sessions', 'integer'],
        ['auth_users', 'integer'],
        ['auth_verifications', 'integer'],
        ['carriers', 'integer'],
        ['quote_customs_items', 'bigint'],
        ['quote_package_groups', 'bigint'],
        ['quote_provider_attempts', 'bigint'],
        ['quote_requests', 'bigint'],
        ['sales_reps', 'integer'],
        ['shipment_tracking_snapshots', 'bigint'],
        ['shipments', 'integer'],
        ['shipping_accounts', 'integer'],
        ['shipping_provider_tests', 'uuid'],
        ['shipping_providers', 'integer'],
        ['shipping_quote_items', 'bigint'],
        ['shipping_quotes', 'bigint'],
        ['tracking_attempts', 'bigint'],
        ['tracking_runs', 'bigint'],
      ].map(([table_name, data_type]) => ({
        table_name,
        data_type,
        identity_generation: data_type === 'uuid' ? null : 'ALWAYS',
      })),
    );
  });
});
