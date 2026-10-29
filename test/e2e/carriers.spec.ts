import { SalesRepEmails1793577600000 } from '@infrastructure/database/migrations/1793577600000-SalesRepEmails.js';
import { ManualOtherCarrier1793491200000 } from '@infrastructure/database/migrations/1793491200000-ManualOtherCarrier.js';
import { MonitoringSafeguards1793318400000 } from '@infrastructure/database/migrations/1793318400000-MonitoringSafeguards.js';
import { TrackingReadProjection1792281600000 } from '@infrastructure/database/migrations/1792281600000-TrackingReadProjection.js';
import { TrackingChangeEvents1792368000000 } from '@infrastructure/database/migrations/1792368000000-TrackingChangeEvents.js';
import { SalesRepsAndShipmentFollowUp1792454400000 } from '@infrastructure/database/migrations/1792454400000-SalesRepsAndShipmentFollowUp.js';
import { administratorCookie } from '@test/support/authentication.js';
import { AUTH_ENTITIES } from '@modules/auth/auth.entities.js';
import { EmployeeAuth1792108800000 } from '@infrastructure/database/migrations/1792108800000-EmployeeAuth.js';
import { TrackingEvents1792195200000 } from '@infrastructure/database/migrations/1792195200000-TrackingEvents.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '@app/app.module.js';
import { createConfiguration } from '@config/configuration.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import { InitialSchema1791849600000 } from '@infrastructure/database/migrations/1791849600000-InitialSchema.js';
import { CarrierFetchMode1791936000000 } from '@infrastructure/database/migrations/1791936000000-CarrierFetchMode.js';
import { FfeRequestMode1792022400000 } from '@infrastructure/database/migrations/1792022400000-FfeRequestMode.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { SalesRepEntity } from '@modules/sales-reps/sales-rep.entity.js';
import { ShipmentEntity } from '@modules/shipments/shipment.entity.js';
import { ShipmentTrackingSnapshotEntity } from '@modules/tracking/shipment-tracking-snapshot.entity.js';
import { TrackingRunEntity } from '@modules/tracking/tracking-run.entity.js';
import { TrackingAttemptEntity } from '@modules/tracking/tracking-attempt.entity.js';
import {
  startPostgresqlContainer,
  postgresqlEnvironment,
} from '@test/support/postgresql-container.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { configureApiRoutes } from '@runtime/api-routing.js';

