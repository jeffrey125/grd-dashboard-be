import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';

afterEach(() => vi.unstubAllEnvs());
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
