import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TypeOrmQuoteRepository } from '@modules/shipping-quotes/typeorm-quote.repository.js';
import type {
  QuoteInput,
  SenderSnapshot,
} from '@modules/shipping-quotes/quote.schemas.js';

const address = {
  name: 'Readiness fixture',
  street: '1 Example Street',
  city: 'Walworth',
  division: 'WI',
  postalCode: '53125',
  country: 'US' as const,
};
const senders: SenderSnapshot[] = ['amazon', 'unishippers'].map((code) => ({
  code: code as SenderSnapshot['code'],
  mode: 'explicit',
  retrievedAt: null,
  address,
}));
const input = (): QuoteInput => ({
  idempotencyKey: randomUUID(),
  shipDate: new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
  destination: address,
  providers: senders.map(({ code }) => ({
    code,
    sender: { mode: 'explicit', address },
    options: { signature: 'none', insurance: null },
  })),
  packageGroups: [
    {
      quantity: 2,
      units: 'imperial',
      length: '10',
      width: '8',
      height: '6',
      weight: '5',
      customsItems: [],
    },
  ],
});

describe('Quote worker process readiness', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let quotes: TypeOrmQuoteRepository;
  let directory: string;
  let actor: number;
  const children: ChildProcess[] = [];
  let output = '';

  beforeAll(async () => {
    db = await shipmentDatabase();
    directory = await mkdtemp(join(tmpdir(), 'quote-readiness-'));
    quotes = new TypeOrmQuoteRepository(db.source);
    await db.source.query('UPDATE carriers SET is_active=false');
    const [user] = await db.source.query(
      "INSERT INTO auth_users(name,first_name,last_name,email,role) VALUES ('Fixture','Fixture','Staff','readiness@example.test','staff') RETURNING id",
    );
    actor = user.id;
  });

  async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>((resolve) =>
      child.once('close', () => resolve()),
    );
    child.kill('SIGKILL');
    await closed;
  }

  afterAll(async () => {
    for (const child of children) await stop(child);
    await db?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function start(scenario: 'timeout' | 'success') {
    const child = spawn(process.execPath, [resolve('dist/worker.js')], {
      cwd: directory,
      // A fresh cwd and explicit environment prevent loading local .env credentials.
      env: {
        PATH: process.env.PATH,
        ...db.environment,
        LOG_LEVEL: 'info',
        QUOTE_DEMO_MODE: 'true',
        QUOTE_DEMO_AMAZON: scenario,
        QUOTE_DEMO_UNISHIPPERS: scenario,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    return child;
  }

  it('recovers after a killed worker and natural lease expiry while serializing accounts and running providers in parallel', async () => {
    const first = await quotes.create(input(), actor, senders);
    const second = await quotes.create(input(), actor, senders);
    const original = start('timeout');

    await vi.waitFor(
      async () => {
        expect(original.exitCode).toBeNull();
        const snapshot = await quotes.find(first.comparison.externalId);
        expect(snapshot?.attempts.map((attempt) => attempt.status)).toEqual([
          'running',
          'running',
        ]);
      },
      { timeout: 20000, interval: 50 },
    );
    expect(
      (await quotes.find(second.comparison.externalId))?.attempts.map(
        (attempt) => attempt.status,
      ),
    ).toEqual(['queued', 'queued']);
    await stop(original);

    const replacement = start('success');
    // Exercise the real 120-second lease; no SQL expiry shortcut.
    await vi.waitFor(
      async () => {
        expect(replacement.exitCode).toBeNull();
        const snapshot = await quotes.find(first.comparison.externalId);
        expect(snapshot?.status).toBe('completed');
        expect(snapshot?.attempts).toHaveLength(2);
        for (const attempt of snapshot!.attempts) {
          expect(attempt.recoveryCount).toBe(1);
          expect(attempt.outcome).toBe('success');
          expect(attempt.quotes).toHaveLength(1);
        }
      },
      { timeout: 140000, interval: 500 },
    );
    await vi.waitFor(
      async () => {
        const snapshot = await quotes.find(second.comparison.externalId);
        expect(snapshot?.status).toBe('completed');
        expect(snapshot?.attempts.every((a) => a.recoveryCount === 0)).toBe(
          true,
        );
      },
      { timeout: 10000, interval: 100 },
    );
    expect(output).toContain('Worker ready');
    expect(output).not.toContain(address.street);
    expect(output).not.toContain('readiness@example.test');
    await stop(replacement);
  }, 180000);
});
