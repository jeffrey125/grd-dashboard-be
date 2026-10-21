import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TypeOrmQuoteRepository } from '@modules/shipping-quotes/typeorm-quote.repository.js';
import { TypeOrmQuoteExecutionRepository } from '@modules/shipping-quotes/typeorm-quote-execution.repository.js';
import type {
  QuoteInput,
  SenderSnapshot,
} from '@modules/shipping-quotes/quote.schemas.js';
import {
  executeQuote,
  quoteFailure,
} from '@modules/shipping-quotes/quote-executor.js';
import { FixtureQuoteAdapter } from '@modules/shipping-quotes/fixture-quote.adapter.js';

const address = {
  name: 'Fixture',
  street: '1 Example St',
  city: 'Walworth',
  division: 'WI',
  postalCode: '53125',
  country: 'US',
  contactName: 'Fixture Contact',
  phone: '2625550123',
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
  providers: senders.map((sender) => ({
    code: sender.code,
    sender: { mode: 'explicit', address: { ...address, country: 'US' } },
    options: { signature: 'none', insurance: null },
  })),
  packageGroups: [
    {
      quantity: 1,
      units: 'imperial',
      length: '10',
      width: '8',
      height: '6',
      weight: '5',
      customsItems: [],
    },
  ],
});

describe('Durable quote execution', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let quotes: TypeOrmQuoteRepository;
  let jobs: TypeOrmQuoteExecutionRepository;
  let actor: number;

  beforeAll(async () => {
    db = await shipmentDatabase();
    quotes = new TypeOrmQuoteRepository(db.source);
    jobs = new TypeOrmQuoteExecutionRepository(db.source);
    const [user] = await db.source.query(
      "INSERT INTO auth_users(name,first_name,last_name,email,role) VALUES ('Quote Fixture','Quote','Fixture','quote-execution@example.test','staff') RETURNING id",
    );
    actor = user.id;
  });

  afterAll(async () => {
    await db?.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(async () => {
    await db.source.query(
      'TRUNCATE shipping_quote_items,shipping_quotes,quote_provider_attempts,quote_customs_items,quote_package_groups,quote_requests RESTART IDENTITY',
    );
    await db.source.query(
      "UPDATE shipping_providers SET enabled=true,execution_mode='request',stale_hours=24",
    );
  });

  it('retries a failed provider once under concurrent clicks and preserves the original input and partial rates', async () => {
    const original = input();
    const saved = await quotes.create(original, actor, senders);
    const first = (await jobs.claim(120000))!;
    const second = (await jobs.claim(120000))!;
    await jobs.finish(
      first,
      await executeQuote(
        first,
        new FixtureQuoteAdapter('success', 0),
        new AbortController().signal,
      ),
    );
    await jobs.finish(second, quoteFailure('timeout'));
    const before = (await quotes.find(saved.comparison.externalId))!;
    const failed = before.attempts.find(
      (attempt) => attempt.provider === second.code,
    )!;

    const retries = await Promise.allSettled([
      quotes.retry(saved.comparison.externalId, failed.externalId),
      quotes.retry(saved.comparison.externalId, failed.externalId),
    ]);

    expect(
      retries.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const after = (await quotes.find(saved.comparison.externalId))!;
    expect(after.input).toEqual(original);
    expect(after.attempts).toHaveLength(3);
    expect(after.attempts[0].quotes).toEqual(before.attempts[0].quotes);
    expect(after.attempts[1]).toMatchObject({
      outcome: 'timeout',
      attemptNumber: 1,
    });
    expect(after.attempts[2]).toMatchObject({
      status: 'queued',
      attemptNumber: 2,
      sender: senders[1],
    });
    await db.source.query(
      "UPDATE shipping_providers SET execution_mode='browser' WHERE code=$1",
      [second.code],
    );
    const retry = (await jobs.claim(120000))!;
    expect(retry.mode).toBe('browser');
    expect(retry.input).toEqual(original);
    expect(retry.sender).toEqual(second.sender);
  });

  it('preserves the actionable myUnishippers sender error through the comparison read contract', async () => {
    const original = input();
    original.providers = original.providers.filter(
      (provider) => provider.code === 'unishippers',
    );
    const saved = await quotes.create(
      original,
      actor,
      senders.filter((sender) => sender.code === 'unishippers'),
    );
    const job = (await jobs.claim(120000))!;

    expect(
      await jobs.finish(job, quoteFailure('sender_company_too_long')),
    ).toBe(true);

    const snapshot = await quotes.find(saved.comparison.externalId);
    expect(snapshot?.attempts[0]).toMatchObject({
      provider: 'unishippers',
      outcome: 'validation_failed',
      reasonCode: 'sender_company_too_long',
      quotes: [],
    });
    expect(snapshot?.input).toEqual(original);
    expect(snapshot?.senders[0]?.address).toEqual(address);
  });

  it.each(['unsupported', 'validation_failed'] as const)(
    'does not retry %s outcomes',
    async (reason) => {
      const original = input();
      original.providers = original.providers.slice(0, 1);
      const saved = await quotes.create(original, actor, senders.slice(0, 1));
      const job = (await jobs.claim(120000))!;
      await jobs.finish(job, quoteFailure(reason));
      await expect(
        quotes.retry(
          saved.comparison.externalId,
          saved.comparison.attempts[0].externalId,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await quotes.find(saved.comparison.externalId))?.attempts,
      ).toHaveLength(1);
    },
  );

  it.each(['provider_disabled', 'ship_date_passed', 'input_invalid'] as const)(
    'rejects retry when %s and returns an actionable eligibility reason',
    async (reason) => {
      const original = input();
      original.providers = original.providers.slice(1);
      const saved = await quotes.create(original, actor, senders.slice(1));
      const job = (await jobs.claim(120000))!;
      await jobs.finish(job, quoteFailure('timeout'));
      if (reason === 'provider_disabled')
        await db.source.query(
          "UPDATE shipping_providers SET enabled=false WHERE code='unishippers'",
        );
      // Move the business date without mutating the immutable stored snapshot.
      if (reason === 'ship_date_passed' || reason === 'input_invalid') {
        const now = Date.now();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(
          now + (reason === 'ship_date_passed' ? 86_400_000 : -86_400_000),
        );
      }

      expect(
        (await quotes.find(saved.comparison.externalId))?.attempts[0]
          .retryBlockedReason,
      ).toBe(reason);
      await expect(
        quotes.retry(
          saved.comparison.externalId,
          saved.comparison.attempts[0].externalId,
        ),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it('allows an independent provider retry while preserving the other running attempt', async () => {
    const saved = await quotes.create(input(), actor, senders);
    const first = (await jobs.claim(120000))!;
    const second = (await jobs.claim(120000))!;
    await jobs.finish(first, quoteFailure('timeout'));
    const retried = await quotes.retry(
      saved.comparison.externalId,
      saved.comparison.attempts[0].externalId,
    );
    expect(retried.status).toBe('running');
    expect(retried.attempts[1]).toMatchObject({
      externalId: saved.comparison.attempts[1].externalId,
      status: 'running',
    });
    expect((await jobs.claim(120000))?.code).toBe(first.code);
    expect(second.code).not.toBe(first.code);
  });

  it('rechecks changed configuration before executing a queued retry', async () => {
    const original = input();
    original.providers = original.providers.slice(1);
    Object.assign(original.packageGroups[0], {
      length: '',
      width: '',
      height: '',
    });
    const saved = await quotes.create(original, actor, senders.slice(1));
    const job = (await jobs.claim(120000))!;
    await jobs.finish(job, quoteFailure('timeout'));
    await quotes.retry(
      saved.comparison.externalId,
      saved.comparison.attempts[0].externalId,
    );
    await db.source.query(
      "UPDATE shipping_providers SET enabled=false WHERE code='unishippers'",
    );

    expect(await jobs.claim(120000)).toBeNull();
    const result = (await quotes.find(saved.comparison.externalId))!;
    expect(result.attempts[1]).toMatchObject({
      outcome: 'failed',
      reasonCode: 'provider_disabled',
      executionMode: 'request',
      startedAt: null,
      quotes: [],
    });
    expect(result.attempts[0].outcome).toBe('timeout');
  });

  it('serializes deletion against retry and preserves children through restore', async () => {
    const original = input();
    original.providers = original.providers.slice(0, 1);
    const saved = await quotes.create(original, actor, senders.slice(0, 1));
    await jobs.finish((await jobs.claim(120000))!, quoteFailure('timeout'));
    const results = await Promise.allSettled([
      quotes.retry(
        saved.comparison.externalId,
        saved.comparison.attempts[0].externalId,
      ),
      quotes.setDeleted(saved.comparison.externalId, true, actor),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const result = (await quotes.find(saved.comparison.externalId, true))!;
    if (result.deletedAt) {
      expect(await quotes.find(saved.comparison.externalId)).toBeNull();
      expect((await quotes.list(1)).total).toBe(0);
      expect((await quotes.list(1, true)).total).toBe(1);
      const restored = await quotes.setDeleted(
        saved.comparison.externalId,
        false,
        actor,
      );
      expect(restored.input).toEqual(original);
      expect(restored.attempts[0].outcome).toBe('timeout');
      expect(restored.lastDeletedAt).toBe(result.deletedAt);
      expect(restored.restoredAt).not.toBeNull();
    } else {
      expect(result.attempts).toHaveLength(2);
      expect(result.status).toBe('queued');
    }
  });

  it('uses provider expiry instead of the configured stale period and retains all quotes after soft deletion', async () => {
    const original = input();
    original.providers = original.providers.slice(0, 1);
    const saved = await quotes.create(original, actor, senders.slice(0, 1));
    const job = (await jobs.claim(120000))!;
    await jobs.finish(job, {
      outcome: 'success',
      reason: null,
      simulated: false,
      relogins: 0,
      quotes: [
        {
          carrier: 'Fixture',
          service: 'Expires',
          total: '20',
          currency: 'USD',
          estimateMethod: 'native',
          expiresAt: '2000-01-01T00:00:00Z',
        },
        {
          carrier: 'Fixture',
          service: 'Stales',
          total: '25',
          currency: 'USD',
          estimateMethod: 'native',
        },
      ],
    });
    const before = (await quotes.find(saved.comparison.externalId))!;
    expect(before.attempts[0].quotes[0]).toMatchObject({
      expiresAt: '2000-01-01T00:00:00.000Z',
      staleAt: null,
    });
    const stale = before.attempts[0].quotes[1];
    expect(Date.parse(stale.staleAt!) - Date.parse(stale.retrievedAt)).toBe(
      86400000,
    );
    const deleted = await quotes.setDeleted(
      saved.comparison.externalId,
      true,
      actor,
    );
    expect(deleted.attempts[0].quotes).toEqual(before.attempts[0].quotes);
    const restored = await quotes.setDeleted(
      saved.comparison.externalId,
      false,
      actor,
    );
    expect(restored.attempts).toEqual(before.attempts);
  });

  it('queues atomically and leases different accounts concurrently without duplicating an account', async () => {
    const first = await quotes.create(input(), actor, senders);
    await quotes.create(input(), actor, senders);

    expect(first.comparison.status).toBe('queued');

    expect(first.comparison.attempts.map((a) => a.status)).toEqual([
      'queued',
      'queued',
    ]);

    const claims = (
      await Promise.all(Array.from({ length: 8 }, () => jobs.claim(120000)))
    ).filter((job) => job !== null);

    expect(claims).toHaveLength(2);

    expect(new Set(claims.map((job) => job.code))).toEqual(
      new Set(['amazon', 'unishippers']),
    );

    expect((await quotes.find(first.comparison.externalId))?.status).toBe(
      'running',
    );

    await Promise.all(
      claims.map(async (job) =>
        jobs.finish(
          job,
          await executeQuote(
            job,
            new FixtureQuoteAdapter('success', 0),
            new AbortController().signal,
          ),
        ),
      ),
    );

    const complete = await quotes.find(first.comparison.externalId);
    expect(complete?.status).toBe('completed');
    expect(complete?.attempts.map((attempt) => attempt.quotes.length)).toEqual([
      1, 1,
    ]);
  });

  it('preserves historical saves across migration rollback/reapply and never leases them', async () => {
    const original = input();
    const saved = await quotes.create(original, actor, senders);
    await db.source.query(
      "UPDATE quote_provider_attempts SET status='saved',execution_mode='request'",
    );
    await db.source.query("UPDATE quote_requests SET status='saved'");

    await db.source.undoLastMigration(); // Provider administration migration.
    await db.source.undoLastMigration(); // History and retry migration.
    await db.source.undoLastMigration(); // International options migration.
    await db.source.undoLastMigration(); // Optional package dimensions migration.
    await db.source.undoLastMigration(); // Amazon quote breakdown migration.
    await db.source.undoLastMigration(); // Quote execution migration.
    await db.source.runMigrations();

    expect(await jobs.claim(120000)).toBeNull();
    expect(await quotes.existing(original, actor)).toMatchObject({
      externalId: saved.comparison.externalId,
      input: original,
      status: 'saved',
      ratesRun: false,
    });
  });

  it('persists Amazon charge lines and calculated group contributions with the result', async () => {
    const baseInput = input();
    const comparisonInput = {
      ...baseInput,
      providers: baseInput.providers.slice(0, 1),
      packageGroups: baseInput.packageGroups.map((group) => ({
        ...group,
        quantity: 2,
      })),
    };
    const saved = await quotes.create(
      comparisonInput,
      actor,
      senders.slice(0, 1),
    );
    const job = (await jobs.claim(120000))!;

    await jobs.finish(job, {
      outcome: 'success',
      reason: null,
      simulated: false,
      relogins: 0,
      quotes: [
        {
          carrier: 'Not provided',
          service: 'Not provided',
          total: '27.620000',
          currency: 'USD',
          estimateMethod: 'calculated',
          charges: [
            {
              description: 'BASE_CHARGE',
              amount: '15.660000',
              scope: 'package',
              packageGroupPosition: 0,
            },
            {
              description: 'DELIVERY_AREA_SURCHARGE',
              amount: '7.120000',
              scope: 'package',
              packageGroupPosition: 0,
            },
            {
              description: 'FUEL_SURCHARGE',
              amount: '4.840000',
              scope: 'package',
              packageGroupPosition: 0,
            },
          ],
          groupContributions: [
            { packageGroupPosition: 0, quantity: 2, subtotal: '27.620000' },
          ],
        },
      ],
    });

    const snapshot = await quotes.find(saved.comparison.externalId);
    expect(snapshot?.attempts[0]?.quotes[0]).toMatchObject({
      platform: 'Amazon Shipping',
      transportationTotal: '27.620000',
      estimateMethod: 'calculated',
      charges: [
        {
          description: 'BASE_CHARGE',
          amount: '15.660000',
          scope: 'package',
          packageGroupPosition: 0,
        },
        {
          description: 'DELIVERY_AREA_SURCHARGE',
          amount: '7.120000',
          scope: 'package',
          packageGroupPosition: 0,
        },
        {
          description: 'FUEL_SURCHARGE',
          amount: '4.840000',
          scope: 'package',
          packageGroupPosition: 0,
        },
      ],
      groupContributions: [
        { packageGroupPosition: 0, quantity: 2, subtotal: '27.620000' },
      ],
    });
  });

  it('persists group contributions even when the provider returns no charge rows', async () => {
    const saved = await quotes.create(
      { ...input(), providers: input().providers.slice(0, 1) },
      actor,
      senders.slice(0, 1),
    );
    const job = (await jobs.claim(120000))!;

    await jobs.finish(job, {
      outcome: 'success',
      reason: null,
      simulated: false,
      relogins: 0,
      quotes: [
        {
          carrier: 'Not provided',
          service: 'Not provided',
          total: '13.810000',
          currency: 'USD',
          estimateMethod: 'native',
          charges: [],
          groupContributions: [
            { packageGroupPosition: 0, quantity: 1, subtotal: '13.810000' },
          ],
        },
      ],
    });

    expect(
      (await quotes.find(saved.comparison.externalId))?.attempts[0]?.quotes[0],
    ).toMatchObject({
      charges: [],
      groupContributions: [
        { packageGroupPosition: 0, quantity: 1, subtotal: '13.810000' },
      ],
    });
  });

  it('recovers an expired lease once, fences late completion, and terminates the next expiry', async () => {
    const saved = await quotes.create(
      { ...input(), providers: input().providers.slice(0, 1) },
      actor,
      senders.slice(0, 1),
    );
    const original = (await jobs.claim(120000))!;

    expect(await jobs.reserveRelogin(original)).toBe(true);

    expect(await jobs.reserveRelogin(original)).toBe(false);
    await db.source.query(
      "UPDATE quote_provider_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [original.id],
    );
    const recovered = (await new TypeOrmQuoteExecutionRepository(
      db.source,
    ).claim(120000))!;
    const success = await executeQuote(
      recovered,
      new FixtureQuoteAdapter('success', 0),
      new AbortController().signal,
    );

    expect(recovered.owner).not.toBe(original.owner);

    expect(recovered.reloginCount).toBe(1);

    expect(await jobs.reserveRelogin(recovered)).toBe(false);

    expect(await jobs.finish(original, success)).toBe(false);

    expect(
      (await quotes.find(saved.comparison.externalId))?.attempts[0]
        .recoveryCount,
    ).toBe(1);

    await db.source.query(
      "UPDATE quote_provider_attempts SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [recovered.id],
    );

    expect(await jobs.claim(120000)).toBeNull();

    expect(await jobs.finish(recovered, success)).toBe(false);

    expect(
      (await quotes.find(saved.comparison.externalId))?.attempts[0],
    ).toMatchObject({
      status: 'failed',
      reasonCode: 'recovery_exhausted',
      quotes: [],
    });

    expect(await jobs.claim(120000)).toBeNull();
  });

  it('keeps partial results and records the execution-time mode without rewriting original input', async () => {
    const original = input();
    const saved = await quotes.create(original, actor, senders);
    await db.source.query(
      "UPDATE shipping_providers SET execution_mode='browser' WHERE code='amazon'",
    );
    const first = (await jobs.claim(120000))!;
    const second = (await jobs.claim(120000))!;

    expect(first.mode).toBe('browser');
    const signal = new AbortController().signal;
    await jobs.finish(
      first,
      await executeQuote(first, new FixtureQuoteAdapter('success', 0), signal),
    );

    expect(
      (await quotes.find(saved.comparison.externalId))?.attempts[0].quotes,
    ).toHaveLength(1);

    expect((await quotes.find(saved.comparison.externalId))?.status).toBe(
      'running',
    );
    await jobs.finish(
      second,
      await executeQuote(
        second,
        new FixtureQuoteAdapter('unsupported', 0),
        signal,
      ),
    );
    const snapshot = await quotes.find(saved.comparison.externalId);

    expect(snapshot).toMatchObject({ status: 'completed', input: original });

    expect(snapshot?.attempts.map((a) => a.outcome)).toEqual([
      'success',
      'unsupported',
    ]);

    expect(
      await jobs.finish(
        first,
        await executeQuote(
          first,
          new FixtureQuoteAdapter('success', 0),
          signal,
        ),
      ),
    ).toBe(false);

    expect(
      (await quotes.find(saved.comparison.externalId))?.attempts[0].quotes,
    ).toHaveLength(1);
  });
});
