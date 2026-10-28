import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@modules/auth/auth.service.js';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { configureApiRoutes } from '@runtime/api-routing.js';
import { testEnvironment } from '@test/support/environment.js';
import { administratorCookie } from '@test/support/authentication.js';

describe('authenticated frontend telemetry', () => {
  let app: INestApplication;
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;

  afterEach(async () => {
    await app?.close();
    await db?.close();
    vi.unstubAllEnvs();
  });

  it('requires session and trusted origin, validates reports, exposes correlation and limits each account', async () => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
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
    const cookie = await administratorCookie(app);
    const event = {
      kind: 'browser',
      page: '/',
      release: 'development',
      errorName: 'Error',
      frames: [],
    };
    const post = () =>
      request(app.getHttpServer() as Server)
        .post('/api/v1/telemetry/frontend')
        .set('Origin', testEnvironment.AUTH_TRUSTED_ORIGINS);
    await post().send(event).expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/telemetry/frontend')
      .set('Cookie', cookie)
      .send(event)
      .expect(403);
    await post()
      .set('Cookie', cookie)
      .send({ ...event, message: 'private canary' })
      .expect(400);
    const response = await post().set('Cookie', cookie).send(event).expect(204);
    expect(response.headers['access-control-expose-headers']).toContain(
      'X-Request-Id',
    );
    for (let n = 0; n < 18; n++)
      await post().set('Cookie', cookie).send(event).expect(204);
    await post().set('Cookie', cookie).send(event).expect(429);
    const auth = app.get(AuthService);
    await auth.signOut(
      await auth.authenticate(new Headers({ cookie })),
      new Headers({ cookie }),
    );
    await post().set('Cookie', cookie).send(event).expect(401);
  });
});
