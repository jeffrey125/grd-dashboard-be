import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TypeOrmQuoteRepository } from '@modules/shipping-quotes/typeorm-quote.repository.js';
import { TypeOrmQuoteExecutionRepository } from '@modules/shipping-quotes/typeorm-quote-execution.repository.js';
import { TypeOrmProviderAdminRepository } from '@modules/shipping-quotes/typeorm-provider-admin.repository.js';
import type {
  QuoteInput,
  SenderSnapshot,
} from '@modules/shipping-quotes/quote.schemas.js';

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

describe('Configurable provider weight limits', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let quotes: TypeOrmQuoteRepository;
  let jobs: TypeOrmQuoteExecutionRepository;
  let admin: TypeOrmProviderAdminRepository;
  let actor: number;

  beforeAll(async () => {
    db = await shipmentDatabase();
    quotes = new TypeOrmQuoteRepository(db.source);
    jobs = new TypeOrmQuoteExecutionRepository(db.source);
    admin = new TypeOrmProviderAdminRepository(db.source);
    const [user] = await db.source.query(
      "INSERT INTO auth_users(name,first_name,last_name,email,role) VALUES ('Weight Fixture','Weight','Fixture','weight@example.test','admin') RETURNING id",
    );
    actor = user.id;
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.source.query(
      'TRUNCATE shipping_quote_items,shipping_quotes,quote_provider_attempts,quote_customs_items,quote_package_groups,quote_requests RESTART IDENTITY',
    );
    await db.source.query(
      "UPDATE shipping_providers SET enabled=true, revision=0, max_package_weight_lb=CASE WHEN code='amazon' THEN 50 ELSE 150 END",
    );
  });

  const saveLimit = async (limit: string, revision = 0) =>
    admin.save(
      'amazon',
      {
        revision,
        enabled: true,
        executionMode: 'api',
        maintenanceMessage: null,
        staleHours: 1,
        acknowledgeFailure: false,
        maxPackageWeightLb: limit,
      },
      actor,
    );
  const amazonInput = (weight: string) => {
    const value = input();
    value.providers = value.providers.filter(
      (provider) => provider.code === 'amazon',
    );
    value.packageGroups[0]!.weight = weight;
    return value;
  };
  const createAmazon = (weight: string) =>
    quotes.create(
      amazonInput(weight),
      actor,
      senders.filter((sender) => sender.code === 'amazon'),
    );

  it('seeds defaults and saves limits with revision and actor attribution', async () => {
    expect(await admin.settings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'amazon',
          maxPackageWeightLb: '50.000000',
        }),
        expect.objectContaining({
          code: 'unishippers',
          maxPackageWeightLb: '150.000000',
        }),
      ]),
    );
    await saveLimit('160');
    expect(await admin.settings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'amazon',
          maxPackageWeightLb: '160.000000',
          revision: 1,
        }),
      ]),
    );
    await expect(saveLimit('10')).rejects.toThrow('Settings changed');
    const [row] = await db.source.query(
      "SELECT updated_by_id FROM shipping_providers WHERE code='amazon'",
    );
    expect(row.updated_by_id).toBe(actor);
  });

  it('skips an overweight provider for the whole shipment but queues the other', async () => {
    const value = input();
    value.packageGroups[0]!.weight = '60';
    const saved = await quotes.create(value, actor, senders);
    expect(saved.comparison.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'amazon',
          status: 'failed',
          reasonCode: 'weight_limit_exceeded',
          startedAt: null,
          weightPolicy: expect.objectContaining({
            exceededPackageGroupPositions: [0],
          }),
        }),
        expect.objectContaining({ provider: 'unishippers', status: 'queued' }),
      ]),
    );
    expect((await jobs.claim(10000))?.code).toBe('unishippers');
    expect(await jobs.claim(10000)).toBeNull();
  });

  it('rejects all-overweight input without persisting a comparison', async () => {
    const value = input();
    value.packageGroups[0]!.weight = '151';
    await expect(quotes.create(value, actor, senders)).rejects.toThrow(
      'No selected provider',
    );
    expect(await db.source.query('SELECT id FROM quote_requests')).toEqual([]);
  });

  it('rechecks queued initial attempts against current limits at worker start', async () => {
    const saved = await createAmazon('40');
    await saveLimit('30');
    expect(await jobs.claim(10000)).toBeNull();
    const current = await quotes.find(saved.comparison.externalId);
    expect(current?.attempts[0]).toMatchObject({
      reasonCode: 'weight_limit_exceeded',
      startedAt: null,
      weightPolicy: { maxPackageWeightLb: '30.000000' },
    });
  });

  it('keeps the started policy across recovery after an admin decrease', async () => {
    await createAmazon('40');
    const started = await jobs.claim(10000);
    expect(started?.weightPolicy).toMatchObject({
      maxPackageWeightLb: '50.000000',
    });
    await expect(
      db.source.query(
        "UPDATE quote_provider_attempts SET weight_policy='{}'::jsonb WHERE id=$1",
        [started!.id],
      ),
    ).rejects.toThrow('Started or completed weight policy is immutable');
    await saveLimit('30');
    await db.source.query(
      "UPDATE quote_provider_attempts SET lease_until=clock_timestamp()-interval '1 second'",
    );
    const recovered = await jobs.claim(10000);
    expect(recovered?.weightPolicy).toEqual(started?.weightPolicy);
    expect(recovered?.id).toBe(started?.id);
  });

  it('preserves results while blocking an overweight retry and permits it after a limit increase', async () => {
    const saved = await createAmazon('40');
    const started = await jobs.claim(10000);
    await jobs.finish(started!, {
      outcome: 'timeout',
      reason: 'timeout',
      simulated: false,
      relogins: 0,
      quotes: [],
    });
    await saveLimit('30');
    const current = await quotes.find(saved.comparison.externalId);
    expect(current?.attempts[0]).toMatchObject({
      outcome: 'timeout',
      retryBlockedReason: 'weight_limit_exceeded',
      weightPolicy: { maxPackageWeightLb: '50.000000' },
    });
    await expect(
      quotes.retry(
        saved.comparison.externalId,
        current!.attempts[0]!.externalId,
      ),
    ).rejects.toThrow('Retry is unavailable');
    await saveLimit('60', 1);
    await quotes.retry(
      saved.comparison.externalId,
      current!.attempts[0]!.externalId,
    );
    expect((await jobs.claim(10000))?.weightPolicy).toMatchObject({
      maxPackageWeightLb: '60.000000',
    });
  });

  it('preserves configured limits for older admin clients omitting the field', async () => {
    await saveLimit('60');
    await admin.save(
      'amazon',
      {
        revision: 1,
        enabled: true,
        executionMode: 'api',
        maintenanceMessage: null,
        staleHours: 2,
        acknowledgeFailure: false,
      },
      actor,
    );
    expect(await admin.settings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'amazon',
          maxPackageWeightLb: '60.000000',
        }),
      ]),
    );
  });
});
