import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { administratorCookie } from '@test/support/authentication.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TrackingRunEntity } from '@modules/tracking/tracking-run.entity.js';
import { TrackingSchedulerService } from '@modules/tracking/tracking-scheduler.service.js';
import { TrackingExecutorService } from '@modules/tracking/tracking-executor.service.js';
import { TypeOrmTrackingWorkRepository } from '@modules/tracking/typeorm-tracking-work.repository.js';
import { TypeOrmCarriersRepository } from '@modules/carriers/typeorm-carriers.repository.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;
let app: INestApplication;
let cookie: string;
let carrierExternalId: string;
const http = () =>
  request
    .agent(app.getHttpServer() as Server)
    .set('Cookie', cookie)
    .set('Origin', 'http://dashboard.example.test');

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
  await app.listen(0, '127.0.0.1');
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

it('coalesces concurrent manual refreshes into one durable run and exposes safe status', async () => {
  const created = await http()
    .post('/shipments')
    .send({ items: [{ carrierExternalId, trackingReference: 'refresh-race' }] })
    .expect(201);
  const id = created.body.inserted[0].externalId;
  const replies = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      http()
        .post(`/shipments/${index % 2 ? id.toUpperCase() : id}/refresh`)
        .expect(202),
    ),
  );

  expect(new Set(replies.map((reply) => reply.body.externalId)).size).toBe(1);

  const run = await http()
    .get(`/tracking-runs/${replies[0]!.body.externalId}`)
    .expect(200);

  expect(run.body).toMatchObject({
    status: 'queued',
    trigger: 'manual',
    attempts: [{ shipmentExternalId: id, outcome: 'pending' }],
  });
  expect(JSON.stringify(run.body)).not.toMatch(
    /sourceData|requestedById|shipmentId|trackingRunId/,
  );

  const principal = await app
    .get(AuthService)
    .authenticate(new Headers({ cookie }));
  const stored = await db.source
    .getRepository(TrackingRunEntity)
    .findOneByOrFail({ externalId: run.body.externalId });

  expect(stored.requestedById).toBe(principal.id);

  const tracking = new TrackingService(
    new TypeOrmTrackingRepository(db.source),
  );

  await tracking.startRun(run.body.externalId);

  expect(
    (await http().post(`/shipments/${id}/refresh`).expect(202)).body.externalId,
  ).toBe(run.body.externalId);

  await tracking.interruptRun({
    runExternalId: run.body.externalId,
    retryable: true,
    reasonCode: 'WORKER_SHUTDOWN',
    message: 'Worker stopped.',
  });

  expect(
    (await http().post(`/shipments/${id}/refresh`).expect(202)).body.externalId,
  ).not.toBe(run.body.externalId);

  await http()
    .post(`/shipments/${id}/refresh`)
    .send({ requestedById: 1 })
    .expect(400);
  await request(app.getHttpServer() as Server)
    .post(`/shipments/${id}/refresh`)
    .set('Origin', 'http://dashboard.example.test')
    .expect(401);
});

async function stream() {
  const controller = new AbortController();
  const address = (app.getHttpServer() as Server).address();

  if (!address || typeof address === 'string') throw new Error('No address');

  const response = await fetch(`http://127.0.0.1:${address.port}/events`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
  });

  expect(response.status).toBe(200);

  const reader = response.body!.getReader();
  let buffer = '';
  const decoder = new TextDecoder();

  async function next(type: string): Promise<string | null> {
    for (;;) {
      const end = buffer.indexOf('\n\n');

      if (end >= 0) {
        const event = buffer.slice(0, end);

        buffer = buffer.slice(end + 2);

        if (event.startsWith(`event: ${type}\n`)) return event;

        continue;
      }

      const chunk = await reader.read();

      if (chunk.done) return null;

      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  return { next, close: () => controller.abort() };
}

it('streams committed changes, reconnects with resync, and closes revoked sessions with heartbeat cleanup', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

  const first = await stream();

  try {
    await first.next('resync');
    // First subscriber also receives resync after LISTEN becomes active.
    await first.next('resync');

    const created = await http()
      .post('/shipments')
      .send({
        items: [{ carrierExternalId, trackingReference: 'sse-shipment' }],
      })
      .expect(201);
    const id = created.body.inserted[0].externalId;

    expect(await first.next('shipment.changed')).toContain(id);

    const queued = await http().post(`/shipments/${id}/refresh`).expect(202);

    expect(await first.next('run.changed')).toContain(queued.body.externalId);

    await vi.advanceTimersByTimeAsync(15000);

    expect(await first.next('heartbeat')).toContain('data: {}');

    first.close();

    const second = await stream();

    try {
      expect(await second.next('resync')).toBeTruthy();

      await http().get(`/tracking-runs/${queued.body.externalId}`).expect(200);
      await http().post('/auth/sign-out').expect(204);
      await vi.advanceTimersByTimeAsync(15000);

      expect(await second.next('heartbeat')).toBeNull();
    } finally {
      second.close();
    }

    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));
  } finally {
    first.close();
    vi.useRealTimers();
  }

  const login = await app.get(AuthService).signIn({
    email: 'fixture@example.test',
    password: 'chosen fixture password',
  });

  cookie = login.cookies.map((value) => value.split(';')[0]).join('; ');
});