describe('Carrier HTTP API with PostgreSQL', () => {
  let app: INestApplication | undefined;
  let source: DataSource;
  let container: StartedPostgreSqlContainer | undefined;
  let upsId: string;
  let cookie: string;
  const http = () =>
    request
      .agent(app!.getHttpServer() as Server)
      .set('Cookie', cookie)
      .set('Origin', 'http://dashboard.example.test');

  beforeAll(async () => {
    container = await startPostgresqlContainer();

    const environment = postgresqlEnvironment(container);

    for (const [key, value] of Object.entries(environment))
      vi.stubEnv(key, value);

    source = new DataSource({
      ...createDatabaseOptions(createConfiguration(environment)),
      entities: [
        ...AUTH_ENTITIES,
        CarrierEntity,
        SalesRepEntity,
        ShipmentEntity,
        ShipmentTrackingSnapshotEntity,
        TrackingRunEntity,
        TrackingAttemptEntity,
      ],
      migrations: [
        InitialSchema1791849600000,
        CarrierFetchMode1791936000000,
        FfeRequestMode1792022400000,
        EmployeeAuth1792108800000,
        TrackingEvents1792195200000,
        TrackingReadProjection1792281600000,
        TrackingChangeEvents1792368000000,
        SalesRepsAndShipmentFollowUp1792454400000,
        SalesRepEmails1793577600000,
        MonitoringSafeguards1793318400000,
        ManualOtherCarrier1793491200000,
      ],
    });
    await source.initialize();
    await source.runMigrations();

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule)
      .useModule(TestDatabaseModule)
      .overrideProvider(DataSource)
      .useValue(source)
      .compile();

    app = module.createNestApplication();
    configureApiRoutes(app);
    await app.init();
    cookie = await administratorCookie(app);
    upsId = (
      await source.getRepository(CarrierEntity).findOneByOrFail({ code: 'ups' })
    ).externalId;
  });

  afterAll(async () => {
    await app?.close();

    if (source?.isInitialized) await source.destroy();

    await container?.stop();
    vi.unstubAllEnvs();
  });

  it('lists the migration-provisioned Carriers and exposes only public fields', async () => {
    const response = await http()
      .get('/api/v1/carriers')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body.map((row: { code: string }) => row.code)).toEqual([
      'echoship',
      'ffe',
      'other',
      'ups',
    ]);

    const { body } = await http().get(`/api/v1/carriers/${upsId}`).expect(200);

    expect(body).toEqual({
      externalId: upsId,
      code: 'ups',
      name: 'UPS',
      isActive: true,
      failurePauseEnabled: true,
      failurePauseThreshold: 2,
      sessionFailureDisableEnabled: true,
      sessionFailureDisableThreshold: 2,
      consecutiveSessionFailures: 0,
      sessionGeneration: 0,
      autoDisabledReason: null,
      fetchMode: 'request',
      notFoundPauseThreshold: 5,
      pollIntervalMinutes: 30,
      rateLimitPerMinute: 10,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('validates independent monitoring safeguard settings and rejects writes to counters', async () => {
    for (const changes of [
      { failurePauseThreshold: 0 },
      { failurePauseThreshold: 11 },
      { sessionFailureDisableThreshold: 1.5 },
      { failurePauseEnabled: 'false' },
      { consecutiveSessionFailures: 0 },
      { autoDisabledReason: null },
      { sessionGeneration: 0 },
    ])
      await http().patch(`/api/v1/carriers/${upsId}`).send(changes).expect(400);

    const changed = await http()
      .patch(`/api/v1/carriers/${upsId}`)
      .send({
        failurePauseEnabled: false,
        failurePauseThreshold: 3,
        sessionFailureDisableEnabled: false,
        sessionFailureDisableThreshold: 4,
      })
      .expect(200);
    expect(changed.body).toMatchObject({
      failurePauseEnabled: false,
      failurePauseThreshold: 3,
      sessionFailureDisableEnabled: false,
      sessionFailureDisableThreshold: 4,
    });
    await http()
      .patch(`/api/v1/carriers/${upsId}`)
      .send({
        failurePauseEnabled: true,
        failurePauseThreshold: 2,
        sessionFailureDisableEnabled: true,
        sessionFailureDisableThreshold: 2,
      })
      .expect(200);
  });

  it('lets admins configure Sales Reps with reversible soft deletion', async () => {
    const active = await http().get('/api/v1/sales-reps').expect(200);

    expect(active.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          firstName: 'Jake',
          lastName: 'Wald',
          active: true,
        }),
        expect.objectContaining({
          firstName: 'Tom',
          lastName: "O'Brien",
          active: true,
        }),
      ]),
    );
    expect(active.body).toHaveLength(9);

    await http()
      .post('/api/v1/admin/sales-reps')
      .send({ firstName: 'No', lastName: 'Email' })
      .expect(400);

    const created = await http()
      .post('/api/v1/admin/sales-reps')
      .send({ firstName: 'Test', lastName: 'Rep', email: 'test@example.test' })
      .expect(201);

    expect(created.body).toMatchObject({
      firstName: 'Test',
      lastName: 'Rep',
      active: true,
      deletedAt: null,
    });

    const updated = await http()
      .patch(`/api/v1/admin/sales-reps/${created.body.externalId}`)
      .send({ lastName: 'Updated', email: ' UPDATED@Example.test ' })
      .expect(200);

    expect(updated.body).toMatchObject({
      firstName: 'Test',
      lastName: 'Updated',
      email: 'updated@example.test',
    });

    const duplicate = await http()
      .post('/api/v1/admin/sales-reps')
      .send({
        firstName: 'Duplicate',
        lastName: 'Rep',
        email: ' UPDATED@Example.test ',
      })
      .expect(409);
    expect(duplicate.body.message).toBe('Sales Rep email already exists');

    await http()
      .patch(`/api/v1/admin/sales-reps/${created.body.externalId}`)
      .send({ email: ' JAKE@GlobalResourcesDirect.com ' })
      .expect(409);
    expect(
      (
        await http()
          .get(`/api/v1/admin/sales-reps/${created.body.externalId}`)
          .expect(200)
      ).body.email,
    ).toBe('updated@example.test');

    await http()
      .delete(`/api/v1/admin/sales-reps/${created.body.externalId}`)
      .expect(204);
    const inactive = await http()
      .get(`/api/v1/admin/sales-reps/${created.body.externalId}`)
      .expect(200);

    expect(inactive.body).toMatchObject({
      active: false,
      deletedAt: expect.any(String),
    });
    expect(
      (await http().get('/api/v1/sales-reps').expect(200)).body.some(
        (row: { externalId: string }) =>
          row.externalId === created.body.externalId,
      ),
    ).toBe(false);

    await http()
      .post('/api/v1/admin/sales-reps')
      .send({
        firstName: 'Inactive',
        lastName: 'Duplicate',
        email: 'updated@example.test',
      })
      .expect(409);

    const restored = await http()
      .post(`/api/v1/admin/sales-reps/${created.body.externalId}/restore`)
      .send({})
      .expect(201);

    expect(restored.body).toMatchObject({
      firstName: 'Test',
      lastName: 'Updated',
      email: 'updated@example.test',
      active: true,
      deletedAt: null,
    });
  });

  it('updates settings without changing code or UUID, preserves omitted values, and clears the rate limit', async () => {
    const { body } = await http()
      .patch(`/api/v1/carriers/${upsId}`)
      .send({ name: ' UPS renamed ', isActive: false, pollIntervalMinutes: 60 })
      .expect(200);

    expect(body).toMatchObject({
      externalId: upsId,
      code: 'ups',
      name: 'UPS renamed',
      isActive: false,
      pollIntervalMinutes: 60,
      rateLimitPerMinute: 10,
    });

    await http()
      .patch(`/api/v1/carriers/${upsId}`)
      .send({ rateLimitPerMinute: null })
      .expect(200);

    const current = await http().get(`/api/v1/carriers/${upsId}`).expect(200);

    expect(current.body).toMatchObject({
      isActive: false,
      pollIntervalMinutes: 60,
      rateLimitPerMinute: null,
    });
  });

  it('switches EchoShip transport through the API and rejects unsupported modes', async () => {
    const { body } = await http().get('/api/v1/carriers').expect(200);
    const echo = body.find((row: { code: string }) => row.code === 'echoship');

    expect(echo.fetchMode).toBe('request');

    const updated = await http()
      .patch(`/api/v1/carriers/${echo.externalId}`)
      .send({ fetchMode: 'browser' })
      .expect(200);

    expect(updated.body.fetchMode).toBe('browser');

    await http()
      .patch(`/api/v1/carriers/${upsId}`)
      .send({ fetchMode: 'browser' })
      .expect(400);
    await http()
      .patch(`/api/v1/carriers/${echo.externalId}`)
      .send({ fetchMode: 'automatic' })
      .expect(400);
  });

  it('defaults FFE to request and supports explicitly switching both modes', async () => {
    const { body } = await http().get('/api/v1/carriers').expect(200);
    const ffe = body.find((row: { code: string }) => row.code === 'ffe');

    expect(ffe.fetchMode).toBe('request');

    for (const fetchMode of ['browser', 'request']) {
      const updated = await http()
        .patch(`/api/v1/carriers/${ffe.externalId}`)
        .send({ fetchMode })
        .expect(200);

      expect(updated.body.fetchMode).toBe(fetchMode);
    }
  });

  it.each([
    {},
    { id: 1 },
    { code: 'other' },
    { externalId: 'other' },
    { createdById: 1 },
    { deletedAt: new Date().toISOString() },
    { name: '  ' },
    { name: 'Invalid\u0000name' },
    { name: 'a'.repeat(101) },
    { isActive: 'false' },
    { notFoundPauseThreshold: 1 },
    { pollIntervalMinutes: 32768 },
    { rateLimitPerMinute: 0 },
    { name: 'Must not persist', credentials: 'CANARY_CREDENTIAL' },
  ])('rejects invalid or forbidden writes atomically: %j', async (input) => {
    const before = await http().get(`/api/v1/carriers/${upsId}`).expect(200);
    const response = await http()
      .patch(`/api/v1/carriers/${upsId}`)
      .send(input)
      .expect(400);

    expect(response.text).not.toContain('CANARY_CREDENTIAL');

    const after = await http().get(`/api/v1/carriers/${upsId}`).expect(200);

    expect(after.body).toEqual(before.body);
  });

  it('rejects numeric/malformed IDs and returns 404 for missing or deleted UUIDs', async () => {
    for (const id of [
      '1',
      'not-a-uuid',
      '00000000-0000-1000-8000-000000000000',
    ]) {
      await http().get(`/api/v1/carriers/${id}`).expect(400);
      await http()
        .patch(`/api/v1/carriers/${id}`)
        .send({ isActive: true })
        .expect(400);
    }

    const missing = '00000000-0000-4000-8000-000000000000';

    await http().get(`/api/v1/carriers/${missing}`).expect(404);
    await http()
      .patch(`/api/v1/carriers/${missing}`)
      .send({ isActive: true })
      .expect(404);

    const deleted = await source
      .getRepository(CarrierEntity)
      .save({ code: 'retired', name: 'Retired', pollIntervalMinutes: 5 });

    await source
      .getRepository(CarrierEntity)
      .softDelete({ externalId: deleted.externalId });
    await http().get(`/api/v1/carriers/${deleted.externalId}`).expect(404);
    await http()
      .patch(`/api/v1/carriers/${deleted.externalId}`)
      .send({ isActive: true })
      .expect(404);

    const list = await http().get('/api/v1/carriers').expect(200);

    expect(list.body).toHaveLength(4);
  });

  it('has no creation, deletion, or restoration endpoints', async () => {
    await http()
      .post('/api/v1/carriers')
      .send({ name: 'Unsupported' })
      .expect(404);
    await http().delete(`/api/v1/carriers/${upsId}`).expect(404);
    await http().post(`/api/v1/carriers/${upsId}/restore`).expect(404);
    await http().get(`/api/v1/carriers/${upsId}`).expect(200);
  });
});
