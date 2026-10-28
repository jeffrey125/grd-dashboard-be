import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { administratorCookie } from '@test/support/authentication.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { configureApiRoutes } from '@runtime/api-routing.js';

describe('Dashboard HTTP API with PostgreSQL', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let administrator: string;
  let staff: string;

  const cookieValue = (cookies: string[]) =>
    cookies.map((value) => value.split(';')[0]).join('; ');

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
    administrator = await administratorCookie(app);

    const auth = app.get(AuthService);
    const principal = await auth.authenticate(
      new Headers({ cookie: administrator }),
    );

    await auth.createAccount(principal, {
      firstName: 'Dashboard',
      lastName: 'Staff',
      email: 'dashboard-staff@example.test',
      password: 'issued dashboard password',
      role: 'staff',
    });

    const issued = cookieValue(
      (
        await auth.signIn({
          email: 'dashboard-staff@example.test',
          password: 'issued dashboard password',
        })
      ).cookies,
    );

    await auth.changePassword(
      await auth.authenticate(new Headers({ cookie: issued })),
      {
        currentPassword: 'issued dashboard password',
        newPassword: 'chosen dashboard password',
      },
    );

    staff = cookieValue(
      (
        await auth.signIn({
          email: 'dashboard-staff@example.test',
          password: 'chosen dashboard password',
        })
      ).cookies,
    );
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
    vi.unstubAllEnvs();
  });

  it('allows Staff and Admin, rejects anonymous requests, and emits no-store', async () => {
    const carrier = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/shipments')
      .set('Cookie', administrator)
      .set('Origin', 'http://dashboard.example.test')
      .send({
        carrierExternalId: carrier.externalId,
        trackingReference: 'dashboard-http',
      })
      .expect(201);
    const [shipment]: Array<{ id: number }> = await db.source.query(
      'SELECT id FROM shipments WHERE external_id = $1',
      [created.body.shipment.externalId],
    );

    await db.source.query(
      `INSERT INTO shipment_tracking_snapshots
        (shipment_id, carrier_status, estimated_delivery_on, observed_at)
       VALUES ($1, 'Moving', NULL, '2026-10-16T00:00:00Z')`,
      [shipment!.id],
    );

    await request(app.getHttpServer() as Server)
      .get('/api/v1/dashboard/overview')
      .expect(401);

    for (const cookie of [administrator, staff]) {
      const response = await request(app.getHttpServer() as Server)
        .get('/api/v1/dashboard/overview')
        .set('Cookie', cookie)
        .expect('Cache-Control', 'no-store')
        .expect(200);

      expect(response.body).toEqual({
        asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        timezone: 'America/New_York',
        upcomingWindow: {
          from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
        upcomingDeliveries: { total: 0, items: [] },
        counts: {
          other: 0,
          all: 1,
          active: 1,
          paused: 0,
          delivered: 0,
          attention: 0,
        },
        attention: { total: 0, items: [] },
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /sourceData|source_data|shipmentId|carrierId|lockVersion|createdById/,
      );
    }
  });

  it('filters Mine by authenticated creator across search, counts and overview without restricting shared access', async () => {
    const server = app.getHttpServer() as Server;
    const auth = app.get(AuthService);
    const adminPrincipal = await auth.authenticate(
      new Headers({ cookie: administrator }),
    );
    const carrier = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
    const own = await request(server)
      .post('/api/v1/shipments')
      .set('Cookie', staff)
      .set('Origin', 'http://dashboard.example.test')
      .send({
        carrierExternalId: carrier.externalId,
        trackingReference: 'staff-owned',
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/shipments/${own.body.shipment.externalId}/pause`)
      .set('Cookie', staff)
      .set('Origin', 'http://dashboard.example.test')
      .send({})
      .expect(200);
    await db.source.query(
      `INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, estimated_delivery_on, observed_at)
       SELECT id, 'Moving', (now() AT TIME ZONE 'America/New_York')::date, now()
       FROM shipments WHERE external_id = $1`,
      [own.body.shipment.externalId],
    );
    await db.source.query(
      `UPDATE shipments SET current_tracking_snapshot_id = snapshot.id
       FROM shipment_tracking_snapshots snapshot
       WHERE shipments.id = snapshot.shipment_id AND shipments.external_id = $1`,
      [own.body.shipment.externalId],
    );
    await db.source.query(
      `INSERT INTO shipments (carrier_id, tracking_reference, created_by_id)
       SELECT $1, 'admin-scope-' || n, $2 FROM generate_series(1, 27) n`,
      [carrier.id, adminPrincipal.id],
    );
    await db.source.query(
      `INSERT INTO shipments (carrier_id, tracking_reference) VALUES ($1, 'unknown-creator')`,
      [carrier.id],
    );

    const read = (path: string, cookie: string) =>
      request(server).get(path).set('Cookie', cookie).expect(200);
    const mine = await read(
      '/api/v1/shipments/search?scope=mine&tab=all',
      staff,
    );
    expect(mine.body.total).toBe(1);
    expect(
      mine.body.items.map((row: { externalId: string }) => row.externalId),
    ).toEqual([own.body.shipment.externalId]);
    expect(mine.body.tabCounts).toMatchObject({
      all: 1,
      active: 0,
      attention: 1,
      paused: 1,
    });
    const page = await read(
      '/api/v1/shipments/search?scope=mine&tab=all&page=2',
      administrator,
    );
    expect(page.body.total).toBe(28);
    expect(page.body.items).toHaveLength(3);
    expect(
      page.body.items.every(
        (row: { createdBy: { externalId: string } }) =>
          row.createdBy.externalId === adminPrincipal.externalId,
      ),
    ).toBe(true);
    const everyone = await read(
      '/api/v1/shipments/search?scope=everyone&tab=all',
      staff,
    );
    expect(everyone.body.total).toBe(30);
    const filtered = await read(
      '/api/v1/shipments/search?scope=mine&tab=all&q=admin-scope',
      staff,
    );
    expect(filtered.body.total).toBe(0);
    expect(filtered.body.tabCounts.all).toBe(0);

    const overview = await read('/api/v1/dashboard/overview?scope=mine', staff);
    expect(overview.body.counts).toEqual(mine.body.tabCounts);
    expect(overview.body.attention.total).toBe(1);
    expect(overview.body.upcomingDeliveries.total).toBe(1);
    expect(overview.body.upcomingDeliveries.items[0].externalId).toBe(
      own.body.shipment.externalId,
    );
    expect(
      (await read('/api/v1/dashboard/overview?scope=everyone', staff)).body
        .counts.all,
    ).toBe(30);
    expect(
      (await read('/api/v1/dashboard/overview?scope=mine', administrator)).body
        .counts.all,
    ).toBe(28);

    const duplicate = await request(server)
      .post('/api/v1/shipments')
      .set('Cookie', staff)
      .set('Origin', 'http://dashboard.example.test')
      .send({
        carrierExternalId: carrier.externalId,
        trackingReference: 'dashboard-http',
      })
      .expect(200);
    expect(duplicate.body.outcome).toBe('existing');
    expect(duplicate.body.shipment.createdBy.externalId).toBe(
      adminPrincipal.externalId,
    );
    await read(
      `/api/v1/shipments/${duplicate.body.shipment.externalId}`,
      staff,
    );
    await request(server)
      .patch(`/api/v1/shipments/${duplicate.body.shipment.externalId}`)
      .set('Cookie', staff)
      .set('Origin', 'http://dashboard.example.test')
      .send({ notes: 'Shared editing remains available' })
      .expect(200);
    expect(
      (await read('/api/v1/shipments/search?scope=mine&tab=all', staff)).body
        .total,
    ).toBe(1);

    for (const endpoint of ['/shipments/search', '/dashboard/overview']) {
      for (const query of [
        'scope=invalid',
        'scope=mine&scope=everyone',
        'scope=mine&createdById=1',
      ])
        await request(server)
          .get(`/api/v1${endpoint}?${query}`)
          .set('Cookie', staff)
          .expect(400);
      await request(server).get(`/api/v1${endpoint}?scope=mine`).expect(401);
    }
  });
});
