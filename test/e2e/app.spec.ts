import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';

describe('Application HTTP smoke test', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the scaffold greeting over HTTP', async () => {
    if (!app) throw new Error('Test application did not start');

    await request(app.getHttpServer() as Server)
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
