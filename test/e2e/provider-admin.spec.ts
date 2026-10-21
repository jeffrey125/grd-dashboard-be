import { TypeOrmProviderAdminRepository } from '@modules/shipping-quotes/typeorm-provider-admin.repository.js';
import { SenderDefaultsWorker } from '@modules/shipping-quotes/sender-defaults.worker.js';
import { TypeOrmQuoteExecutionRepository } from '@modules/shipping-quotes/typeorm-quote-execution.repository.js';
import { quoteFailure } from '@modules/shipping-quotes/quote-executor.js';
import { TypeOrmSenderDefaultsRepository } from '@modules/shipping-quotes/typeorm-sender-defaults.repository.js';
import { AuthService } from '@modules/auth/auth.service.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { administratorCookie } from '@test/support/authentication.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { configureApiRoutes } from '@runtime/api-routing.js';

const address = {
  name: 'Fixture warehouse',
  street: '1 Example Street',
  city: 'Walworth',
  division: 'WI',
  postalCode: '53125',
  country: 'US',
};
const input = () => ({
  idempotencyKey: randomUUID(),
  shipDate: '2099-10-19',
  destination: {
    ...address,
    city: 'New York',
    division: 'NY',
    postalCode: '10118',
  },
  providers: [
    {
      code: 'amazon',
      sender: { mode: 'explicit', address },
      options: { signature: 'none', insurance: null },
    },
  ],
  packageGroups: [
    {
      quantity: 2,
      units: 'imperial',
      length: '10.00',
      width: '8',
      height: '6',
      weight: '5',
      customsItems: [],
    },
  ],
});

