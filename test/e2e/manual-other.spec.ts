import { reconcileDeliveredMonitoring } from '@modules/shipments/typeorm-delivered-monitoring.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { TypeOrmTrackingWorkRepository } from '@modules/tracking/typeorm-tracking-work.repository.js';

import { administratorCookie } from '@test/support/authentication.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';

import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { configureApiRoutes } from '@runtime/api-routing.js';

describe('Manual Other carrier HTTP workflow', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let app: INestApplication;
  let carrierExternalId: string;
  let cookie: string;
  const http = () =>
    request
      .agent(app.getHttpServer() as Server)
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test');
  const item = (trackingReference: string, notes?: string | null) => ({
    carrierExternalId,
    trackingReference,
    ...(notes === undefined ? {} : { notes }),
  });
  const create = (shipment: Record<string, unknown>) =>
    http().post('/api/v1/shipments').send(shipment);

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
    cookie = await administratorCookie(app);
    carrierExternalId = (
      await db.source
        .getRepository(CarrierEntity)
        .findOneByOrFail({ code: 'ups' })
    ).externalId;
  });
  afterAll(async () => {
    await app?.close();
    await db?.close();
    vi.unstubAllEnvs();
  });

  it('lets Staff manage manual history, delivery corrections, follow-ups and disabled existing records', async () => {
    const adminCookie = cookie;
    const carriers = (await http().get('/api/v1/carriers').expect(200)).body;
    const other = carriers.find(
      (row: { code: string }) => row.code === 'other',
    );
    const automatedId = carrierExternalId;
    carrierExternalId = other.externalId;
    const auth = app.get(AuthService);
    const admin = await auth.authenticate(new Headers({ cookie }));
    await auth.createAccount(admin, {
      firstName: 'Manual',
      lastName: 'Staff',
      role: 'staff',
      email: 'manual@example.test',
      password: 'issued manual password',
    });
    const cookies = (values: string[]) =>
      values.map((value) => value.split(';')[0]).join('; ');
    cookie = cookies(
      (
        await auth.signIn({
          email: 'manual@example.test',
          password: 'issued manual password',
        })
      ).cookies,
    );
    await auth.changePassword(
      await auth.authenticate(new Headers({ cookie })),
      {
        currentPassword: 'issued manual password',
        newPassword: 'chosen manual password',
      },
    );
    cookie = cookies(
      (
        await auth.signIn({
          email: 'manual@example.test',
          password: 'chosen manual password',
        })
      ).cookies,
    );
    const staffCookie = cookie;
    const [{ today }] = await db.source.query(
      "SELECT (clock_timestamp() AT TIME ZONE 'America/New_York')::date::text AS today",
    );
    const created = (
      await create({ ...item('manual-http'), followUpOn: today }).expect(201)
    ).body.shipment;
    const path = `/api/v1/shipments/${created.externalId}`;
    expect(created).toMatchObject({
      nextCheckAt: null,
      latestLookup: null,
      latestRun: null,
      currentTracking: {
        carrierStatus: 'Pending Pickup',
        pickedUpOn: null,
        estimatedDeliveryOn: null,
        deliveredOn: null,
      },
    });
    expect((await create(item('manual-http')).expect(200)).body.outcome).toBe(
      'existing',
    );
    await http().post(`${path}/refresh`).expect(409);
    await http().post(`${path}/pause`).expect(409);
    const search = async (tab: string) =>
      (
        await http()
          .get('/api/v1/shipments/search')
          .query({ tab, q: 'manual-http' })
          .expect(200)
      ).body;
    expect((await search('other')).total).toBe(1);
    expect((await search('attention')).total).toBe(1);
    expect((await search('active')).total).toBe(0);
    expect((await search('delivered')).total).toBe(0);
    const manualTracking = {
      carrierStatus: 'Delivered',
      pickedUpOn: today,
      estimatedDeliveryOn: today,
    };
    const delivered = (
      await http().patch(path).send({ manualTracking }).expect(200)
    ).body;
    expect(delivered).toMatchObject({
      monitoringStatus: 'completed',
      nextCheckAt: null,
      currentTracking: { ...manualTracking, deliveredOn: today },
    });
    expect(delivered.recordUpdatedBy.email).toBeUndefined();
    expect(delivered.recordUpdatedBy.firstName).toBe('Manual');
    expect((await search('attention')).total).toBe(1);
    expect((await search('delivered')).total).toBe(1);
    expect(await search('other')).toMatchObject({
      total: 0,
      tabCounts: { other: 0, delivered: 1 },
    });
    expect(
      (await http().get('/api/v1/dashboard/overview').expect(200)).body.counts,
    ).toMatchObject({ other: 0, attention: 1, active: 0, delivered: 1 });
    const [{ tomorrow }] = await db.source.query(
      "SELECT ((clock_timestamp() AT TIME ZONE 'America/New_York')::date + 1)::text AS tomorrow",
    );
    await http().patch(path).send({ followUpOn: tomorrow }).expect(200);
    await reconcileDeliveredMonitoring(db.source.manager);
    expect((await http().get(path).expect(200)).body).toMatchObject({
      monitoringStatus: 'completed',
      nextCheckAt: null,
    });
    expect((await search('attention')).total).toBe(0);
    await http().patch(path).send({ followUpOn: today }).expect(200);
    await http().patch(path).send({ manualTracking }).expect(200);
    expect((await http().get(`${path}/history`).expect(200)).body.total).toBe(
      2,
    );
    const reopened = (
      await http()
        .patch(path)
        .send({
          manualTracking: {
            ...manualTracking,
            carrierStatus: 'Out for delivery',
          },
        })
        .expect(200)
    ).body;
    expect(reopened).toMatchObject({
      monitoringStatus: 'active',
      nextCheckAt: null,
      currentTracking: {
        deliveredOn: null,
        estimatedDeliveryOn: today,
        pickedUpOn: today,
      },
    });
    expect((await http().get(`${path}/history`).expect(200)).body.total).toBe(
      3,
    );
    expect(await search('other')).toMatchObject({
      total: 1,
      tabCounts: { other: 1, delivered: 0 },
    });
    expect((await search('delivered')).total).toBe(0);
    expect(
      (await http().get('/api/v1/dashboard/overview').expect(200)).body.counts,
    ).toMatchObject({ other: 1, delivered: 0 });
    const work = new TypeOrmTrackingWorkRepository(db.source);
    await db.source.query(
      'UPDATE shipments SET next_check_at = now() WHERE external_id = $1',
      [created.externalId],
    );
    expect(await work.findDue(other.externalId, 0)).toEqual([]);
    await db.source.query(
      'UPDATE shipments SET next_check_at = NULL WHERE external_id = $1',
      [created.externalId],
    );
    await http()
      .patch(`/api/v1/carriers/${other.externalId}`)
      .send({ isActive: false })
      .expect(403);
    cookie = adminCookie;
    await http()
      .patch(`/api/v1/carriers/${other.externalId}`)
      .send({ name: 'Renamed' })
      .expect(400);
    await http()
      .patch(`/api/v1/carriers/${other.externalId}`)
      .send({ pollIntervalMinutes: 5 })
      .expect(400);
    await http()
      .patch(`/api/v1/carriers/${other.externalId}`)
      .send({ isActive: false })
      .expect(200);
    cookie = staffCookie;
    await create(item('manual-disabled')).expect(400);
    await http()
      .patch(path)
      .send({
        manualTracking: { ...manualTracking, carrierStatus: 'Pickedup' },
        followUpOn: null,
      })
      .expect(200);
    expect((await search('other')).total).toBe(1);
    expect((await search('attention')).total).toBe(0);
    // No manual field can edit an automatically tracked carrier.
    carrierExternalId = automatedId;
    await create({ ...item('manual-invalid-auto'), manualTracking }).expect(
      400,
    );
    const auto = (await create(item('manual-auto')).expect(201)).body.shipment;
    await http()
      .patch(`/api/v1/shipments/${auto.externalId}`)
      .send({ manualTracking })
      .expect(400);
    await http()
      .patch(path)
      .send({ manualTracking: { ...manualTracking, carrierStatus: 'Unknown' } })
      .expect(400);
    await http()
      .patch(path)
      .send({ manualTracking: { ...manualTracking, pickedUpOn: '2026-02-30' } })
      .expect(400);
    await http().patch(path).send({ followUpOn: '2020-01-01' }).expect(400);
  });
  it('refuses to roll back the seeded carrier while manual shipments reference it', async () => {
    await expect(db.source.undoLastMigration()).rejects.toThrow();
    const [row] = await db.source.query(
      "SELECT count(*)::int AS count FROM shipments s JOIN carriers c ON c.id = s.carrier_id WHERE c.code = 'other'",
    );
    expect(row.count).toBeGreaterThan(0);
    expect(await db.source.showMigrations()).toBe(false);
  });
});
