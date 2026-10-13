import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { setTimeout as allowDatabaseIO } from 'node:timers/promises';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { ApplicationCacheModule } from '@infrastructure/cache/application-cache.module.js';
import { LoggingModule } from '@infrastructure/logging/logging.module.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { CarrierAdaptersModule } from '@modules/carriers/adapters/carrier-adapters.module.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import {
  CARRIER_ADAPTERS,
  type CarrierAdapter,
} from '@modules/carriers/adapters/carrier-adapter.js';
import { UpsAdapter } from '@modules/carriers/adapters/ups/ups.adapter.js';
import { UPS_HTTP_ADAPTER } from '@modules/carriers/adapters/ups/ups.client.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import { TypeOrmCarriersRepository } from '@modules/carriers/typeorm-carriers.repository.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TypeOrmTrackingWorkRepository } from '@modules/tracking/typeorm-tracking-work.repository.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TrackingExecutorService } from '@modules/tracking/tracking-executor.service.js';
import { TrackingSchedulerService } from '@modules/tracking/tracking-scheduler.service.js';

describe('UPS tracking worker with PostgreSQL and mocked HTTP', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let module: TestingModule;
  let worker: TrackingSchedulerService;
  let tracking: TrackingService;
  let carriers: TypeOrmCarriersRepository;
  let calls: InternalAxiosRequestConfig[];
  let respond: AxiosAdapter;
  let otherReads: number;

  function response(
    config: InternalAxiosRequestConfig,
    data: unknown,
    status = 200,
    headers = {},
  ) {
    const result = {
      config,
      data,
      status,
      headers: { 'content-type': 'application/json', ...headers },
      statusText: String(status),
    };
    if (status >= 400)
      throw new AxiosError(
        'PRIVATE_PROVIDER_DETAIL',
        undefined,
        config,
        undefined,
        result,
      );
    return result;
  }

  async function finish<T>(promise: Promise<T>): Promise<T> {
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let tick = 0; !settled && tick < 10_000; tick++) {
      await vi.advanceTimersByTimeAsync(100);
      // Let real PostgreSQL sockets progress before advancing their timeout clocks.
      await allowDatabaseIO(2);
    }
    if (!settled)
      throw new Error('Worker did not finish within fake-time bound');
    return promise;
  }

  beforeAll(async () => {
    db = await shipmentDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.source.query(
      'TRUNCATE TABLE tracking_attempts, shipment_tracking_snapshots, tracking_runs, shipments RESTART IDENTITY',
    );
    await db.source.query("UPDATE carriers SET is_active = code = 'ups'");
    for (const [key, value] of Object.entries(db.environment))
      vi.stubEnv(key, value);
    vi.stubEnv('UPS_ENVIRONMENT', 'cie');
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('UPS_CLIENT_ID', 'fixture-client');
    vi.stubEnv('UPS_CLIENT_SECRET', 'fixture-secret');
    calls = [];
    otherReads = 0;
    module = await Test.createTestingModule({
      imports: [
        ApplicationCacheModule,
        CarrierAdaptersModule,
        LoggingModule.forRoot('worker'),
      ],
    })
      .overrideProvider(UPS_HTTP_ADAPTER)
      .useValue(async (config: InternalAxiosRequestConfig) => {
        calls.push(config);
        if (config.method === 'post')
          return response(config, {
            access_token: 'PRIVATE_TOKEN',
            expires_in: 3600,
          });
        return respond(config);
      })
      .overrideProvider(CARRIER_ADAPTERS)
      .useFactory({
        inject: [UpsAdapter],
        factory: (ups: UpsAdapter): CarrierAdapter[] => [
          ups,
          {
            code: 'ffe',
            minimumIntervalMinutes: 5,
            referencePolicy: carrierReferencePolicy('ffe'),
            validateConfiguration() {},
            async openSession() {
              return {
                async read() {
                  otherReads++;
                  return { outcome: 'not_found', sourceData: null };
                },
                async close() {},
              };
            },
          },
        ],
      })
      .compile();
    carriers = new TypeOrmCarriersRepository(db.source);
    tracking = new TrackingService(new TypeOrmTrackingRepository(db.source));
    const registry = module.get(CarrierAdapterRegistry);
    const logger = module.get(ProjectLogger);
    worker = new TrackingSchedulerService(
      new TypeOrmTrackingWorkRepository(db.source),
      carriers,
      tracking,
      registry,
      new TrackingExecutorService(tracking, registry, logger),
      logger,
    );
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(async () => {
    if (worker) await finish(worker.onModuleDestroy());
    if (module) await finish(module.close());
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function shipment(reference: string, code = 'ups') {
    const carrier = (await carriers.list()).find((row) => row.code === code)!;
    const result = await new TypeOrmShipmentsRepository(db.source).createMany([
      {
        carrierExternalId: carrier.externalId,
        trackingReference: reference,
        notes: null,
      },
    ]);
    if (result.kind !== 'created') throw new Error('Expected creation');
    return { shipment: result.inserted[0]!, carrier };
  }

  it('persists sanitized found, not-found, malformed, and invalid-reference outcomes through the registered adapter', async () => {
    await shipment('FOUND001');
    await shipment('MISSING1');
    await shipment('BADBODY1');
    await shipment('short');
    const pkg = {
      trackingNumber: 'FOUND001',
      currentStatus: { description: 'Delivered' },
      deliveryDate: [{ type: 'DEL', date: '20261012' }],
    };
    respond = async (config) => {
      if (config.url?.endsWith('MISSING1')) return response(config, {}, 404);
      if (config.url?.endsWith('BADBODY1'))
        return response(config, { private: 'PRIVATE_PAYLOAD' });
      return response(config, {
        trackResponse: {
          shipment: [{ package: [{ ...pkg, address: 'PRIVATE_ADDRESS' }] }],
        },
      });
    };
    await worker.start();
    await finish(worker.tick());
    expect(worker.status()).toEqual({ state: 'ready', reasonCode: null });
    expect(await db.source.query('SELECT status FROM tracking_runs')).toEqual([
      { status: 'partially_succeeded' },
    ]);
    const attempts = await db.source.query(
      'SELECT outcome, reason_code, source_data FROM tracking_attempts ORDER BY id',
    );
    expect(attempts).toEqual([
      { outcome: 'found', reason_code: null, source_data: pkg },
      { outcome: 'not_found', reason_code: null, source_data: null },
      {
        outcome: 'failed',
        reason_code: 'UPS_INVALID_RESPONSE',
        source_data: null,
      },
      {
        outcome: 'failed',
        reason_code: 'INVALID_TRACKING_REFERENCE',
        source_data: null,
      },
    ]);
    expect(
      await db.source.query(
        'SELECT carrier_status, delivered_on::text FROM shipment_tracking_snapshots',
      ),
    ).toEqual([{ carrier_status: 'Delivered', delivered_on: '2026-10-12' }]);
    const shipments = await db.source.query(
      'SELECT monitoring_status, consecutive_not_found_count, verification_url, next_check_at - last_attempted_at AS delay FROM shipments ORDER BY id',
    );
    expect(shipments[0]).toMatchObject({
      monitoring_status: 'completed',
      verification_url: 'https://www.ups.com/track?loc=en_US&trackn=FOUND001',
    });
    expect(shipments[1]).toMatchObject({
      consecutive_not_found_count: 1,
      delay: { hours: 1 },
    });
    expect(shipments[2]).toMatchObject({
      consecutive_not_found_count: 0,
      delay: { hours: 1 },
    });
    expect(calls).toHaveLength(4);
    expect(JSON.stringify(attempts)).not.toContain('PRIVATE');
  });

  it('persists the shared cooldown, preserves a previous snapshot, and continues another Carrier', async () => {
    const first = await shipment('COOLDOWN1');
    const second = await shipment('COOLDOWN2');
    await db.source.query(
      "UPDATE carriers SET is_active = true WHERE code = 'ffe'",
    );
    await shipment('other', 'ffe');
    const seed = await tracking.createRun({
      carrierExternalId: first.carrier.externalId,
      trigger: 'manual',
      shipmentExternalIds: [first.shipment.externalId],
      requestedById: null,
    });
    const started = await tracking.startRun(seed.externalId);
    await tracking.finalizeFound({
      runExternalId: seed.externalId,
      shipmentExternalId: first.shipment.externalId,
      expectedLockVersion: started.targets[0]!.expectedLockVersion,
      effectiveIntervalMinutes: 60,
      sourceData: null,
      snapshot: {
        carrierStatus: 'Moving',
        carrierStatusDetail: null,
        pickedUpOn: null,
        estimatedDeliveryOn: '2026-10-22',
        deliveredOn: null,
      },
    });
    await tracking.finalizeRun(seed.externalId);
    const manual = await tracking.createRun({
      carrierExternalId: first.carrier.externalId,
      trigger: 'manual',
      shipmentExternalIds: [
        first.shipment.externalId,
        second.shipment.externalId,
      ],
      requestedById: null,
    });
    respond = async (config) =>
      response(config, {}, 429, { 'retry-after': '3600' });
    await worker.start();
    await finish(worker.tick());
    expect(calls).toHaveLength(2);
    expect(otherReads).toBe(1);
    expect(worker.status().state).toBe('ready');
    const attempts = await db.source.query(
      'SELECT a.outcome, a.reason_code, a.retryable, a.message FROM tracking_attempts a JOIN tracking_runs r ON r.id = a.tracking_run_id WHERE r.external_id = $1 ORDER BY a.id',
      [manual.externalId],
    );
    expect(attempts).toEqual(
      Array.from({ length: 2 }, () => ({
        outcome: 'failed',
        reason_code: 'UPS_RATE_LIMITED',
        retryable: true,
        message: 'UPS temporarily unavailable. Tracking will retry later.',
      })),
    );
    expect(
      await db.source.query(
        'SELECT carrier_status, estimated_delivery_on::text FROM shipment_tracking_snapshots',
      ),
    ).toEqual([
      { carrier_status: 'Moving', estimated_delivery_on: '2026-10-22' },
    ]);
    expect(
      await db.source.query(
        "SELECT consecutive_not_found_count FROM shipments WHERE tracking_reference LIKE 'COOLDOWN%' ORDER BY id",
      ),
    ).toEqual([
      { consecutive_not_found_count: 0 },
      { consecutive_not_found_count: 0 },
    ]);
  });
});
