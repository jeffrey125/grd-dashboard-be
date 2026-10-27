import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import {
  WorkerOwnership,
  WORKER_LOCK_NAMESPACE,
  WORKER_LOCK_ID,
} from '@infrastructure/database/worker-ownership.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Worker condition timed out');
    await delay(50);
  }
}

describe('exclusive worker ownership with PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  const owners: WorkerOwnership[] = [];
  const processes: ChildProcess[] = [];

  beforeAll(async () => {
    db = await shipmentDatabase();
    await db.source.query('UPDATE carriers SET is_active = false');
  });

  afterAll(async () => {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
    }
    await Promise.all(owners.map((owner) => owner.close()));
    await db?.close();
  });

  const owner = (onLost = vi.fn()) => {
    const instance = new WorkerOwnership(
      createConfiguration(db.environment).database,
      onLost,
    );
    owners.push(instance);
    return instance;
  };

  const terminateOwner = () =>
    db.source.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
      WHERE locktype = 'advisory' AND classid = $1::oid
        AND objid = $2::oid AND objsubid = 2 AND granted`,
      [WORKER_LOCK_NAMESPACE, WORKER_LOCK_ID],
    );

  it('keeps a contender waiting, permits cancellation, and hands ownership over after release', async () => {
    const first = owner();
    const second = owner();
    await first.acquire(new AbortController().signal, vi.fn());
    const waiting = vi.fn();
    const abort = new AbortController();
    const attempt = second.acquire(abort.signal, waiting);
    const cancelled = expect(attempt).rejects.toThrow();
    await until(() => waiting.mock.calls.length === 1);
    abort.abort();
    await cancelled;
    await second.close();
    await first.close();
    const third = owner();
    await third.acquire(new AbortController().signal, vi.fn());
    // The heartbeat must keep one lock, not re-enter and stack it.
    await delay(2200);
    const locks = await db.source.query(
      "SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND granted",
      [WORKER_LOCK_NAMESPACE, WORKER_LOCK_ID],
    );
    expect(locks[0].count).toBe(1);
    await third.close();
  });

  it('reports a terminated ownership connection once without reacquiring', async () => {
    const lost = vi.fn();
    const first = owner(lost);
    await first.acquire(new AbortController().signal, vi.fn());
    await terminateOwner();
    await until(() => lost.mock.calls.length > 0);
    await delay(100);
    expect(lost).toHaveBeenCalledTimes(1);
    const next = owner();
    await next.acquire(new AbortController().signal, vi.fn());
    await next.close();
    await first.close();
  });

  function worker() {
    const child = spawn(process.execPath, ['dist/worker.js'], {
      env: {
        PATH: process.env.PATH,
        ...db.environment,
        LOG_LEVEL: 'info',
        QUOTE_COMPARISON_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    processes.push(child);
    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    return {
      child,
      has: (event: string) => output.includes(`"event":"${event}"`),
    };
  }

  it('gates real worker startup, hands over on SIGTERM, and exits on lock loss', async () => {
    const first = worker();
    await until(() => first.has('application.ready'));
    const second = worker();
    await until(() => second.has('worker.ownership.waiting'));
    expect(second.has('application.ready')).toBe(false);
    expect(second.has('tracking.worker.failed')).toBe(false);

    // A cancelled waiting deployment must exit without starting Nest or work.
    const cancelled = worker();
    await until(() => cancelled.has('worker.ownership.waiting'));
    cancelled.child.kill('SIGTERM');
    await until(() => cancelled.child.exitCode !== null);
    expect(cancelled.child.exitCode).toBe(0);
    expect(cancelled.has('application.ready')).toBe(false);

    first.child.kill('SIGTERM');
    await until(() => first.child.exitCode !== null);
    expect(first.child.exitCode).toBe(0);
    expect(first.has('application.stopped')).toBe(true);
    await until(() => second.has('application.ready'));

    await terminateOwner();
    await until(() => second.child.exitCode !== null);
    expect(second.child.exitCode).toBe(1);
    expect(second.has('worker.ownership.lost')).toBe(true);
  });

  it('exits nonzero when tracking fails after startup instead of holding ownership while idle', async () => {
    // Disposable database only: fail the first scheduled reconciliation statement.
    await db.source.query(`
      CREATE FUNCTION fixture_tracking_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fixture tracking failure'; END;
      $$;
      CREATE TRIGGER fixture_tracking_failure BEFORE UPDATE ON shipments
        FOR EACH STATEMENT EXECUTE FUNCTION fixture_tracking_failure();
    `);

    try {
      const failed = worker();
      await until(() => failed.child.exitCode !== null);
      expect(failed.child.exitCode).toBe(1);
      expect(failed.has('worker.scheduler.failed')).toBe(true);
      const next = owner();
      await next.acquire(new AbortController().signal, vi.fn());
      await next.close();
    } finally {
      await db.source.query(
        'DROP TRIGGER fixture_tracking_failure ON shipments; DROP FUNCTION fixture_tracking_failure()',
      );
    }
  });
});
