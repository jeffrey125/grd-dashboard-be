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
        counts: {
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
});