describe('Provider administration HTTP API', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let cookie: string;

  beforeAll(async () => {
    db = await shipmentDatabase();
    for (const [key, value] of Object.entries(db.environment))
      vi.stubEnv(key, value);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(DataSource)
      .useValue(db.source)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApiRoutes(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    cookie = await administratorCookie(app);
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
    vi.unstubAllEnvs();
  });

  const base = '/api/v1/admin/shipping-providers';
  const server = () => app.getHttpServer() as Server;
  const get = (path: string, session = cookie) =>
    request(server()).get(path).set('Cookie', session);
  const post = (path: string, data: object, session = cookie) =>
    request(server())
      .post(path)
      .set('Cookie', session)
      .set('Origin', 'http://dashboard.example.test')
      .send(data);
  const patch = (data: object, session = cookie) =>
    request(server())
      .patch(base + '/amazon')
      .set('Cookie', session)
      .set('Origin', 'http://dashboard.example.test')
      .send(data);
  const settings = async () =>
    (await get(base).expect(200)).body.find(
      (p: { code: string }) => p.code === 'amazon',
    );
  const editable = (p: Record<string, unknown>) => ({
    revision: p.revision,
    enabled: p.enabled,
    executionMode: p.executionMode,
    maintenanceMessage: p.maintenanceMessage,
    staleHours: p.staleHours,
  });

  it('fixes Amazon to API mode and rejects browser or request configuration', async () => {
    const provider = await settings();
    expect(provider.staleHours).toBe(1);
    expect(provider.executionMode).toBe('api');
    const body = editable(provider);
    await patch({ ...body, staleHours: 0 }).expect(400);
    await patch({ ...body, staleHours: 169 }).expect(400);
    await patch({ ...body, staleHours: 1.5 }).expect(400);
    await patch({ ...body, executionMode: 'browser' }).expect(400);
    await patch({ ...body, executionMode: 'request' }).expect(400);
    await post(base + '/amazon/connection-tests', {
      executionMode: 'browser',
    }).expect(400);
    const test = await post(base + '/amazon/connection-tests', {
      executionMode: 'api',
    }).expect(201);
    const repository = new TypeOrmProviderAdminRepository(db.source);
    const work = (await repository.claim())!;
    expect(work.id).toBe(test.body.id);
    await repository.finish(work, 'readiness_failed');
    const failed = await get(
      base + '/amazon/connection-tests/' + work.id,
    ).expect(200);
    expect(failed.body).toMatchObject({
      state: 'failed',
      failureSummary: 'readiness_failed',
    });
    await patch({
      ...body,
      staleHours: 2,
      connectionTestId: work.id,
    }).expect(200);
    const saved = await settings();
    expect(saved).toMatchObject({
      executionMode: 'api',
      staleHours: 2,
    });
    expect(saved.updatedBy).toBeTruthy();
    await patch({ ...body, staleHours: 3 }).expect(409);
  });

  it('runs a current API readiness test without changing the fixed mode', async () => {
    const repo = new TypeOrmProviderAdminRepository(db.source);
    const queued = await post(base + '/amazon/connection-tests', {
      executionMode: 'api',
    }).expect(201);
    const work = (await repo.claim())!;
    await repo.finish(work, null);
    expect(queued.body.executionMode).toBe('api');
    expect(
      (await get(base + '/amazon/connection-tests/' + work.id)).body,
    ).toMatchObject({ state: 'succeeded', executionMode: 'api' });
    expect((await settings()).executionMode).toBe('api');
  });

  it('allows running work to finish, blocks queued work after disable, and preserves snapshots', async () => {
    const first = (await post('/api/v1/quote-comparisons', input()).expect(201))
      .body.comparison;
    const second = (
      await post('/api/v1/quote-comparisons', input()).expect(201)
    ).body.comparison;
    const jobs = new TypeOrmQuoteExecutionRepository(db.source);
    const running = (await jobs.claim(120000))!;
    const body = editable(await settings());
    await patch({
      ...body,
      enabled: false,
      maintenanceMessage: 'Scheduled maintenance',
    }).expect(200);
    await jobs.finish(running, quoteFailure('timeout'));
    expect(await jobs.claim(120000)).toBeNull();
    const preserved = (
      await get('/api/v1/quote-comparisons/' + first.externalId).expect(200)
    ).body;
    expect(preserved.attempts[0].executionMode).toBe('api');
    expect(preserved.attempts[0].sender).toEqual(first.attempts[0].sender);
    const blocked = (
      await get('/api/v1/quote-comparisons/' + second.externalId).expect(200)
    ).body;
    expect(blocked.attempts[0].reasonCode).toBe('provider_disabled');
    await post(
      '/api/v1/quote-comparisons/' +
        first.externalId +
        '/attempts/' +
        first.attempts[0].externalId +
        '/retry',
      {},
    ).expect(409);
    await post('/api/v1/quote-comparisons', input()).expect(400);
    const publicSettings = (
      await get('/api/v1/quote-comparisons/providers').expect(200)
    ).body;
    expect(
      publicSettings.find((p: { code: string }) => p.code === 'amazon'),
    ).toMatchObject({
      enabled: false,
      maintenanceMessage: 'Scheduled maintenance',
      staleHours: 2,
    });
    await patch({
      ...editable(await settings()),
      enabled: true,
      maintenanceMessage: null,
      staleHours: 1,
    }).expect(200);
  });

  it('renews a delayed readiness reservation and excludes account work until completion', async () => {
    const repo = new TypeOrmProviderAdminRepository(db.source);
    const queued = await post(base + '/amazon/connection-tests', {
      executionMode: 'api',
    }).expect(201);
    await db.source.query(
      "UPDATE shipping_provider_tests SET deadline=clock_timestamp()+interval '0.5 seconds' WHERE id=$1",
      [queued.body.id],
    );
    const work = (await repo.claim())!;
    await post('/api/v1/quote-comparisons', input()).expect(201);
    await new Promise((resolve) => setTimeout(resolve, 550));
    const jobs = new TypeOrmQuoteExecutionRepository(db.source);
    expect(await jobs.claim(120000)).toBeNull();
    await repo.finish(work, null);
    expect(
      (await get(base + '/amazon/connection-tests/' + work.id)).body.state,
    ).toBe('succeeded');
    const job = (await jobs.claim(120000))!;
    expect(job).not.toBeNull();
    await jobs.finish(job, quoteFailure('timeout'));
  });

  it('changes historical stale deadlines without rewriting rate data or provider expiry', async () => {
    const saved = (await post('/api/v1/quote-comparisons', input())).body
      .comparison;
    const jobs = new TypeOrmQuoteExecutionRepository(db.source);
    const job = (await jobs.claim(120000))!;
    await jobs.finish(job, {
      outcome: 'success',
      reason: null,
      simulated: false,
      relogins: 0,
      quotes: [
        {
          carrier: 'Fixture',
          service: 'No expiry',
          total: '12.500000',
          currency: 'USD',
          estimateMethod: 'native',
        },
        {
          carrier: 'Fixture',
          service: 'Provider expiry',
          total: '15.000000',
          currency: 'USD',
          estimateMethod: 'native',
          expiresAt: '2099-10-20T10:00:00Z',
        },
      ],
    });
    const path = '/api/v1/quote-comparisons/' + saved.externalId;
    const before = (await get(path)).body.attempts[0].quotes;
    await patch({ ...editable(await settings()), staleHours: 2 }).expect(200);
    const after = (await get(path)).body.attempts[0].quotes;
    expect(Date.parse(after[0].staleAt) - Date.parse(before[0].staleAt)).toBe(
      3600000,
    );
    expect(after[0].transportationTotal).toBe(before[0].transportationTotal);
    expect(after[1]).toEqual(before[1]);
    await patch({ ...editable(await settings()), staleHours: 1 }).expect(200);
  });

  it('serializes concurrent retry, disable, and claim without accepting later disabled work', async () => {
    const saved = (await post('/api/v1/quote-comparisons', input()).expect(201))
      .body.comparison;
    const jobs = new TypeOrmQuoteExecutionRepository(db.source);
    await jobs.finish((await jobs.claim(120000))!, quoteFailure('timeout'));
    const body = editable(await settings());
    const [disabled, retry] = await Promise.all([
      patch({ ...body, enabled: false }),
      post(
        '/api/v1/quote-comparisons/' +
          saved.externalId +
          '/attempts/' +
          saved.attempts[0].externalId +
          '/retry',
        {},
      ),
      jobs.claim(120000).then(async (job) => {
        if (job) await jobs.finish(job, quoteFailure('timeout'));
      }),
    ]);
    expect(disabled.status).toBe(200);
    expect([201, 409]).toContain(retry.status);
    expect(await jobs.claim(120000)).toBeNull();
    await patch({ ...editable(await settings()), enabled: true }).expect(200);
  });

  it('retains a historical mode when recovering an attempt started before the API migration', async () => {
    const saved = (await post('/api/v1/quote-comparisons', input()).expect(201))
      .body.comparison;
    await db.source.query(
      `UPDATE quote_provider_attempts SET execution_mode='request',status='running',started_at=clock_timestamp(),
      lease_owner=$2,lease_until=clock_timestamp()-interval '1 second' WHERE external_id=$1`,
      [saved.attempts[0].externalId, randomUUID()],
    );
    const jobs = new TypeOrmQuoteExecutionRepository(db.source);
    const recovered = (await jobs.claim(120000))!;
    expect(recovered.mode).toBe('request');
    await jobs.finish(recovered, quoteFailure('timeout'));
    const history = (await get('/api/v1/quote-comparisons/' + saved.externalId))
      .body;
    expect(history.attempts[0].executionMode).toBe('request');
    expect(history.attempts[0].sender).toEqual(saved.attempts[0].sender);
  });

  it('allows staff discovery/default refresh but denies every admin operation and mode override', async () => {
    const auth = app.get(AuthService);
    const principal = await auth.authenticate(new Headers({ cookie }));
    await auth.createAccount(principal, {
      firstName: 'Test',
      lastName: 'Staff',
      email: 'provider-staff@example.test',
      password: 'issued fixture password',
      role: 'staff',
    });
    const asCookie = (values: string[]) =>
      values.map((v) => v.split(';')[0]).join('; ');
    const issued = asCookie(
      (
        await auth.signIn({
          email: 'provider-staff@example.test',
          password: 'issued fixture password',
        })
      ).cookies,
    );
    await auth.changePassword(
      await auth.authenticate(new Headers({ cookie: issued })),
      {
        currentPassword: 'issued fixture password',
        newPassword: 'chosen fixture password',
      },
    );
    const staff = asCookie(
      (
        await auth.signIn({
          email: 'provider-staff@example.test',
          password: 'chosen fixture password',
        })
      ).cookies,
    );
    await get(base, staff).expect(403);
    await patch(editable(await settings()), staff).expect(403);
    await post(
      base + '/amazon/connection-tests',
      { executionMode: 'api' },
      staff,
    ).expect(403);
    await get(base + '/amazon/connection-tests/' + randomUUID(), staff).expect(
      403,
    );
    await get('/api/v1/quote-comparisons/providers', staff).expect(200);
    const body = input();
    await post(
      '/api/v1/quote-comparisons',
      {
        ...body,
        providers: [{ ...body.providers[0], executionMode: 'browser' }],
      },
      staff,
    ).expect(400);
    const defaults = new TypeOrmSenderDefaultsRepository(db.source);
    const worker = new SenderDefaultsWorker(defaults, {
      read: async () => address,
    });
    await post(
      '/api/v1/quote-comparisons/providers/amazon/default-refresh',
      {},
      staff,
    ).expect(400);
    const refresh = post(
      '/api/v1/quote-comparisons/providers/unishippers/default-refresh',
      {},
      staff,
    ).then((response) => response);
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await worker.runOnce();
      const [row] = await db.source.query(
        "SELECT last_default FROM shipping_accounts WHERE provider_id=(SELECT id FROM shipping_providers WHERE code='unishippers')",
      );
      if (row.last_default) break;
    }
    expect((await refresh).status).toBe(201);
    const discovery = (await get('/api/v1/quote-comparisons/providers', staff))
      .body;
    expect(
      discovery.find((p: { code: string }) => p.code === 'unishippers')
        .cachedDefault.address,
    ).toEqual(address);
  });
});
