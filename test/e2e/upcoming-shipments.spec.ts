import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { UPCOMING_SOURCE } from '@modules/upcoming-shipments/upcoming.contracts.js';
import { upcomingWindow } from '@modules/upcoming-shipments/upcoming.dates.js';
import { administratorCookie } from '@test/support/authentication.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { configureApiRoutes } from '@runtime/api-routing.js';

let app: INestApplication;
let db: Awaited<ReturnType<typeof shipmentDatabase>>;
let admin: string;
let staff: string;
let accountId: string;
const rep = 'recAAAAAAAAAAAAAA';
const other = 'recBBBBBBBBBBBBBB';
const source = {
  configured: true,
  files: vi.fn(async (id: string) => ({
    requestedShipOn: upcomingWindow().from,
    test: false,
    repIds: [id],
    files: [
      {
        id: 'attFixture',
        filename: 'fixture.pdf',
        type: 'application/pdf',
        size: 10,
        url: 'https://v5.airtableusercontent.com/fixture',
      },
    ],
  })),
  reps: async () => [
    { id: rep, name: 'Fixture rep', email: 'upcoming@example.test' },
    { id: other, name: 'Other rep', email: null },
  ],
  load: async () => ({
    updatedAt: new Date().toISOString(),
    reps: await source.reps(),
    orders: [rep, other].map((id) => ({
      id,
      requestedShipOn: upcomingWindow().from,
      repIds: [id],
      reps: [id],
      salesOrders: [],
      customer: 'Fixture customer',
      customerPo: null,
      tracking: null,
      notes: null,
      pallets: null,
      lines: [],
      airtableUrl: `https://airtable.com/appxyP3yY5YF9plDO/tbl7X5ROha1PzgGZt/${id}`,
    })),
  }),
};

beforeAll(async () => {
  db = await shipmentDatabase();
  for (const [key, value] of Object.entries(db.environment))
    vi.stubEnv(key, value);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(DatabaseModule)
    .useModule(TestDatabaseModule)
    .overrideProvider(DataSource)
    .useValue(db.source)
    .overrideProvider(UPCOMING_SOURCE)
    .useValue(source)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureApiRoutes(app);
  await app.init();
  admin = await administratorCookie(app);
  const auth = app.get(AuthService);
  const actor = await auth.authenticate(new Headers({ cookie: admin }));
  const account = await auth.createAccount(actor, {
    firstName: 'Upcoming',
    lastName: 'Staff',
    email: 'upcoming@example.test',
    password: 'issued upcoming password',
    role: 'staff',
  });
  accountId = account.externalId;
  const cookie = (values: string[]) =>
    values.map((v) => v.split(';')[0]).join('; ');
  const issued = cookie(
    (
      await auth.signIn({
        email: 'upcoming@example.test',
        password: 'issued upcoming password',
      })
    ).cookies,
  );
  await auth.changePassword(
    await auth.authenticate(new Headers({ cookie: issued })),
    {
      currentPassword: 'issued upcoming password',
      newPassword: 'chosen upcoming password',
    },
  );
  staff = cookie(
    (
      await auth.signIn({
        email: 'upcoming@example.test',
        password: 'chosen upcoming password',
      })
    ).cookies,
  );
});
afterAll(async () => {
  await app?.close();
  await db?.close();
  vi.unstubAllEnvs();
});

it('authorizes and persists admin assignments, protects staff reads and rejects foreign filters', async () => {
  const server = app.getHttpServer() as Server;
  await request(server).get('/api/v1/upcoming-shipments').expect(401);
  expect(
    (
      await request(server)
        .get('/api/v1/upcoming-shipments/access')
        .set('Cookie', staff)
        .expect(200)
    ).body.enabled,
  ).toBe(false);
  await request(server)
    .get(`/api/v1/upcoming-shipments/${rep}/files`)
    .expect(401);
  await request(server)
    .get(`/api/v1/upcoming-shipments/${rep}/files`)
    .set('Cookie', staff)
    .expect(403);
  const path = `/api/v1/admin/accounts/${accountId}/upcoming-shipments`;
  await request(server).get(path).set('Cookie', staff).expect(403);
  const suggestion = await request(server)
    .get(path)
    .set('Cookie', admin)
    .expect(200);
  expect(suggestion.body.suggestedRepIds).toEqual([rep]);
  expect(suggestion.body.ownRepId).toBeNull();
  await request(server)
    .patch(path)
    .set('Cookie', staff)
    .set('Origin', 'http://dashboard.example.test')
    .send({ ownRepId: rep, assignedRepIds: [] })
    .expect(403);
  await request(server)
    .patch(path)
    .set('Cookie', admin)
    .set('Origin', 'http://dashboard.example.test')
    .send({ ownRepId: rep, assignedRepIds: [] })
    .expect(200);
  const files = await request(server)
    .get(`/api/v1/upcoming-shipments/${rep}/files`)
    .set('Cookie', staff)
    .expect(200);
  expect(files.headers['cache-control']).toBe('no-store');
  expect(files.body.files[0].filename).toBe('fixture.pdf');
  await request(server)
    .get(`/api/v1/upcoming-shipments/${other}/files`)
    .set('Cookie', staff)
    .expect(404);
  const response = await request(server)
    .get('/api/v1/upcoming-shipments?window=week')
    .set('Cookie', staff)
    .expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.orders.map((row: { id: string }) => row.id)).toEqual([
    rep,
  ]);
  await request(server)
    .get(`/api/v1/upcoming-shipments?repId=${other}`)
    .set('Cookie', staff)
    .expect(403);
  await request(server)
    .patch(path)
    .set('Cookie', admin)
    .set('Origin', 'http://dashboard.example.test')
    .send({ ownRepId: null, assignedRepIds: [rep, other] })
    .expect(200);
  expect(
    (
      await request(server)
        .get('/api/v1/upcoming-shipments')
        .set('Cookie', staff)
        .expect(200)
    ).body.total,
  ).toBe(2);
  const [row] = await db.source.query(
    'SELECT id FROM auth_users WHERE external_id=$1',
    [accountId],
  );
  await expect(
    db.source.query('DELETE FROM auth_users WHERE id=$1', [row.id]),
  ).rejects.toMatchObject({ driverError: { code: '23503' } });
  await request(server)
    .patch(path)
    .set('Cookie', admin)
    .set('Origin', 'http://dashboard.example.test')
    .send({ ownRepId: null, assignedRepIds: [] })
    .expect(200);
  await request(server)
    .get('/api/v1/upcoming-shipments')
    .set('Cookie', staff)
    .expect(403);
});
