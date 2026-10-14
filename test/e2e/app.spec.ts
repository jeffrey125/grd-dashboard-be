import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '@test/support/create-test-app.js';
import { testEnvironment } from '@test/support/environment.js';

describe('Application health HTTP endpoints', () => {
  let app: INestApplication | undefined;

  beforeEach(() => {
    for (const [key, value] of Object.entries(testEnvironment))
      vi.stubEnv(key, value);
  });

  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('serves health and removes the scaffold route', async () => {
    app = await createTestApp();
    await request(app.getHttpServer() as Server)
      .get('/health/live')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok' });

    const response = await request(app.getHttpServer() as Server)
      .get('/health/ready')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toMatchObject({
      status: 'ok',
      details: { application: { status: 'up' } },
    });

    await request(app.getHttpServer() as Server)
      .get('/')
      .expect(404);
  });

  it('returns safe 503 readiness while liveness remains healthy', async () => {
    app = await createTestApp([
      {
        name: 'database',
        check: () => {
          throw new Error('CANARY_HTTP_SECRET');
        },
      },
    ]);

    const response = await request(app.getHttpServer() as Server)
      .get('/health/ready')
      .expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      error: { database: { status: 'down' } },
    });
    expect(response.text).not.toContain('CANARY_HTTP_SECRET');

    await request(app.getHttpServer() as Server)
      .get('/health/live')
      .expect(200);
  });
});