it('rejects unavailable targets and protects status/events, including restricted sessions', async () => {
  await request(app.getHttpServer() as Server)
    .get('/events')
    .expect(401);
  await request(app.getHttpServer() as Server)
    .get('/tracking-runs/11111111-1111-4111-8111-111111111111')
    .expect(401);
  await http()
    .get('/tracking-runs/11111111-1111-4111-8111-111111111111')
    .expect(404);

  const created = await http()
    .post('/shipments')
    .send({
      items: [{ carrierExternalId, trackingReference: 'paused-target' }],
    })
    .expect(201);
  const id = created.body.inserted[0].externalId;

  await http().post(`/shipments/${id}/pause`).expect(200);
  await http().post(`/shipments/${id}/refresh`).expect(409);
  await http().delete(`/shipments/${id}`).expect(204);
  await http().post(`/shipments/${id}/refresh`).expect(404);
  await http().post('/shipments/refresh-all').expect(404);

  const auth = app.get(AuthService);
  const principal = await auth.authenticate(new Headers({ cookie }));

  await auth.createAccount(principal, {
    firstName: 'Test',
    lastName: 'Staff',
    email: 'refresh-staff@example.test',
    password: 'issued staff password',
    role: 'staff',
  });

  const issued = await auth.signIn({
    email: 'refresh-staff@example.test',
    password: 'issued staff password',
  });
  const restricted = issued.cookies
    .map((value) => value.split(';')[0])
    .join('; ');

  await request(app.getHttpServer() as Server)
    .get('/events')
    .set('Cookie', restricted)
    .expect(403);
  await request(app.getHttpServer() as Server)
    .post(`/shipments/${id}/refresh`)
    .set('Cookie', restricted)
    .set('Origin', 'http://dashboard.example.test')
    .expect(403);

  const restrictedPrincipal = await auth.authenticate(
    new Headers({ cookie: restricted }),
  );

  await auth.changePassword(restrictedPrincipal, {
    currentPassword: 'issued staff password',
    newPassword: 'chosen staff password',
  });

  const signedIn = await auth.signIn({
    email: 'refresh-staff@example.test',
    password: 'chosen staff password',
  });
  const staffCookie = signedIn.cookies
    .map((value) => value.split(';')[0])
    .join('; ');
  const staffShipment = await http()
    .post('/shipments')
    .send({
      items: [{ carrierExternalId, trackingReference: 'staff-refresh' }],
    })
    .expect(201);
  const refreshed = await request(app.getHttpServer() as Server)
    .post(`/shipments/${staffShipment.body.inserted[0].externalId}/refresh`)
    .set('Cookie', staffCookie)
    .set('Origin', 'http://dashboard.example.test')
    .expect(202);

  await request(app.getHttpServer() as Server)
    .get(`/tracking-runs/${refreshed.body.externalId}`)
    .set('Cookie', staffCookie)
    .expect(200);
});

it('hands an authenticated HTTP refresh to the real worker scheduler through PostgreSQL', async () => {
  const created = await http()
    .post('/shipments')
    .send({
      items: [{ carrierExternalId, trackingReference: 'worker-handoff' }],
    })
    .expect(201);
  const id = created.body.inserted[0].externalId;
  const queued = await http().post(`/shipments/${id}/refresh`).expect(202);
  const tracking = new TrackingService(
    new TypeOrmTrackingRepository(db.source),
  );
  const carriers = new TypeOrmCarriersRepository(db.source);
  const registry = new CarrierAdapterRegistry(
    (await carriers.listActive()).map((carrier) => ({
      code: carrier.code,
      minimumIntervalMinutes: 60,
      referencePolicy: carrierReferencePolicy(carrier.code),
      validateConfiguration() {},
      async openSession() {
        return {
          async read() {
            return {
              outcome: 'found' as const,
              sourceData: null,
              snapshot: {
                carrierStatus: 'Moving',
                carrierStatusDetail: null,
                pickedUpOn: null,
                estimatedDeliveryOn: null,
                deliveredOn: null,
              },
            };
          },
          async close() {},
        };
      },
    })),
  );
  const logger = app.get(ProjectLogger);
  const worker = new TrackingSchedulerService(
    new TypeOrmTrackingWorkRepository(db.source),
    carriers,
    tracking,
    registry,
    new TrackingExecutorService(tracking, registry, logger),
    logger,
  );

  try {
    await worker.start();
    await worker.tick();

    const status = await http()
      .get(`/tracking-runs/${queued.body.externalId}`)
      .expect(200);

    expect(status.body).toMatchObject({
      status: 'succeeded',
      attempts: [{ shipmentExternalId: id, outcome: 'found' }],
    });
  } finally {
    await worker.onModuleDestroy();
  }
});

it('closes open SSE streams when the API shuts down', async () => {
  const connection = await stream();

  try {
    await connection.next('resync');

    const closing = app.close();

    expect(await connection.next('heartbeat')).toBeNull();

    await closing;
  } finally {
    connection.close();
  }
});
