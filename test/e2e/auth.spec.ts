import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { TestDatabaseModule } from '@test/support/test-database.module.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { configureApiRoutes } from '@runtime/api-routing.js';

describe('employee HTTP authentication', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let app: INestApplication;
  const origin = 'http://dashboard.example.test';
  const http = () => request(app.getHttpServer() as Server);
  const cookies = (response: { headers: Record<string, unknown> }) =>
    (response.headers['set-cookie'] as string[])
      .map((value) => value.split(';')[0])
      .join('; ');

  beforeAll(async () => {
    db = await shipmentDatabase();

    for (const [key, value] of Object.entries({
      ...db.environment,
      AUTH_SECRET: 'test-secret-'.repeat(4),
      AUTH_BASE_URL: 'http://api.example.test',
      AUTH_TRUSTED_ORIGINS: origin,
    }))
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
    await app.get(AuthService).bootstrap({
      firstName: 'Test',
      lastName: 'Admin',
      email: 'admin@example.test',
      password: 'initial admin password',
      role: 'admin',
    });
  });
  afterAll(async () => {
    await app?.close();
    await db?.close();
    vi.unstubAllEnvs();
  });
  it('defaults to protected routes and enforces password replacement with cookie-only credentials', async () => {
    await http().get('/api/v1/carriers').expect(401);
    await http().get('/api/v1/shipments').expect(401);
    await http()
      .post('/api/v1/auth/sign-in')
      .send({ email: 'admin@example.test', password: 'initial admin password' })
      .expect(403);

    const login = await http()
      .post('/api/v1/auth/sign-in')
      .set('Origin', origin)
      .send({ email: 'admin@example.test', password: 'initial admin password' })
      .expect(200);

    expect(String(login.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(login.headers['set-cookie'])).toContain('SameSite=Lax');
    expect(login.body.mustChangePassword).toBe(true);
    expect(login.body.token).toBeUndefined();
    expect(login.body.id).toBeUndefined();

    const cookie = cookies(login);

    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    await http().get('/api/v1/carriers').set('Cookie', cookie).expect(403);
    await http()
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        currentPassword: 'initial admin password',
        newPassword: 'chosen admin password',
      })
      .expect(204);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);

    const fresh = await http()
      .post('/api/v1/auth/sign-in')
      .set('Origin', origin)
      .send({ email: 'admin@example.test', password: 'chosen admin password' })
      .expect(200);

    await http()
      .get('/api/v1/carriers')
      .set('Cookie', cookies(fresh))
      .expect(200);
    await http()
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({})
      .expect(404);
  });
  it('authorizes staff Shipment workflows, rejects Carrier administration, and writes trusted audit actors', async () => {
    const adminLogin = await http()
      .post('/api/v1/auth/sign-in')
      .set('Origin', origin)
      .send({ email: 'admin@example.test', password: 'chosen admin password' })
      .expect(200);
    const adminCookie = cookies(adminLogin);
    const staff = await http()
      .post('/api/v1/admin/accounts')
      .set('Origin', origin)
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Staff',
        lastName: 'Person',
        email: 'staff@example.test',
        role: 'staff',
        password: 'issued staff password',
      })
      .expect(201);
    const issued = await http()
      .post('/api/v1/auth/sign-in')
      .set('Origin', origin)
      .send({ email: staff.body.email, password: 'issued staff password' })
      .expect(200);

    await http()
      .post('/api/v1/auth/change-password')
      .set('Origin', origin)
      .set('Cookie', cookies(issued))
      .send({
        currentPassword: 'issued staff password',
        newPassword: 'chosen staff password',
      })
      .expect(204);

    const staffLogin = await http()
      .post('/api/v1/auth/sign-in')
      .set('Origin', origin)
      .send({ email: staff.body.email, password: 'chosen staff password' })
      .expect(200);
    const cookie = cookies(staffLogin);
    const carriers = await http()
      .get('/api/v1/carriers')
      .set('Cookie', cookie)
      .expect(200);
    const carrierId = carriers.body[0].externalId;

    await http()
      .patch(`/api/v1/carriers/${carrierId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ name: 'Forbidden' })
      .expect(403);
    await http()
      .get('/api/v1/admin/accounts')
      .set('Cookie', cookie)
      .expect(403);
    await http()
      .post('/api/v1/shipments')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        carrierExternalId: carrierId,
        trackingReference: 'test',
        createdById: 123,
      })
      .expect(400);

    const created = await http()
      .post('/api/v1/shipments')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ carrierExternalId: carrierId, trackingReference: 'audit-test' })
      .expect(201);
    const id = created.body.shipment.externalId;

    await http()
      .patch(`/api/v1/shipments/${id}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ notes: 'Employee note' })
      .expect(200);
    await http()
      .post(`/api/v1/shipments/${id}/pause`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    await http()
      .post(`/api/v1/shipments/${id}/resume`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    await http()
      .delete(`/api/v1/shipments/${id}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(204);

    const [actor] = await db.source.query(
      'SELECT id FROM auth_users WHERE external_id = $1',
      [staff.body.externalId],
    );
    const [row] = await db.source.query(
      'SELECT created_by_id, updated_by_id, deleted_by_id FROM shipments WHERE external_id = $1',
      [id],
    );

    expect(row).toEqual({
      created_by_id: actor.id,
      updated_by_id: actor.id,
      deleted_by_id: actor.id,
    });

    await http()
      .patch(`/api/v1/carriers/${carrierId}`)
      .set('Origin', origin)
      .set('Cookie', adminCookie)
      .send({ name: 'Admin edited' })
      .expect(200);

    const [carrier] = await db.source.query(
      'SELECT u.external_id FROM carriers c JOIN auth_users u ON c.updated_by_id = u.id WHERE c.external_id = $1',
      [carrierId],
    );

    expect(carrier.external_id).toBe(adminLogin.body.externalId);
  });
  it('rejects cross-origin requests and limits normalized-email login attempts', async () => {
    await http()
      .options('/api/v1/auth/sign-in')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
      .expect('Access-Control-Allow-Origin', origin)
      .expect('Access-Control-Allow-Credentials', 'true');
    await http()
      .options('/api/v1/auth/sign-in')
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    await http()
      .post('/api/v1/auth/sign-in')
      .set('Origin', 'null')
      .send({})
      .expect(403);
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer unsupported')
      .expect(401);

    for (let index = 0; index < 5; index++)
      await http()
        .post('/api/v1/auth/sign-in')
        .set('Origin', origin)
        .send({ email: '  Absent@example.test ', password: 'wrong password' })
        .expect(401);

    await http()
      .post('/api/v1/auth/sign-in')
      .set('Origin', origin)
      .send({ email: 'absent@EXAMPLE.test', password: 'wrong password' })
      .expect(429);
    await http().get('/api/v1/health/live').expect(200);
  });
});
