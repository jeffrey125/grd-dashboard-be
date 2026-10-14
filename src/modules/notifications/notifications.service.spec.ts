import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';

afterEach(() => vi.unstubAllEnvs());

it.each([
  'not-a-url',
  'file:///CANARY_TOPIC',
  'https://user:CANARY_TOPIC@example.test/topic',
  'https://example.test/topic?token=CANARY_TOPIC',
  'https://example.test/topic#CANARY_TOPIC',
])('rejects unsafe topic configuration without exposing it: %s', (url) => {
  vi.stubEnv('NTFY_URL', url);

  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as ProjectLogger;

  expect(() => new NotificationsService(logger)).toThrow(
    'Invalid NTFY_URL: use an HTTP(S) topic URL without credentials, query, or fragment',
  );
  expect(logger.warn).not.toHaveBeenCalled();
});

it('bounds UTF-8 messages without splitting characters and publishes no secrets in logs', async () => {
  let received = '';
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) chunks.push(Buffer.from(chunk));

    received = Buffer.concat(chunks).toString('utf8');
    response.writeHead(200).end();
  }).listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('No address');

  vi.stubEnv('NTFY_URL', `http://127.0.0.1:${address.port}/CANARY_TOPIC`);

  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as ProjectLogger;
  const service = new NotificationsService(logger);

  try {
    await service.record({
      carrierCode: 'ffe',
      shipmentExternalId: 'public-id',
      trackingReference: 'CANARY_REFERENCE',
      outcome: 'found',
      changed: true,
      snapshot: {
        carrierStatus: '🚚'.repeat(1500),
        carrierStatusDetail: null,
        pickedUpOn: null,
        estimatedDeliveryOn: null,
        deliveredOn: null,
      },
    });

    expect(Buffer.byteLength(received)).toBeLessThanOrEqual(3420);
    expect(received).toContain('CANARY_REFERENCE');
    expect(received).toContain('[Details truncated]');
    expect(received).not.toContain('\uFFFD');
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
      'CANARY',
    );
    expect(logger.info).toHaveBeenCalledWith(
      'notification.published',
      'Tracking notification published',
      { carrierCode: 'ffe', shipmentExternalId: 'public-id' },
    );
  } finally {
    service.onModuleDestroy();
    server.close();
    await once(server, 'close');
  }
});

it('keeps notifications optional when the topic is blank', async () => {
  vi.stubEnv('NTFY_URL', ' ');

  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as ProjectLogger;
  const service = new NotificationsService(logger);

  try {
    await service.record({
      carrierCode: 'ups',
      shipmentExternalId: 'public-id',
      trackingReference: 'ABC',
      outcome: 'failed',
    });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  } finally {
    service.onModuleDestroy();
  }
});

it('sends one failure per outage, resets on success, and discards failed publishing', async () => {
  const bodies: string[] = [];
  const server = createServer(async (request, response) => {
    let body = '';

    for await (const chunk of request) body += chunk;

    bodies.push(body);
    response.writeHead(503).end();
  }).listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('No address');

  vi.stubEnv('NTFY_URL', `http://127.0.0.1:${address.port}/topic`);

  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as ProjectLogger;
  const service = new NotificationsService(logger);
  const event = {
    carrierCode: 'ups',
    shipmentExternalId: 'public-id',
    trackingReference: 'ABC',
    outcome: 'failed' as const,
  };

  try {
    await service.record(event);
    await service.record(event);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('ABC');
    expect(bodies[0]).not.toContain('Monitoring stopped');

    await service.record({ ...event, outcome: 'found', changed: false });
    await service.record(event);

    expect(bodies).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  } finally {
    service.onModuleDestroy();
    server.close();
    await once(server, 'close');
  }
});

it('cancels an in-flight publish on shutdown without retrying', async () => {
  let arrived!: () => void;
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let count = 0;
  const server = createServer(() => {
    count++;
    arrived();
  }).listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('No address');

  vi.stubEnv('NTFY_URL', `http://127.0.0.1:${address.port}/topic`);

  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as ProjectLogger;
  const service = new NotificationsService(logger);

  try {
    const publishing = service.record({
      carrierCode: 'ffe',
      shipmentExternalId: 'public-id',
      trackingReference: 'ABC',
      outcome: 'failed',
    });

    await received;
    service.onModuleDestroy();
    await publishing;

    expect(count).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'notification.discarded',
      expect.any(String),
      { carrierCode: 'ffe', shipmentExternalId: 'public-id' },
    );
  } finally {
    service.onModuleDestroy();
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
