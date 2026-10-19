import { SenderDefaultsWorker } from '@modules/shipping-quotes/sender-defaults.worker.js';
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

describe('Saved quote comparisons HTTP API', () => {
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

  it('saves and reopens exact inputs without requesting rates', async () => {
    const body = input();
    const saved = await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test')
      .send(body)
      .expect(201);
    expect(saved.body.comparison).toMatchObject({
      status: 'queued',
      ratesRun: false,
      input: body,
    });
    const reopened = await request(app.getHttpServer() as Server)
      .get(`/api/v1/quote-comparisons/${saved.body.comparison.externalId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(reopened.body).toEqual(saved.body.comparison);
  });

  it('exposes provider execution modes needed for dimension validation', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/quote-comparisons/providers')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unishippers',
          executionMode: 'request',
          usedInternationally: true,
          internationalAvailable: false,
          supportsSignature: false,
          supportsInsurance: false,
        }),
        expect.objectContaining({
          code: 'amazon',
          usedInternationally: false,
        }),
      ]),
    );
  });

  it('rejects Amazon before queueing while an eligible international provider continues', async () => {
    await db.source.query(
      "UPDATE shipping_providers SET execution_mode='browser' WHERE code='unishippers'",
    );
    try {
      const body = {
        ...input(),
        destination: {
          ...input().destination,
          country: 'CA',
          division: 'British Columbia',
          postalCode: 'V2T 0J8',
          contactName: 'Nichol Hood',
          phone: '2077627747',
        },
        international: {
          contentsDescription: 'Flour',
          customsMode: 'detailed',
          totalValue: { amount: '12.000000', currency: 'USD' },
        },
        providers: [
          input().providers[0],
          {
            code: 'unishippers',
            sender: {
              mode: 'explicit',
              address: {
                ...address,
                contactName: 'Shipping Contact',
                phone: '2025550147',
              },
            },
            options: {
              signature: 'signature',
              insurance: { amount: '50.00', currency: 'USD' },
            },
          },
        ],
        packageGroups: [
          {
            ...input().packageGroups[0],
            quantity: 3,
            units: 'metric',
            customsItems: [
              {
                description: 'Flour bag',
                quantity: 2,
                unitValue: '2.00',
                currency: 'USD',
                countryOfManufacture: 'CA',
                weight: '0.5',
              },
            ],
          },
        ],
      };
      const saved = await request(app.getHttpServer() as Server)
        .post('/api/v1/quote-comparisons')
        .set('Cookie', cookie)
        .set('Origin', 'http://dashboard.example.test')
        .send(body)
        .expect(201);

      expect(saved.body.comparison.status).toBe('queued');
      expect(saved.body.comparison.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'amazon',
            status: 'failed',
            outcome: 'unsupported',
            reasonCode: 'unsupported',
          }),
          expect.objectContaining({
            provider: 'unishippers',
            status: 'queued',
            conversionSnapshot: expect.objectContaining({
              policy: expect.objectContaining({ rounding: 'half_up' }),
              packageGroups: [
                expect.objectContaining({
                  original: expect.objectContaining({ length: '10.00' }),
                  provider: expect.objectContaining({ length: '3.937008' }),
                }),
              ],
            }),
          }),
        ]),
      );
    } finally {
      await db.source.query(
        "UPDATE shipping_providers SET execution_mode='request' WHERE code='unishippers'",
      );
    }
  });

  it('allows blank dimensions only for myUnishippers request mode', async () => {
    const blankDimensions = {
      ...input(),
      providers: [
        {
          ...input().providers[0],
          code: 'unishippers',
        },
      ],
      packageGroups: [
        {
          ...input().packageGroups[0],
          length: '',
          width: '',
          height: '',
        },
      ],
    };
    const saved = await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test')
      .send(blankDimensions)
      .expect(201);
    const reopened = await request(app.getHttpServer() as Server)
      .get(`/api/v1/quote-comparisons/${saved.body.comparison.externalId}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(reopened.body.input.packageGroups[0]).toMatchObject({
      length: '',
      width: '',
      height: '',
    });

    await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test')
      .send({
        ...blankDimensions,
        idempotencyKey: randomUUID(),
        packageGroups: [{ ...blankDimensions.packageGroups[0], length: '10' }],
      })
      .expect(400);

    await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test')
      .send({
        ...blankDimensions,
        idempotencyKey: randomUUID(),
        providers: input().providers,
      })
      .expect(400);

    await db.source.query(
      "UPDATE shipping_providers SET execution_mode='browser' WHERE code='unishippers'",
    );
    try {
      await request(app.getHttpServer() as Server)
        .post('/api/v1/quote-comparisons')
        .set('Cookie', cookie)
        .set('Origin', 'http://dashboard.example.test')
        .send({ ...blankDimensions, idempotencyKey: randomUUID() })
        .expect(400);
    } finally {
      await db.source.query(
        "UPDATE shipping_providers SET execution_mode='request' WHERE code='unishippers'",
      );
    }
  });

  it('deduplicates concurrent saves, rejects changed payloads, and allows deliberate copies', async () => {
    const body = input();
    const save = (data: object) =>
      request(app.getHttpServer() as Server)
        .post('/api/v1/quote-comparisons')
        .set('Cookie', cookie)
        .set('Origin', 'http://dashboard.example.test')
        .send(data);
    const results = await Promise.all([save(body), save(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.comparison.externalId).toBe(
      results[1].body.comparison.externalId,
    );
    await save({ ...body, shipDate: '2099-10-20' }).expect(409);
    const copy = await save({ ...body, idempotencyKey: randomUUID() }).expect(
      201,
    );
    expect(copy.body.comparison.externalId).not.toBe(
      results[0].body.comparison.externalId,
    );
  });

  it('preserves myUnishippers contact inputs in immutable comparison snapshots', async () => {
    const body = {
      ...input(),
      destination: {
        ...input().destination,
        contactName: 'Receiving Contact',
        phone: '+1 (202) 555-0148',
      },
      providers: [
        {
          ...input().providers[0],
          code: 'unishippers',
          sender: {
            mode: 'explicit',
            address: {
              ...address,
              contactName: 'Shipping Contact',
              phone: '2025550147',
            },
          },
        },
      ],
    };
    const saved = await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test')
      .send(body)
      .expect(201);
    const reopened = await request(app.getHttpServer() as Server)
      .get(`/api/v1/quote-comparisons/${saved.body.comparison.externalId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(reopened.body.input).toEqual(body);
    expect(reopened.body.senders[0].address).toEqual(
      body.providers[0].sender.address,
    );
    await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test')
      .send({
        ...body,
        idempotencyKey: randomUUID(),
        destination: { ...body.destination, phone: 'not a phone' },
      })
      .expect(400);
  });

  it('validates inputs and requires authentication and trusted origin', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/quote-comparisons')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .send(input())
      .expect(403);
    for (const body of [
      { ...input(), shipDate: '2000-01-01' },
      { ...input(), providers: [] },
      {
        ...input(),
        packageGroups: [{ ...input().packageGroups[0], quantity: 0 }],
      },
      { ...input(), destination: { ...address, country: 'CA' } },
      { ...input(), token: 'forbidden' },
    ])
      await request(app.getHttpServer() as Server)
        .post('/api/v1/quote-comparisons')
        .set('Cookie', cookie)
        .set('Origin', 'http://dashboard.example.test')
        .send(body)
        .expect(400);
  });

  it('makes snapshot input immutable in PostgreSQL and queues attempts without creating shipments', async () => {
    const body = input();
    const saved = await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test')
      .send(body)
      .expect(201);
    await expect(
      db.source.query(
        "UPDATE quote_requests SET input='{}' WHERE external_id=$1",
        [saved.body.comparison.externalId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    const [counts] = await db.source.query(
      "SELECT (SELECT count(*)::int FROM shipments) shipments, (SELECT count(*)::int FROM quote_provider_attempts WHERE status IN ('queued','running')) active",
    );
    expect(counts.shipments).toBe(0);
    expect(counts.active).toBeGreaterThan(0);
  });
  it('preserves the reviewed default even after another refresh and fails closed on refresh errors', async () => {
    let current = { ...address };
    let failed = false;
    const worker = new SenderDefaultsWorker(
      new TypeOrmSenderDefaultsRepository(db.source),
      {
        read: async () => {
          if (failed) throw new Error('fixture provider failure');
          return current;
        },
      },
    );
    worker.onModuleInit();
    try {
      const refresh = () =>
        request(app.getHttpServer() as Server)
          .post('/api/v1/quote-comparisons/providers/amazon/default-refresh')
          .set('Cookie', cookie)
          .set('Origin', 'http://dashboard.example.test')
          .send({});
      const first = await refresh().expect(201);
      current = { ...address, street: '2 Different Street' };
      await refresh().expect(201);
      const body = {
        ...input(),
        providers: [
          {
            ...input().providers[0],
            sender: {
              mode: 'account_default',
              refreshId: first.body.refreshId,
            },
          },
        ],
      };
      const saved = await request(app.getHttpServer() as Server)
        .post('/api/v1/quote-comparisons')
        .set('Cookie', cookie)
        .set('Origin', 'http://dashboard.example.test')
        .send(body)
        .expect(201);
      expect(saved.body.comparison.senders[0]).toMatchObject({
        address,
        retrievedAt: first.body.retrievedAt,
        mode: 'account_default',
      });
      failed = true;
      await refresh().expect(503);
      await request(app.getHttpServer() as Server)
        .post('/api/v1/quote-comparisons')
        .set('Cookie', cookie)
        .set('Origin', 'http://dashboard.example.test')
        .send(input())
        .expect(201);
    } finally {
      worker.onModuleDestroy();
    }
  });

  it('allows another staff member to read history and rejects disabled providers', async () => {
    const auth = app.get(AuthService);
    const principal = await auth.authenticate(new Headers({ cookie }));
    await auth.createAccount(principal, {
      firstName: 'Quote',
      lastName: 'Staff',
      email: 'quotes-staff@example.test',
      password: 'issued fixture password',
      role: 'staff',
    });
    const toCookie = (values: string[]) =>
      values.map((v) => v.split(';')[0]).join('; ');
    const issued = toCookie(
      (
        await auth.signIn({
          email: 'quotes-staff@example.test',
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
    const staff = toCookie(
      (
        await auth.signIn({
          email: 'quotes-staff@example.test',
          password: 'chosen fixture password',
        })
      ).cookies,
    );
    const list = await request(app.getHttpServer() as Server)
      .get('/api/v1/quote-comparisons')
      .set('Cookie', staff)
      .expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/quote-comparisons/${list.body.items[0].externalId}`)
      .set('Cookie', staff)
      .expect(200);
    await db.source.query(
      "UPDATE shipping_providers SET enabled=false WHERE code='amazon'",
    );
    await request(app.getHttpServer() as Server)
      .post('/api/v1/quote-comparisons')
      .set('Cookie', staff)
      .set('Origin', 'http://dashboard.example.test')
      .send(input())
      .expect(400);
    await db.source.query(
      "UPDATE shipping_providers SET enabled=true WHERE code='amazon'",
    );
  });

  it('isolates comparison streams, refetches after reconnect, and closes revoked or inaccessible resources', async () => {
    const save = async () =>
      (
        await request(app.getHttpServer() as Server)
          .post('/api/v1/quote-comparisons')
          .set('Cookie', cookie)
          .set('Origin', 'http://dashboard.example.test')
          .send(input())
          .expect(201)
      ).body.comparison.externalId as string;
    const firstId = await save();
    const otherId = await save();
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/quote-comparisons/${firstId}/events`)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/quote-comparisons/${randomUUID()}/events`)
      .set('Cookie', cookie)
      .expect(404);

    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const connect = async () => {
      const controller = new AbortController();
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/quote-comparisons/${firstId.toUpperCase()}/events`,
        {
          headers: { Cookie: cookie },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(25000),
          ]),
        },
      );
      expect(response.status).toBe(200);
      const frames: string[] = [];
      let ended = false;
      const reader = response.body!.getReader();
      const pump = (async () => {
        let buffer = '';
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            frames.push(buffer.slice(0, end).trimStart());
            buffer = buffer.slice(end + 2);
          }
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          ended = true;
        });
      return {
        frames,
        ended: () => ended,
        close: async () => {
          controller.abort();
          await pump;
        },
      };
    };
    const first = await connect();
    try {
      await vi.waitFor(() =>
        expect(
          first.frames.filter((f) => f.startsWith('event: resync')),
        ).toHaveLength(2),
      );
      await db.source.query(
        `UPDATE quote_provider_attempts SET status='failed',outcome='failed',reason_code='adapter_unavailable',completed_at=now()
        WHERE request_id IN (SELECT id FROM quote_requests WHERE external_id=ANY($1::uuid[]))`,
        [[otherId, firstId]],
      );
      await vi.waitFor(() =>
        expect(first.frames.some((f) => f.includes(firstId))).toBe(true),
      );
      expect(first.frames.join('')).not.toContain(otherId);
      expect(first.frames.join('')).not.toContain('sender');
    } finally {
      await first.close();
    }

    const second = await connect();
    try {
      await vi.waitFor(() =>
        expect(second.frames.some((f) => f.startsWith('event: resync'))).toBe(
          true,
        ),
      );
      const snapshot = await request(app.getHttpServer() as Server)
        .get(`/api/v1/quote-comparisons/${firstId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(snapshot.body.attempts[0].reasonCode).toBe('adapter_unavailable');
      await db.source.query(
        'UPDATE quote_requests SET deleted_at=now() WHERE external_id=$1',
        [firstId],
      );
      await db.source.query("SELECT pg_notify('grd_changes',$1)", [
        JSON.stringify({ type: 'quote.changed', externalId: firstId }),
      ]);
      await vi.waitFor(() => expect(second.ended()).toBe(true));
    } finally {
      await second.close();
    }

    await db.source.query(
      'UPDATE quote_requests SET deleted_at=NULL WHERE external_id=$1',
      [firstId],
    );
    const third = await connect();
    try {
      await vi.waitFor(() => expect(third.frames.length).toBeGreaterThan(0));
      await request(app.getHttpServer() as Server)
        .post('/api/v1/auth/sign-out')
        .set('Cookie', cookie)
        .set('Origin', 'http://dashboard.example.test')
        .expect(204);
      await db.source.query("SELECT pg_notify('grd_changes',$1)", [
        JSON.stringify({ type: 'quote.changed', externalId: firstId }),
      ]);
      await vi.waitFor(() => expect(third.ended()).toBe(true));
    } finally {
      await third.close();
    }
  });
});
