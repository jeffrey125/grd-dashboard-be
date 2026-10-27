import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@modules/auth/auth.service.js';
import { createTestApp } from '@test/support/create-test-app.js';
import { testEnvironment } from '@test/support/environment.js';

// Exercise the real Nest guards and storage, mocking only credential verification.
describe('login client IP trust boundary', () => {
  let app: INestApplication | undefined;
  let sequence = 0;

  async function start(mode: string) {
    for (const [key, value] of Object.entries({
      ...testEnvironment,
      AUTH_TRUST_PROXY: mode,
    }))
      vi.stubEnv(key, value);
    app = await createTestApp();
    return vi
      .spyOn(app.get(AuthService), 'signIn')
      .mockResolvedValue({ cookies: [], user: {} } as never);
  }

  function login(ip?: string, forwarded = '203.0.113.99') {
    const call = request(app!.getHttpServer() as Server)
      .post('/api/v1/auth/sign-in')
      .set('Origin', testEnvironment.AUTH_TRUSTED_ORIGINS)
      .set('X-Forwarded-For', forwarded)
      .send({
        email: `visitor-${sequence++}@example.test`,
        password: 'fixture password',
      });
    if (ip !== undefined) call.set('do-connecting-ip', ip);
    return call;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('separates visitors behind one ingress and ignores forged X-Forwarded-For', async () => {
    await start('digitalocean');
    for (let index = 0; index < 60; index++)
      await login('198.51.100.1', `203.0.113.${index}`).expect(200);
    await login('198.51.100.1', '192.0.2.9').expect(429);
    await login('198.51.100.2').expect(200);
  });

  it('fails closed for missing, malformed, duplicate/list and scoped headers before authentication', async () => {
    const signIn = await start('digitalocean');
    for (const value of [
      undefined,
      'not-an-ip',
      '198.51.100.1, 198.51.100.2',
      '198.51.100.1:1234',
      'fe80::1%eth0',
    ])
      await login(value).expect(400);
    expect(signIn).not.toHaveBeenCalled();
    await request(app!.getHttpServer() as Server)
      .get('/api/v1/health/live')
      .expect(200);
  });

  it('retains library IPv6 normalization and subnet grouping', async () => {
    await start('digitalocean');
    for (let index = 0; index < 60; index++)
      await login('2001:db8:1:2::1').expect(200);
    await login('2001:0db8:0001:0002:0:0:0:abcd').expect(429);
    await login('2001:db8:1:3::1').expect(200);
  });

  it('ignores DigitalOcean and forwarded headers unless explicitly enabled', async () => {
    await start('false');
    for (let index = 0; index < 60; index++)
      await login(`198.51.100.${index}`, `203.0.113.${index}`).expect(200);
    await login('192.0.2.1').expect(429);
  });
});
