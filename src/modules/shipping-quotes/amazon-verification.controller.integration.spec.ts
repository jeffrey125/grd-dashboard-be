import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import {
  UnauthorizedException,
  NotFoundException,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { AuthGuard } from '@modules/auth/auth.guard.js';
import { AuthBrowserMiddleware } from '@modules/auth/auth-browser.middleware.js';
import { AuthService } from '@modules/auth/auth.service.js';
import { AmazonVerificationController } from './amazon-verification.controller.js';
import { AmazonVerificationBridge } from './amazon-verification.bridge.js';
import { QuoteService } from './quote.service.js';

const comparisonId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const actorExternalId = '33333333-3333-4333-8333-333333333333';
const path = `/quote-comparisons/${comparisonId}/attempts/${attemptId}/amazon-verification`;
const origin = 'http://dashboard.example.test';
const principal = {
  id: 1,
  externalId: actorExternalId,
  sessionId: 7,
  role: 'staff',
  mustChangePassword: false,
};
const auth = { authenticate: vi.fn() };
const bridge = { send: vi.fn() };
const quotes = { find: vi.fn() };
let app: INestApplication;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [AmazonVerificationController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: AmazonVerificationBridge, useValue: bridge },
      { provide: QuoteService, useValue: quotes },
    ],
  }).compile();
  app = module.createNestApplication();
  const middleware = new AuthBrowserMiddleware({
    origins: [origin],
    baseURL: origin,
    secret: 'fixture',
    secure: false,
    trustProxy: false,
  });
  app.use(middleware.use.bind(middleware));
  app.useGlobalGuards(
    new AuthGuard(new Reflector(), auth as unknown as AuthService),
  );
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.resetAllMocks();
  auth.authenticate.mockResolvedValue(principal);
  bridge.send.mockResolvedValue({
    id: attemptId,
    state: 'challenge',
    expiresAt: new Date().toISOString(),
    image: 'fixture-image',
  });
  quotes.find.mockResolvedValue({
    attempts: [
      {
        externalId: attemptId,
        provider: 'amazon',
        status: 'failed',
        reasonCode: 'verification_required',
        retryBlockedReason: null,
      },
    ],
  });
});

it('requires staff authentication, unrestricted access and a trusted Origin on every image/action', async () => {
  const post = () =>
    request(app.getHttpServer()).post(path).send({ operation: 'start' });
  await post().expect(403);
  await post().set('Origin', 'http://evil.example.test').expect(403);
  auth.authenticate.mockRejectedValueOnce(new UnauthorizedException());
  await post().set('Origin', origin).expect(401);
  auth.authenticate.mockResolvedValueOnce({
    ...principal,
    mustChangePassword: true,
  });
  await post().set('Origin', origin).expect(403);
  expect(bridge.send).not.toHaveBeenCalled();
});

it('binds commands to the authenticated staff session and sends no-store frames', async () => {
  const response = await request(app.getHttpServer())
    .post(path)
    .set('Origin', origin)
    .send({ operation: 'start' })
    .expect(201);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(bridge.send).toHaveBeenCalledWith({
    operation: 'start',
    owner: `${actorExternalId}:7`,
    actorExternalId,
    comparisonId,
    attemptId,
  });
  expect(response.body.image).toBe('fixture-image');
  expect(auth.authenticate).toHaveBeenCalledTimes(2);
});

it('rejects deleted comparisons, non-Amazon failures and blocked retries before opening a browser', async () => {
  quotes.find.mockRejectedValueOnce(new NotFoundException());
  await request(app.getHttpServer())
    .post(path)
    .set('Origin', origin)
    .send({ operation: 'start' })
    .expect(404);
  quotes.find.mockResolvedValueOnce({
    attempts: [{ externalId: attemptId, provider: 'unishippers' }],
  });
  await request(app.getHttpServer())
    .post(path)
    .set('Origin', origin)
    .send({ operation: 'start' })
    .expect(409);
  quotes.find.mockResolvedValueOnce({
    attempts: [
      {
        externalId: attemptId,
        provider: 'amazon',
        status: 'failed',
        reasonCode: 'verification_required',
        retryBlockedReason: 'ship_date_passed',
      },
    ],
  });
  await request(app.getHttpServer())
    .post(path)
    .set('Origin', origin)
    .send({ operation: 'start' })
    .expect(409);
  expect(bridge.send).not.toHaveBeenCalled();
});

it('discards the frame and cancels recovery when the staff session is revoked during capture', async () => {
  auth.authenticate
    .mockResolvedValueOnce(principal)
    .mockRejectedValueOnce(new UnauthorizedException());
  const response = await request(app.getHttpServer())
    .post(path)
    .set('Origin', origin)
    .send({ operation: 'start' })
    .expect(401);
  expect(response.body.image).toBeUndefined();
  expect(bridge.send).toHaveBeenLastCalledWith(
    expect.objectContaining({ operation: 'cancel', id: attemptId }),
  );
});

it('does not accept user-supplied ownership, URLs, scripts or unbounded actions', async () => {
  for (const body of [
    { operation: 'start', owner: 'admin:1' },
    {
      operation: 'action',
      id: attemptId,
      action: { type: 'navigate', url: 'https://amazon.com' },
    },
    {
      operation: 'action',
      id: attemptId,
      action: { type: 'text', text: 'x'.repeat(101), frame: attemptId },
    },
  ])
    await request(app.getHttpServer())
      .post(path)
      .set('Origin', origin)
      .send(body)
      .expect(400);
  expect(bridge.send).not.toHaveBeenCalled();
});
