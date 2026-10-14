import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { NotificationsService } from '@modules/notifications/notifications.service.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';

let db: Awaited<ReturnType<typeof shipmentDatabase>>;
let server: Server;
let publisher: NotificationsService;
let tracking: TrackingService;
const messages: Array<{ title: string; body: string }> = [];
let status = 200;

beforeAll(async () => {
  db = await shipmentDatabase();
  server = createServer(async (request, response) => {
    let body = '';

    for await (const chunk of request) body += chunk;

    messages.push({ title: String(request.headers.title), body });
    response.writeHead(status).end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('No server');

  vi.stubEnv('NTFY_URL', `http://127.0.0.1:${address.port}/private-topic`);
  publisher = new NotificationsService({
    warn: vi.fn(),
    info: vi.fn(),
  } as unknown as ProjectLogger);
  tracking = new TrackingService(
    new TypeOrmTrackingRepository(db.source),
    publisher,
  );
});
afterAll(async () => {
  publisher?.onModuleDestroy();

  if (server) {
    server.close();
    await once(server, 'close');
  }

  await db?.close();
  vi.unstubAllEnvs();
});

it.each(['ups', 'echoship', 'ffe'])(
  'notifies once per stop transition for %s and retains committed state when publishing fails',
  async (code) => {
    const shipments = new TypeOrmShipmentsRepository(db.source);
    const carrier = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code });

    await db.source.query(
      'UPDATE carriers SET not_found_pause_threshold = 2 WHERE id = $1',
      [carrier.id],
    );

    const created = await shipments.createMany([
      {
        carrierExternalId: carrier.externalId,
        trackingReference: `notify-${code}`,
        notes: null,
      },
    ]);

    if (created.kind !== 'created') throw new Error('No shipment');

    const shipment = created.inserted[0]!;
    const initialSchedule = shipment.nextCheckAt;

    async function attempt(
      outcome: 'found' | 'not_found' | 'failed',
      delivered = false,
    ) {
      const run = await tracking.createRun({
        carrierExternalId: carrier.externalId,
        shipmentExternalIds: [shipment.externalId],
        trigger: 'manual',
        requestedById: null,
      });
      const target = (await tracking.startRun(run.externalId)).targets[0]!;
      const command = {
        runExternalId: run.externalId,
        shipmentExternalId: shipment.externalId,
        expectedLockVersion: target.expectedLockVersion,
        effectiveIntervalMinutes: 5,
        sourceData: null,
      };

      if (outcome === 'found')
        await tracking.finalizeFound({
          ...command,
          snapshot: {
            carrierStatus: delivered ? 'Delivered' : 'Moving',
            carrierStatusDetail: null,
            pickedUpOn: null,
            estimatedDeliveryOn: null,
            deliveredOn: delivered ? '2026-10-15' : null,
          },
        });
      else if (outcome === 'not_found')
        await tracking.finalizeNotFound(command);
      else
        await tracking.finalizeFailed({
          ...command,
          retryable: true,
          reasonCode: 'TEST_FAILURE',
          message: 'Safe failure',
        });

      await tracking.finalizeRun(run.externalId);

      return command;
    }

    messages.length = 0;
    await attempt('found');

    expect(messages).toHaveLength(1);
    expect(messages[0]!.title).toBe('Initial tracking result');
    expect((await shipments.find(shipment.externalId))!.nextCheckAt).toEqual(
      initialSchedule,
    );

    await attempt('found');

    expect(messages).toHaveLength(1);

    await attempt('not_found');

    expect(messages).toHaveLength(1);

    await attempt('not_found');

    expect(messages).toHaveLength(2);
    expect(messages[1]!.body).toContain('consecutive not-found threshold');

    await attempt('not_found');

    expect(messages).toHaveLength(2);

    await attempt('found');

    expect((await shipments.find(shipment.externalId))!.monitoringStatus).toBe(
      'active',
    );

    await attempt('not_found');
    await attempt('not_found');

    expect(messages).toHaveLength(3);

    await attempt('found');
    status = 503;

    const delivered = await attempt('found', true);

    status = 200;

    expect(messages).toHaveLength(4);
    expect(messages[3]!.body).toContain(
      'Monitoring stopped: shipment delivered',
    );
    expect((await shipments.find(shipment.externalId))!.monitoringStatus).toBe(
      'completed',
    );

    await expect(tracking.finalizeNotFound(delivered)).rejects.toThrow();

    expect(messages).toHaveLength(4);
  },
);
