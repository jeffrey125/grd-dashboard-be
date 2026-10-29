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
import { configureApiRoutes } from '@runtime/api-routing.js';

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

  it('returns the same safe tracking projection from every Shipment response for Admin and Staff', async () => {
    const created = await create({
      ...item('projection-http'),
      poNumber: '000A',
      customer: 'Test customer',
      vendor: 'Test vendor',
    }).expect(201);
    const id = created.body.shipment.externalId;
    const path = `/api/v1/shipments/${id}`;
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
      poNumber: '000A',
      customer: 'Test customer',
      vendor: 'Test vendor',
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
        'poNumber',
        'customer',
        'vendor',
        'notes',
        'salesRep',
        'followUpOn',
        'createdBy',
        'updatedBy',
        'recordUpdatedAt',
        'recordUpdatedBy',
        'verificationUrl',
        'currentTracking',
        'latestLookup',
        'latestRun',
        'monitoringStatus',
        'monitoringReason',
        'lastAttemptedAt',
        'nextCheckAt',
        'consecutiveNotFoundCount',
        'consecutiveFailureCount',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(JSON.stringify(known)).not.toMatch(
      /internalCanary|private-provider-value|sourceData|source_data|snapshotId|requestedById|lockVersion|createdById/,
    );
    expect(
      (await http().get('/api/v1/shipments').expect(200)).body,
    ).toContainEqual(known);

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

    const duplicate = await create(item('projection-http', 'ignored')).expect(
      200,
    );
    const createdNew = await create(item('projection-new')).expect(201);

    expect(duplicate.body).toMatchObject({
      outcome: 'existing',
      shipment: {
        ...projection,
        notes: null,
      },
    });
    expect(createdNew.body.outcome).toBe('created');
    expect(createdNew.body.shipment).toMatchObject({
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
          .send({
            notes: 'Staff notes',
            poNumber: ' 000A ',
            customer: 'Test customer',
            vendor: 'Test vendor',
          })
          .expect(200)
      ).body,
    ).toMatchObject(projection);
    await request(app.getHttpServer() as Server)
      .patch(`/api/v1/carriers/${carrierExternalId}`)
      .set('Cookie', staff)
      .set('Origin', 'http://dashboard.example.test')
      .send({ name: 'Denied' })
      .expect(403);
  });

  it('exposes safe inactive filter options to staff and accepts only the new multi-rep query', async () => {
    const rep = (
      await http()
        .post('/api/v1/admin/sales-reps')
        .send({
          firstName: 'Filter',
          lastName: 'Inactive',
          email: 'filter@example.test',
        })
        .expect(201)
    ).body;
    const assigned = await create({
      ...item('multi-rep-http'),
      salesRepExternalId: rep.externalId,
    }).expect(201);
    await http()
      .delete(`/api/v1/admin/sales-reps/${rep.externalId}`)
      .expect(204);
    const auth = app.get(AuthService);
    const admin = await auth.authenticate(new Headers({ cookie }));
    await auth.createAccount(admin, {
      firstName: 'Filter',
      lastName: 'Staff',
      role: 'staff',
      email: 'rep-filter@example.test',
      password: 'issued filter password',
    });
    const cookieValue = (cookies: string[]) =>
      cookies.map((value) => value.split(';')[0]).join('; ');
    const restricted = cookieValue(
      (
        await auth.signIn({
          email: 'rep-filter@example.test',
          password: 'issued filter password',
        })
      ).cookies,
    );
    await request(app.getHttpServer() as Server)
      .get('/api/v1/sales-reps/filter-options')
      .set('Cookie', restricted)
      .expect(403);
    await auth.changePassword(
      await auth.authenticate(new Headers({ cookie: restricted })),
      {
        currentPassword: 'issued filter password',
        newPassword: 'chosen filter password',
      },
    );
    const staffCookie = cookieValue(
      (
        await auth.signIn({
          email: 'rep-filter@example.test',
          password: 'chosen filter password',
        })
      ).cookies,
    );
    await http()
      .post('/api/v1/admin/sales-reps')
      .send({
        firstName: 'Active',
        lastName: 'Filter',
        email: 'active@example.test',
      })
      .expect(201);
    const options = await request(app.getHttpServer() as Server)
      .get('/api/v1/sales-reps/filter-options')
      .set('Cookie', staffCookie)
      .expect(200);

    expect(options.body[0].active).toBe(true);
    expect(options.body.at(-1).active).toBe(false);
    expect(options.body).toContainEqual({
      externalId: rep.externalId,
      firstName: 'Filter',
      lastName: 'Inactive',
      active: false,
    });
    expect(
      (await http().get('/api/v1/sales-reps').expect(200)).body.map(
        (row: { externalId: string }) => row.externalId,
      ),
    ).not.toContain(rep.externalId);
    const result = await http()
      .get('/api/v1/shipments/search')
      .query({
        q: 'multi-rep-http',
        salesRepExternalIds: `${rep.externalId},unassigned`,
      })
      .expect(200);
    expect(
      result.body.items.map((row: { externalId: string }) => row.externalId),
    ).toEqual([assigned.body.shipment.externalId]);
    for (const query of [
      { salesRepExternalId: rep.externalId },
      { salesRepExternalIds: 'bad' },
      { salesRepExternalIds: `${rep.externalId},` },
      { salesRepExternalIds: [rep.externalId, 'unassigned'] },
    ])
      await http().get('/api/v1/shipments/search').query(query).expect(400);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/sales-reps/filter-options')
      .expect(401);
    await create({
      ...item('inactive-assignment-denied'),
      salesRepExternalId: rep.externalId,
    }).expect(400);
  });

  it('prioritizes unseen shipments before pagination and restores selected ordering', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      const response = await create(
        item(`priority-${String(index).padStart(2, '0')}`),
      ).expect(201);
      ids.push(response.body.shipment.externalId);
    }
    const query = {
      tab: 'all',
      q: 'priority-',
      pageSize: '25',
      sortBy: 'trackingReference',
      sortDirection: 'asc',
    };
    const search = (extra: Record<string, unknown> = {}) =>
      http()
        .post('/api/v1/shipments/search')
        .send({ ...query, ...extra })
        .expect(200);
    const baseline = (await search()).body;
    expect(baseline.items[0].externalId).toBe(ids[0]);
    expect(baseline.items).toHaveLength(25);
    const promoted = (await search({ priorityShipmentIds: [ids[25], ids[25]] }))
      .body;
    expect(
      promoted.items.map((row: { externalId: string }) => row.externalId),
    ).toEqual([ids[25], ...ids.slice(0, 24)]);
    expect(promoted.tabCounts).toEqual(baseline.tabCounts);
    expect(promoted.total).toBe(26);
    expect(
      (await search({ page: '2', priorityShipmentIds: [ids[25]] })).body
        .items[0].externalId,
    ).toBe(ids[24]);
    expect(
      (await search({ priorityShipmentIds: [], page: '2' })).body.items[0]
        .externalId,
    ).toBe(ids[25]);
    expect(
      (
        await search({ q: 'priority-00', priorityShipmentIds: [ids[25]] })
      ).body.items.map((row: { externalId: string }) => row.externalId),
    ).toEqual([ids[0]]);
    expect(
      (await search({ tab: 'delivered', priorityShipmentIds: ids })).body.total,
    ).toBe(0);
    expect(
      (
        await search({
          priorityShipmentIds: [ids[0], ids[25]],
          sortDirection: 'desc',
        })
      ).body.items
        .slice(0, 2)
        .map((row: { externalId: string }) => row.externalId),
    ).toEqual([ids[25], ids[0]]);
    // Full bounded review state must fit the JSON transport, without URL truncation.
    expect(
      (await search({ priorityShipmentIds: Array(10_000).fill(ids[25]) })).body
        .items[0].externalId,
    ).toBe(ids[25]);
    for (const priorityShipmentIds of [['invalid'], Array(10_001).fill(ids[0])])
      await http()
        .post('/api/v1/shipments/search')
        .send({ ...query, priorityShipmentIds })
        .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/shipments/search')
      .set('Origin', 'http://dashboard.example.test')
      .send(query)
      .expect(401);
  });

  it('serves the static search route with strict query validation and legacy compatibility', async () => {
    const created = await create(
      item('search-http-001', 'Literal %_ search note'),
    ).expect(201);

    await request(app.getHttpServer() as Server)
      .get('/api/v1/shipments/search')
      .expect(401);

    const response = await http()
      .get('/api/v1/shipments/search')
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
        externalId: created.body.shipment.externalId,
        trackingReference: 'search-http-001',
      }),
    ]);
    expect(
      Array.isArray((await http().get('/api/v1/shipments').expect(200)).body),
    ).toBe(true);

    for (const query of [
      { unknown: 'field' },
      { page: 0 },
      { pageSize: 101 },
      { sortBy: 'privateColumn' },
      { sortBy: 'lastAttemptedAt' },
      { lookupOutcome: 'failed' },
      { createdFrom: '2026-03-09' },
      { createdTo: '2026-03-08' },
      {
        estimatedDeliveryFrom: '2026-03-09',
        estimatedDeliveryTo: '2026-03-08',
      },
      { estimatedDeliveryFrom: '2026-02-30' },
      { estimatedDeliveryTo: 'invalid' },
      { undeliveredOnly: 'yes' },
    ])
      await http().get('/api/v1/shipments/search').query(query).expect(400);

    for (const query of [
      { estimatedDeliveryFrom: '2026-03-09' },
      { estimatedDeliveryTo: '2026-03-08' },
      { undeliveredOnly: 'true' },
      { undeliveredOnly: 'false' },
    ])
      await http().get('/api/v1/shipments/search').query(query).expect(200);
  });

  it('serves authenticated normalized Shipment history with strict pagination and 404s', async () => {
    const created = await create(item('history-http-001')).expect(201);
    const externalId = created.body.shipment.externalId;
    const [shipment]: Array<{ id: number }> = await db.source.query(
      'SELECT id FROM shipments WHERE external_id = $1',
      [externalId],
    );

    await db.source.query(
      `INSERT INTO shipment_tracking_snapshots
        (shipment_id, carrier_status, carrier_status_detail, estimated_delivery_on, observed_at)
       VALUES ($1, NULL, NULL, '2026-12-01', '2026-10-16T00:00:00Z')`,
      [shipment!.id],
    );

    await request(app.getHttpServer() as Server)
      .get(`/api/v1/shipments/${externalId}/history`)
      .expect(401);

    const history = await http()
      .get(`/api/v1/shipments/${externalId}/history`)
      .query({ page: 1, pageSize: 25 })
      .expect('Cache-Control', 'no-store')
      .expect(200);

    expect(history.body).toEqual({
      items: [
        {
          externalId: expect.any(String),
          carrierStatus: null,
          carrierStatusDetail: null,
          pickedUpOn: null,
          estimatedDeliveryOn: '2026-12-01',
          deliveredOn: null,
          observedAt: '2026-10-16T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    for (const query of [{ unknown: 'field' }, { page: 0 }, { pageSize: 10 }])
      await http()
        .get(`/api/v1/shipments/${externalId}/history`)
        .query(query)
        .expect(400);

    await http().get('/api/v1/shipments/not-a-uuid/history').expect(400);
    await http()
      .get('/api/v1/shipments/fdd45938-2f15-4c69-bc0d-52a57a707dc8/history')
      .expect(404);

    await http().delete(`/api/v1/shipments/${externalId}`).expect(204);
    await http().get(`/api/v1/shipments/${externalId}/history`).expect(404);
  });

  it('creates, reads, edits, pauses, resumes and deletes by external UUID', async () => {
    const response = await create({
      ...item(' 000Ab ', ' Initial '),
      poNumber: ' 0001-a ',
      customer: ' Customer Inc ',
      vendor: ' Vendor Inc ',
    })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(response.body.outcome).toBe('created');
    const shipment = response.body.shipment;
    const path = `/api/v1/shipments/${shipment.externalId}`;

    expect(shipment).toEqual({
      externalId: expect.any(String),
      carrier: {
        externalId: carrierExternalId,
        code: 'ups',
        name: 'UPS',
        isActive: true,
      },
      trackingReference: '000Ab',
      poNumber: '0001-a',
      customer: 'Customer Inc',
      vendor: 'Vendor Inc',
      notes: 'Initial',
      salesRep: null,
      followUpOn: null,
      createdBy: {
        externalId: expect.any(String),
        firstName: 'Fixture',
        lastName: 'Admin',
      },
      updatedBy: {
        externalId: expect.any(String),
        firstName: 'Fixture',
        lastName: 'Admin',
      },
      recordUpdatedAt: null,
      recordUpdatedBy: null,
      verificationUrl: null,
      currentTracking: null,
      latestLookup: null,
      latestRun: null,
      monitoringStatus: 'active',
      monitoringReason: null,
      consecutiveNotFoundCount: 0,
      consecutiveFailureCount: 0,
      lastAttemptedAt: null,
      nextCheckAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await http().get(path).expect(200)).body).toEqual(shipment);
    expect(
      (await http().get('/api/v1/shipments').expect(200)).body,
    ).toContainEqual(shipment);
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

    const replacement = await create(item('000Ab')).expect(201);

    expect(replacement.body.shipment.externalId).not.toBe(shipment.externalId);

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

  it('returns an existing shipment without overwriting its notes or status', async () => {
    const created = await create(item('existing', 'Original notes')).expect(
      201,
    );
    const path = `/api/v1/shipments/${created.body.shipment.externalId}`;
    await http().post(`${path}/pause`).expect(200);

    const duplicate = await create(item('existing', 'Do not overwrite')).expect(
      200,
    );

    expect(duplicate.body).toMatchObject({
      outcome: 'existing',
      shipment: {
        externalId: created.body.shipment.externalId,
        notes: 'Original notes',
        monitoringStatus: 'paused',
      },
    });
  });

  it('returns safe field-specific errors and inserts nothing', async () => {
    const before = (await http().get('/api/v1/shipments')).body;
    const invalid = await create({
      ...item('forbidden', 'x'.repeat(501)),
      trackingReference: 123,
      createdById: 999,
      CANARY_FIELD: 'CANARY_VALUE',
    }).expect(400);

    expect(invalid.body.code).toBe('shipment_validation_failed');
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'trackingReference' }),
        expect.objectContaining({ field: 'notes' }),
        expect.objectContaining({ field: 'shipment' }),
      ]),
    );
    expect(invalid.text).not.toContain('CANARY');
    expect((await http().get('/api/v1/shipments')).body).toEqual(before);
  });

  it('rejects malformed JSON, batch envelopes, and unknown fields', async () => {
    await http()
      .post('/api/v1/shipments')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await http()
      .post('/api/v1/shipments')
      .send({ items: [item('unsupported-batch')] })
      .expect(400);
    await create({ ...item('unknown-field'), createdById: 1 }).expect(400);
  });

  it.each(['1', 'bad-uuid', '00000000-0000-1000-8000-000000000000'])(
    'rejects invalid UUID routes: %s',
    async (id) => {
      await http().get(`/api/v1/shipments/${id}`).expect(400);
      await http()
        .patch(`/api/v1/shipments/${id}`)
        .send({ notes: 'x' })
        .expect(400);
      await http().delete(`/api/v1/shipments/${id}`).expect(400);
      await http().post(`/api/v1/shipments/${id}/pause`).expect(400);
    },
  );

  it('returns 404 for an unknown public UUID', async () => {
    const path = '/api/v1/shipments/00000000-0000-4000-8000-000000000000';

    await http().get(path).expect(404);
    await http().patch(path).send({ notes: null }).expect(404);
    await http().delete(path).expect(404);
    await http().post(`${path}/resume`).expect(404);
  });

  it('accepts limits and rejects notes overflow, blank notes, immutable and actor fields', async () => {
    const response = await create(
      item('x'.repeat(255), 'n'.repeat(500)),
    ).expect(201);
    const path = `/api/v1/shipments/${response.body.shipment.externalId}`;

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

    expect((await http().get(path)).body).toEqual(response.body.shipment);

    await create(item('x'.repeat(256))).expect(400);
    await create(item('nul\u0000')).expect(400);
  });

  it('rejects disabled and absent Carriers before insertion', async () => {
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
      const response = await create({
        ...item('disabled'),
        carrierExternalId: id,
      }).expect(400);

      expect(response.body.details).toEqual([
        { field: 'carrierExternalId', message: expect.any(String) },
      ]);
    }

    expect(
      (await http().get('/api/v1/shipments')).body.some(
        (row: { trackingReference: string }) =>
          row.trackingReference === 'disabled',
      ),
    ).toBe(false);
  });

  it('handles concurrent HTTP creations with one inserted record', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => create(item('http-concurrent'))),
    );

    expect(results.map((result) => result.status).sort()).toEqual([
      200, 200, 200, 201,
    ]);

    const records = results.map((result) => result.body.shipment);

    expect(new Set(records.map((row) => row.externalId)).size).toBe(1);
  });

  it('returns a safe 500 on an unexpected database error', async () => {
    await db.source.query(
      `ALTER TABLE shipments ADD CONSTRAINT http_test_failure CHECK (tracking_reference <> 'http-db-fail-z')`,
    );

    try {
      const response = await create(item('http-db-fail-z')).expect(500);

      expect(response.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(
        (await http().get('/api/v1/shipments')).body.some(
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
