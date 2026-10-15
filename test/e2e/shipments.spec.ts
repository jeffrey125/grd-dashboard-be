import { AuthService } from '@modules/auth/auth.service.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
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
import { ShipmentEntity } from '@modules/shipments/shipment.entity.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';

describe('Shipment HTTP API with PostgreSQL', () => {
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
  const create = (items: unknown[]) =>
    http().post('/shipments').send({ items });

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

  it('returns the same safe tracking projection from every Shipment response for Admin and Staff', async () => {
    const created = await create([item('projection-http')]).expect(201);
    const id = created.body.inserted[0].externalId;
    const path = `/shipments/${id}`;
    const queued = await http().post(`${path}/refresh`).expect(202);

    expect((await http().get(path).expect(200)).body).toMatchObject({
      currentTracking: null,
      latestLookup: null,
      latestRun: queued.body,
    });

    const tracking = new TrackingService(
      new TypeOrmTrackingRepository(db.source),
    );
    const target = (await tracking.startRun(queued.body.externalId))
      .targets[0]!;

    await tracking.finalizeFound({
      runExternalId: queued.body.externalId,
      shipmentExternalId: id,
      expectedLockVersion: target.expectedLockVersion,
      effectiveIntervalMinutes: 30,
      snapshot: {
        carrierStatus: 'Moving',
        carrierStatusDetail: null,
        pickedUpOn: '2026-03-08',
        estimatedDeliveryOn: '2026-11-01',
        deliveredOn: null,
      },
      sourceData: { internalCanary: 'private-provider-value' },
    });
    await tracking.finalizeRun(queued.body.externalId);

    const known = (await http().get(path).expect(200)).body;
    const projection = {
      currentTracking: known.currentTracking,
      latestLookup: known.latestLookup,
      latestRun: known.latestRun,
    };

    expect(known.currentTracking).toEqual({
      externalId: expect.any(String),
      carrierStatus: 'Moving',
      carrierStatusDetail: null,
      pickedUpOn: '2026-03-08',
      estimatedDeliveryOn: '2026-11-01',
      deliveredOn: null,
      observedAt: expect.any(String),
    });
    expect(known.latestLookup).toEqual({
      runExternalId: queued.body.externalId,
      outcome: 'found',
      snapshotChanged: true,
      retryable: null,
      reasonCode: null,
      completedAt: expect.any(String),
    });
    expect(known.latestRun).toEqual({
      ...queued.body,
      fetchMode: 'request',
      status: 'succeeded',
      startedAt: expect.any(String),
      completedAt: expect.any(String),
    });
    expect(new Date(known.currentTracking.observedAt).toISOString()).toBe(
      known.currentTracking.observedAt,
    );
    expect(Object.keys(known).sort()).toEqual(
      [
        'externalId',
        'carrier',
        'trackingReference',
        'notes',
        'verificationUrl',
        'currentTracking',
        'latestLookup',
        'latestRun',
        'monitoringStatus',
        'monitoringReason',
        'lastAttemptedAt',
        'nextCheckAt',
        'consecutiveNotFoundCount',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(JSON.stringify(known)).not.toMatch(
      /internalCanary|private-provider-value|sourceData|source_data|snapshotId|requestedById|lockVersion|createdById/,
    );
    expect((await http().get('/shipments').expect(200)).body).toContainEqual(
      known,
    );

    for (const notes of ['Changed', null]) {
      expect(
        (await http().patch(path).send({ notes }).expect(200)).body,
      ).toMatchObject(projection);
    }

    for (const action of ['pause', 'resume']) {
      expect(
        (await http().post(`${path}/${action}`).expect(200)).body,
      ).toMatchObject(projection);
    }

    const duplicate = await create([item('projection-http', 'ignored')]).expect(
      200,
    );
    const mixed = await create([
      item('projection-http'),
      item('projection-new'),
    ]).expect(201);

    expect(duplicate.body.duplicates[0]).toMatchObject({
      ...projection,
      notes: null,
    });
    expect(mixed.body.duplicates[0]).toMatchObject(projection);
    expect(mixed.body.inserted[0]).toMatchObject({
      currentTracking: null,
      latestLookup: null,
      latestRun: null,
    });

    const auth = app.get(AuthService);
    const admin = await auth.authenticate(new Headers({ cookie }));

    await auth.createAccount(admin, {
      firstName: 'Projection',
      lastName: 'Staff',
      email: 'projection@example.test',
      password: 'issued projection password',
      role: 'staff',
    });

    const cookieValue = (cookies: string[]) =>
      cookies.map((value) => value.split(';')[0]).join('; ');
    const restricted = cookieValue(
      (
        await auth.signIn({
          email: 'projection@example.test',
          password: 'issued projection password',
        })
      ).cookies,
    );

    await request(app.getHttpServer() as Server)
      .get(path)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get(path)
      .set('Cookie', restricted)
      .expect(403);

    await auth.changePassword(
      await auth.authenticate(new Headers({ cookie: restricted })),
      {
        currentPassword: 'issued projection password',
        newPassword: 'chosen projection password',
      },
    );

    const staff = cookieValue(
      (
        await auth.signIn({
          email: 'projection@example.test',
          password: 'chosen projection password',
        })
      ).cookies,
    );

    expect(
      (
        await request(app.getHttpServer() as Server)
          .get(path)
          .set('Cookie', staff)
          .expect(200)
      ).body,
    ).toMatchObject(projection);
    expect(
      (
        await request(app.getHttpServer() as Server)
          .patch(path)
          .set('Cookie', staff)
          .set('Origin', 'http://dashboard.example.test')
          .send({ notes: 'Staff notes' })
          .expect(200)
      ).body,
    ).toMatchObject(projection);
    await request(app.getHttpServer() as Server)
      .patch(`/carriers/${carrierExternalId}`)
      .set('Cookie', staff)
      .set('Origin', 'http://dashboard.example.test')
      .send({ name: 'Denied' })
      .expect(403);
  });

  it('serves the static search route with strict query validation and legacy compatibility', async () => {
    const created = await create([
      item('search-http-001', 'Literal %_ search note'),
    ]).expect(201);

    await request(app.getHttpServer() as Server)
      .get('/shipments/search')
      .expect(401);

    const response = await http()
      .get('/shipments/search')
      .query({
        tab: 'all',
        q: '%_ SEARCH',
        page: 1,
        pageSize: 25,
        sortBy: 'trackingReference',
        sortDirection: 'asc',
      })
      .expect('Cache-Control', 'no-store')
      .expect(200);

    expect(response.body).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 1,
      tabCounts: {
        all: 1,
        active: 1,
        paused: 0,
        delivered: 0,
        attention: 0,
      },
    });
    expect(response.body.items).toEqual([
      expect.objectContaining({
        externalId: created.body.inserted[0].externalId,
        trackingReference: 'search-http-001',
      }),
    ]);
    expect(
      Array.isArray((await http().get('/shipments').expect(200)).body),
    ).toBe(true);

    for (const query of [
      { unknown: 'field' },
      { page: 0 },
      { pageSize: 101 },
      { sortBy: 'privateColumn' },
      { createdFrom: '2026-03-09', createdTo: '2026-03-08' },
    ])
      await http().get('/shipments/search').query(query).expect(400);
  });

  it('creates, reads, edits, pauses, resumes and deletes by external UUID', async () => {
    const response = await create([item(' 000Ab ', ' Initial ')])
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const shipment = response.body.inserted[0];
    const path = `/shipments/${shipment.externalId}`;

    expect(shipment).toEqual({
      externalId: expect.any(String),
      carrier: {
        externalId: carrierExternalId,
        code: 'ups',
        name: 'UPS',
        isActive: true,
      },
      trackingReference: '000Ab',
      notes: 'Initial',
      verificationUrl: null,
      currentTracking: null,
      latestLookup: null,
      latestRun: null,
      monitoringStatus: 'active',
      monitoringReason: null,
      consecutiveNotFoundCount: 0,
      lastAttemptedAt: null,
      nextCheckAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(response.body.duplicates).toEqual([]);
    expect((await http().get(path).expect(200)).body).toEqual(shipment);
    expect((await http().get('/shipments').expect(200)).body).toContainEqual(
      shipment,
    );
    expect(
      (await http().patch(path).send({ notes: ' Changed ' }).expect(200)).body
        .notes,
    ).toBe('Changed');
    expect(
      (await http().patch(path).send({ notes: null }).expect(200)).body.notes,
    ).toBeNull();

    await http().post(`${path}/resume`).expect(409);

    expect((await http().post(`${path}/pause`).expect(200)).body).toMatchObject(
      {
        monitoringStatus: 'paused',
        monitoringReason: 'manual',
        nextCheckAt: null,
      },
    );

    await http().post(`${path}/pause`).expect(409);

    expect(
      (await http().post(`${path}/resume`).expect(200)).body,
    ).toMatchObject({
      monitoringStatus: 'active',
      monitoringReason: null,
      nextCheckAt: expect.any(String),
    });

    await http().delete(path).expect(204);
    await http().get(path).expect(404);
    await http().patch(path).send({ notes: 'Cannot revive' }).expect(404);
    await http().post(`${path}/pause`).expect(404);
    await http().post(`${path}/resume`).expect(404);
    await http().delete(path).expect(404);

    const replacement = await create([item('000Ab')]).expect(201);

    expect(replacement.body.inserted[0].externalId).not.toBe(
      shipment.externalId,
    );

    const deleted = await db.source
      .getRepository(ShipmentEntity)
      .findOneOrFail({
        where: { externalId: shipment.externalId },
        withDeleted: true,
      });

    expect(deleted).toMatchObject({
      createdById: expect.any(Number),
      updatedById: expect.any(Number),
      deletedById: expect.any(Number),
    });
  });

  it('uses the last repeated item and distinguishes inserted from existing non-deleted pairs', async () => {
    const response = await create([
      item('repeat', 'first'),
      item(' repeat '),
      item('other', ' keep '),
    ]).expect(201);

    expect(
      response.body.inserted.map((row: { notes: string | null }) => row.notes),
    ).toEqual([null, 'keep']);
    expect(response.body.duplicates).toEqual([]);

    const duplicate = await create([
      item('other', 'must not overwrite'),
      item('new'),
    ]).expect(201);

    expect(duplicate.body.inserted).toHaveLength(1);
    expect(duplicate.body.duplicates).toEqual([response.body.inserted[1]]);

    const all = await create([
      item('repeat'),
      item('repeat'),
      item('other'),
    ]).expect(200);

    expect(all.body.inserted).toEqual([]);
    expect(all.body.duplicates).toHaveLength(2);
  });

  it('returns safe row-specific errors and inserts nothing, including when an earlier repeated row is invalid', async () => {
    const before = (await http().get('/shipments')).body;
    const invalid = await create([
      item('would-be-valid'),
      { ...item('bad'), trackingReference: 123 },
      item('conflicting', 'x'.repeat(501)),
      item('conflicting'),
      { ...item('forbidden'), createdById: 999, CANARY_FIELD: 'CANARY_VALUE' },
    ]).expect(400);

    expect(invalid.body.code).toBe('shipment_validation_failed');
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, field: 'trackingReference' }),
        expect.objectContaining({ row: 3, field: 'notes' }),
        expect.objectContaining({ row: 5, field: 'item' }),
      ]),
    );
    expect(invalid.text).not.toContain('CANARY');
    expect((await http().get('/shipments')).body).toEqual(before);
  });

  it.each([{ items: [] }, { items: Array.from({ length: 11 }, () => ({})) }])(
    'requires 1–10 submitted entries before deduplication',
    async ({ items }) => {
      await create(items).expect(400);
    },
  );

  it('rejects malformed JSON and unknown envelope fields', async () => {
    await http()
      .post('/shipments')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await http()
      .post('/shipments')
      .send({ items: [item('unknown-envelope')], createdById: 1 })
      .expect(400);
  });

  it.each(['1', 'bad-uuid', '00000000-0000-1000-8000-000000000000'])(
    'rejects invalid UUID routes: %s',
    async (id) => {
      await http().get(`/shipments/${id}`).expect(400);
      await http().patch(`/shipments/${id}`).send({ notes: 'x' }).expect(400);
      await http().delete(`/shipments/${id}`).expect(400);
      await http().post(`/shipments/${id}/pause`).expect(400);
    },
  );

  it('returns 404 for an unknown public UUID', async () => {
    const path = '/shipments/00000000-0000-4000-8000-000000000000';

    await http().get(path).expect(404);
    await http().patch(path).send({ notes: null }).expect(404);
    await http().delete(path).expect(404);
    await http().post(`${path}/resume`).expect(404);
  });

  it('accepts limits and rejects notes overflow, blank notes, immutable and actor fields', async () => {
    const response = await create([
      item('x'.repeat(255), 'n'.repeat(500)),
    ]).expect(201);
    const path = `/shipments/${response.body.inserted[0].externalId}`;

    for (const input of [
      {},
      { notes: '' },
      { notes: '   ' },
      { notes: 'n'.repeat(501) },
      { notes: 1 },
      { trackingReference: 'change' },
      { updatedById: 1 },
      { notes: 'x', createdById: 1 },
    ]) {
      await http().patch(path).send(input).expect(400);
    }

    await http().post(`${path}/pause`).send({ updatedById: 1 }).expect(400);

    expect((await http().get(path)).body).toEqual(response.body.inserted[0]);

    await create([item('x'.repeat(256))]).expect(400);
    await create([item('nul\u0000')]).expect(400);
  });

  it('rejects disabled and absent Carriers before any sibling insertion', async () => {
    const carrier = await db.source.getRepository(CarrierEntity).save({
      code: 'http-disabled',
      name: 'Disabled',
      isActive: false,
      pollIntervalMinutes: 5,
    });

    for (const id of [
      carrier.externalId,
      '00000000-0000-4000-8000-000000000000',
    ]) {
      const response = await create([
        item('no-partial-write'),
        { ...item('disabled'), carrierExternalId: id },
      ]).expect(400);

      expect(response.body.details).toEqual([
        { row: 2, field: 'carrierExternalId', message: expect.any(String) },
      ]);
    }

    expect(
      (await http().get('/shipments')).body.some(
        (row: { trackingReference: string }) =>
          row.trackingReference === 'no-partial-write',
      ),
    ).toBe(false);
  });

  it('handles concurrent HTTP creations with one inserted record', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => create([item('http-concurrent')])),
    );

    expect(results.map((result) => result.status).sort()).toEqual([
      200, 200, 200, 201,
    ]);

    const records = results.flatMap((result) => [
      ...result.body.inserted,
      ...result.body.duplicates,
    ]);

    expect(new Set(records.map((row) => row.externalId)).size).toBe(1);
  });

  it('returns a safe 500 and rolls back siblings on an unexpected database error', async () => {
    await db.source.query(
      `ALTER TABLE shipments ADD CONSTRAINT http_test_failure CHECK (tracking_reference <> 'http-db-fail-z')`,
    );

    try {
      const response = await create([
        item('http-db-fail-a'),
        item('http-db-fail-z'),
      ]).expect(500);

      expect(response.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(
        (await http().get('/shipments')).body.some(
          (row: { trackingReference: string }) =>
            row.trackingReference.startsWith('http-db-fail-'),
        ),
      ).toBe(false);
    } finally {
      await db.source.query(
        'ALTER TABLE shipments DROP CONSTRAINT http_test_failure',
      );
    }
  });
});
