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
import { Writable } from 'node:stream';
import { Test, type TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { createConfiguration } from '@config/configuration.js';
import { createPinoHttpOptions } from '@infrastructure/logging/logging.options.js';
import { PinoLoggerService } from '@infrastructure/logging/pino-logger.service.js';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { deferred } from '@test/support/deferred.js';
import { TypeOrmTrackingWorkRepository } from '@modules/tracking/typeorm-tracking-work.repository.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { TrackingSchedulerService } from '@modules/tracking/tracking-scheduler.service.js';
import { TrackingExecutorService } from '@modules/tracking/tracking-executor.service.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TypeOrmCarriersRepository } from '@modules/carriers/typeorm-carriers.repository.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import type {
  CarrierAdapter,
  TrackingSession,
  TrackingResult,
} from '@modules/carriers/adapters/carrier-adapter.js';

let logger: ProjectLogger;
const logLines: string[] = [];

describe('Tracking worker with PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let logging: TestingModule;

  beforeAll(async () => {
    db = await shipmentDatabase();

    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(chunk.toString());
        callback();
      },
    });

    logging = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [
            createPinoHttpOptions(
              { ...createConfiguration(db.environment), logLevel: 'debug' },
              'worker',
            ),
            destination,
          ],
        }),
      ],
      providers: [PinoLoggerService],
    }).compile();
    logger = logging.get(PinoLoggerService);
  });
  afterAll(async () => {
    await logging?.close();
    await db?.close();
  });
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    logLines.length = 0;
    await db.source.query(
      'TRUNCATE TABLE tracking_attempts, shipment_tracking_snapshots, tracking_runs, shipments RESTART IDENTITY',
    );
    await db.source.query(
      'UPDATE carriers SET is_active = true, deleted_at = NULL',
    );
  });

  async function shipment(reference: string, code = 'ups') {
    const carrier = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code });
    const result = await new TypeOrmShipmentsRepository(db.source).createMany([
      {
        carrierExternalId: carrier.externalId,
        trackingReference: reference,
        notes: null,
      },
    ]);

    if (result.kind !== 'created') throw new Error('Expected creation');

    return { ...result.inserted[0]!, carrier };
  }

  async function fixture(
    openSession: (
      code: string,
      options: Parameters<CarrierAdapter['openSession']>[0],
    ) => Promise<TrackingSession>,
    normalize?: (reference: string) => string,
  ) {
    const tracking = new TrackingService(
      new TypeOrmTrackingRepository(db.source),
    );
    const carriers = new TypeOrmCarriersRepository(db.source);
    const registry = new CarrierAdapterRegistry(
      (await carriers.listActive()).map((carrier) => ({
        code: carrier.code,
        minimumIntervalMinutes: 60,
        referencePolicy: {
          ...carrierReferencePolicy(carrier.code),
          ...(normalize ? { normalize } : {}),
        },
        validateConfiguration() {},
        openSession: (options: Parameters<CarrierAdapter['openSession']>[0]) =>
          openSession(carrier.code, options),
      })),
    );
    const worker = new TrackingSchedulerService(
      new TypeOrmTrackingWorkRepository(db.source),
      carriers,
      tracking,
      registry,
      new TrackingExecutorService(tracking, registry, logger),
      logger,
    );

    return { worker, tracking };
  }

  async function clockScheduler(worker: TrackingSchedulerService) {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));

    const module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [{ provide: TrackingSchedulerService, useValue: worker }],
    }).compile();

    await module.init();

    return module;
  }

  it.each([false, true])(
    'skips delivered lookups expiring during session setup (batch=%s)',
    async (batch) => {
      const item = await shipment('follow-up-session-cutoff');
      await db.source.query(
        `WITH snapshot AS (
      INSERT INTO shipment_tracking_snapshots (shipment_id, carrier_status, delivered_on)
      SELECT id, 'Delivered', (clock_timestamp() AT TIME ZONE 'America/New_York')::date
      FROM shipments WHERE external_id = $1 RETURNING id, shipment_id
    ) UPDATE shipments SET current_tracking_snapshot_id = snapshot.id,
      monitoring_status = 'completed', monitoring_reason = 'delivered', next_check_at = NULL,
      follow_up_on = (clock_timestamp() AT TIME ZONE 'America/New_York')::date + 1
      FROM snapshot WHERE shipments.id = snapshot.shipment_id`,
        [item.externalId],
      );
      const read = vi.fn(async (): Promise<TrackingResult> => ({
        outcome: 'not_found',
        sourceData: null,
      }));
      const readMany = vi.fn(async () => new Map<string, TrackingResult>());
      const close = vi.fn(async () => {});
      const { worker } = await fixture(async () => {
        await db.source.query(
          `UPDATE shipments SET follow_up_on = (clock_timestamp() AT TIME ZONE 'America/New_York')::date WHERE external_id = $1`,
          [item.externalId],
        );
        return { read, close, ...(batch ? { readMany } : {}) };
      });
      try {
        await worker.start();
        await worker.tick();
        expect(read).not.toHaveBeenCalled();
        expect(readMany).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
        const [stored] = await db.source.query(
          'SELECT monitoring_status, next_check_at FROM shipments WHERE external_id = $1',
          [item.externalId],
        );
        expect(stored).toEqual({
          monitoring_status: 'completed',
          next_check_at: null,
        });
        const [attempt] = await db.source.query(
          'SELECT outcome FROM tracking_attempts',
        );
        expect(attempt.outcome).toBe('skipped');
      } finally {
        await worker.onModuleDestroy();
      }
    },
  );

  it('captures mode at execution, not queue time, and keeps it through later Carrier edits', async () => {
    const item = await shipment('69451086', 'echoship');
    const tracking = new TrackingService(
      new TypeOrmTrackingRepository(db.source),
    );
    const carriers = new TypeOrmCarriersRepository(db.source);
    const run = await tracking.createRun({
      carrierExternalId: item.carrier.externalId,
      trigger: 'manual',
      shipmentExternalIds: [item.externalId],
      requestedById: null,
    });

    expect(run.fetchMode).toBeNull();

    await carriers.update(item.carrier.externalId, { fetchMode: 'browser' });

    const started = await tracking.startRun(run.externalId);

    expect(started.fetchMode).toBe('browser');

    await carriers.update(item.carrier.externalId, { fetchMode: 'request' });
    await tracking.interruptRun({
      runExternalId: run.externalId,
      retryable: true,
      reasonCode: 'TEST_INTERRUPTED',
      message: 'Fixture interruption',
    });

    const [stored] = await db.source.query(
      'SELECT fetch_mode FROM tracking_runs WHERE external_id = $1',
      [run.externalId],
    );

    expect(stored.fetch_mode).toBe('browser');
  });

  it('selects only due active Shipments belonging to an active non-deleted Carrier', async () => {
    const ups = await db.source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ups' });
    const shipments = new TypeOrmShipmentsRepository(db.source);
    const result = await shipments.createMany(
      ['due', 'future', 'paused', 'deleted'].map((trackingReference) => ({
        carrierExternalId: ups.externalId,
        trackingReference,
        notes: null,
      })),
    );

    if (result.kind !== 'created') throw new Error('Expected creation');

    await db.source.query(
      "UPDATE shipments SET next_check_at = clock_timestamp() + interval '1 hour' WHERE tracking_reference = 'future'",
    );
    await db.source.query(
      "UPDATE shipments SET monitoring_status = 'paused', monitoring_reason = 'manual', next_check_at = NULL WHERE tracking_reference = 'paused'",
    );
    await db.source.query(
      "UPDATE shipments SET deleted_at = clock_timestamp() WHERE tracking_reference = 'deleted'",
    );

    const repository = new TypeOrmTrackingWorkRepository(db.source);
    const due = result.inserted.find((row) => row.trackingReference === 'due')!;

    expect(await repository.findDue(ups.externalId, 60)).toEqual([
      due.externalId,
    ]);

    await db.source.query(
      'UPDATE carriers SET is_active = false WHERE id = $1',
      [ups.id],
    );

    expect(await repository.findDue(ups.externalId, 60)).toEqual([]);

    await db.source.query(
      'UPDATE carriers SET is_active = true, deleted_at = clock_timestamp() WHERE id = $1',
      [ups.id],
    );

    expect(await repository.findDue(ups.externalId, 60)).toEqual([]);

    await db.source.query(
      'UPDATE carriers SET deleted_at = NULL WHERE id = $1',
      [ups.id],
    );
  });

  it('automatically executes due work and persists outcomes through the tracking service', async () => {
    await shipment('due');

    const tracking = new TrackingService(
      new TypeOrmTrackingRepository(db.source),
    );
    const carriers = new TypeOrmCarriersRepository(db.source);
    const reads: string[] = [];
    const registry = new CarrierAdapterRegistry(
      (await carriers.listActive()).map((carrier) => ({
        code: carrier.code,
        minimumIntervalMinutes: 60,
        referencePolicy: carrierReferencePolicy(carrier.code),
        validateConfiguration() {},
        async openSession() {
          return {
            async read(reference: string) {
              reads.push(reference);

              return { outcome: 'not_found' as const, sourceData: null };
            },
            async close() {},
          };
        },
      })),
    );
    const executor = new TrackingExecutorService(tracking, registry, logger);
    const worker = new TrackingSchedulerService(
      new TypeOrmTrackingWorkRepository(db.source),
      carriers,
      tracking,
      registry,
      executor,
      logger,
    );
    const clock = await clockScheduler(worker);

    try {
      await worker.start();
      await worker.tick();

      expect(reads).toEqual(['due']);

      const [row] = await db.source.query(
        "SELECT consecutive_not_found_count, next_check_at - last_attempted_at AS delay FROM shipments WHERE tracking_reference = 'due'",
      );

      expect(row.consecutive_not_found_count).toBe(1);
      expect(row.delay.hours).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000);
      await worker.tick();

      expect(reads).toEqual(['due']);
    } finally {
      await clock.close();
    }
  });

  it('serves a manual request arriving mid-round before the next Carrier without delaying that Shipment schedule', async () => {
    await shipment('echo', 'echoship');
    await shipment('ffe', 'ffe');

    const ups = await shipment('ups');
    const opened = deferred<void>();
    const release = deferred<void>();
    const order: string[] = [];
    const { worker, tracking } = await fixture(async (code) => ({
      async read(reference) {
        order.push(reference);

        if (code === 'echoship') {
          opened.resolve();
          await release.promise;
        }

        return { outcome: 'not_found', sourceData: null };
      },
      async close() {},
    }));
    const clock = await clockScheduler(worker);

    try {
      await worker.start();
      await opened.promise;
      await tracking.createRun({
        carrierExternalId: ups.carrier.externalId,
        trigger: 'manual',
        shipmentExternalIds: [ups.externalId],
        requestedById: null,
      });
      await vi.advanceTimersByTimeAsync(180_000);

      expect(order).toEqual(['echo']);

      release.resolve();
      await worker.tick();

      expect(order).toEqual(['echo', 'ups', 'ffe', 'ups']);

      const runs = await db.source.query(
        'SELECT trigger, status FROM tracking_runs ORDER BY id',
      );

      expect(runs).toEqual([
        { trigger: 'scheduled', status: 'succeeded' },
        { trigger: 'manual', status: 'succeeded' },
        { trigger: 'scheduled', status: 'succeeded' },
        { trigger: 'scheduled', status: 'succeeded' },
      ]);
    } finally {
      release.resolve();
      await clock.close();
      await vi.advanceTimersByTimeAsync(100);
    }
  });

  it('enforces the scheduled minimum from scheduled history while ignoring later manual attempts', async () => {
    const target = await shipment('minimum');
    const { worker, tracking } = await fixture(async () => ({
      async read() {
        return { outcome: 'not_found', sourceData: null };
      },
      async close() {},
    }));

    try {
      const scheduled = await tracking.createRun({
        carrierExternalId: target.carrier.externalId,
        trigger: 'scheduled',
        shipmentExternalIds: [target.externalId],
        requestedById: null,
      });
      const run = await tracking.startRun(scheduled.externalId);

      await tracking.finalizeNotFound({
        runExternalId: run.externalId,
        shipmentExternalId: target.externalId,
        expectedLockVersion: run.targets[0]!.expectedLockVersion,
        effectiveIntervalMinutes: 30,
        sourceData: null,
      });
      await tracking.finalizeRun(run.externalId);
      await db.source.query(
        "UPDATE shipments SET next_check_at = clock_timestamp() - interval '1 minute'",
      );

      const repository = new TypeOrmTrackingWorkRepository(db.source);

      expect(await repository.findDue(target.carrier.externalId, 60)).toEqual(
        [],
      );

      await db.source.query(
        "UPDATE tracking_attempts SET completed_at = clock_timestamp() - interval '61 minutes'",
      );

      const manual = await tracking.createRun({
        carrierExternalId: target.carrier.externalId,
        trigger: 'manual',
        shipmentExternalIds: [target.externalId],
        requestedById: null,
      });
      const manualRun = await tracking.startRun(manual.externalId);

      await tracking.finalizeNotFound({
        runExternalId: manual.externalId,
        shipmentExternalId: target.externalId,
        expectedLockVersion: manualRun.targets[0]!.expectedLockVersion,
        effectiveIntervalMinutes: 60,
        sourceData: null,
      });
      await tracking.finalizeRun(manual.externalId);

      expect(await repository.findDue(target.carrier.externalId, 60)).toEqual([
        target.externalId,
      ]);
    } finally {
      await worker.onModuleDestroy();
    }
  });

  it('isolates a thrown lookup failure and closes the session after persisting mixed outcomes', async () => {
    await shipment('bad');
    await shipment('good');

    let closes = 0;
    const { worker } = await fixture(async () => ({
      async read(reference) {
        if (reference === 'bad') throw new Error('secret provider credential');

        return {
          outcome: 'found',
          sourceData: null,
          snapshot: {
            carrierStatus: 'In transit',
            carrierStatusDetail: null,
            pickedUpOn: null,
            estimatedDeliveryOn: null,
            deliveredOn: null,
          },
        };
      },
      async close() {
        closes++;
      },
    }));

    try {
      await worker.start();
      await worker.tick();

      expect(closes).toBe(1);
      expect(await db.source.query('SELECT status FROM tracking_runs')).toEqual(
        [{ status: 'partially_succeeded' }],
      );

      const attempts = await db.source.query(
        'SELECT outcome, reason_code, message FROM tracking_attempts ORDER BY id',
      );

      expect(attempts.map((row: { outcome: string }) => row.outcome)).toEqual([
        'failed',
        'found',
      ]);
      expect(JSON.stringify(attempts)).not.toContain('secret');

      const [failed] = await db.source.query(
        "SELECT consecutive_not_found_count, next_check_at - last_attempted_at AS delay FROM shipments WHERE tracking_reference = 'bad'",
      );

      expect(failed.consecutive_not_found_count).toBe(0);
      expect(failed.delay.hours).toBe(1);
    } finally {
      await worker.onModuleDestroy();
    }
  });

  it('uses one batch read per Carrier and classifies missing batch entries as failures', async () => {
    await shipment('one', 'ffe');
    await shipment('two', 'ffe');

    let batches = 0;
    const { worker } = await fixture(async () => ({
      async read() {
        throw new Error('Individual reads must not run for a batch');
      },
      async readMany(references) {
        batches++;

        expect(references).toEqual(['one', 'two']);

        return new Map([
          ['one', { outcome: 'not_found' as const, sourceData: null }],
        ]);
      },
      async close() {},
    }));

    try {
      await worker.start();
      await worker.tick();

      expect(batches).toBe(1);
      expect(
        await db.source.query(
          'SELECT outcome, reason_code FROM tracking_attempts ORDER BY id',
        ),
      ).toEqual([
        { outcome: 'not_found', reason_code: null },
        { outcome: 'failed', reason_code: 'BATCH_RESULT_MISSING' },
      ]);
    } finally {
      await worker.onModuleDestroy();
    }
  });

  it('treats malformed adapter results as individual technical failures', async () => {
    await shipment('malformed');
    await shipment('valid');

    const { worker } = await fixture(async () => ({
      async read(reference) {
        if (reference === 'malformed')
          return {
            outcome: 'found',
            snapshot: { deliveredOn: 'bad-date' },
            sourceData: null,
          } as unknown as TrackingResult;

        return { outcome: 'not_found', sourceData: null };
      },
      async close() {},
    }));

    try {
      await worker.start();
      await worker.tick();

      expect(
        await db.source.query(
          'SELECT outcome, reason_code FROM tracking_attempts ORDER BY id',
        ),
      ).toEqual([
        { outcome: 'failed', reason_code: 'INVALID_ADAPTER_RESULT' },
        { outcome: 'not_found', reason_code: null },
      ]);
    } finally {
      await worker.onModuleDestroy();
    }
  });

  it('recovers running work, cancels abandoned scheduled work, and serves retained manual work first', async () => {
    const target = await shipment('recover');
    const reads: string[] = [];
    const { worker, tracking } = await fixture(async () => ({
      async read(reference) {
        reads.push(reference);

        return { outcome: 'not_found', sourceData: null };
      },
      async close() {},
    }));
    const command = {
      carrierExternalId: target.carrier.externalId,
      shipmentExternalIds: [target.externalId],
      requestedById: null,
    };
    const interrupted = await tracking.createRun({
      ...command,
      trigger: 'scheduled',
    });

    await tracking.startRun(interrupted.externalId);

    const abandoned = await tracking.createRun({
      ...command,
      trigger: 'scheduled',
    });
    const queued = await tracking.createRun({ ...command, trigger: 'manual' });
    const clock = await clockScheduler(worker);

    try {
      await worker.start();
      await worker.tick();

      expect(
        await db.source.query(
          'SELECT external_id, status, reason_code FROM tracking_runs ORDER BY id LIMIT 3',
        ),
      ).toEqual([
        {
          external_id: interrupted.externalId,
          status: 'failed',
          reason_code: 'WORKER_INTERRUPTED',
        },
        {
          external_id: abandoned.externalId,
          status: 'cancelled',
          reason_code: 'RUN_CANCELLED',
        },
        {
          external_id: queued.externalId,
          status: 'succeeded',
          reason_code: null,
        },
      ]);
      expect(reads).toEqual(['recover', 'recover']);

      await vi.advanceTimersByTimeAsync(60_000);
      await worker.tick();

      expect(reads).toEqual(['recover', 'recover']);
      expect(
        await db.source.query(
          "SELECT id FROM tracking_attempts WHERE outcome = 'pending'",
        ),
      ).toEqual([]);
    } finally {
      await clock.close();
    }
  });

  it('validates batch references individually and uses normalized keys for results', async () => {
    await shipment('invalid', 'ffe');
    await shipment('valid', 'ffe');

    const { worker } = await fixture(
      async () => ({
        async read() {
          throw new Error('Unexpected single read');
        },
        async readMany(references) {
          expect(references).toEqual(['VALID']);

          return new Map([
            ['VALID', { outcome: 'not_found' as const, sourceData: null }],
          ]);
        },
        async close() {},
      }),
      (reference) => {
        if (reference === 'invalid') throw new Error('Invalid');

        return reference.toUpperCase();
      },
    );

    try {
      await worker.start();
      await worker.tick();

      expect(
        await db.source.query(
          'SELECT outcome, reason_code FROM tracking_attempts ORDER BY id',
        ),
      ).toEqual([
        { outcome: 'failed', reason_code: 'INVALID_TRACKING_REFERENCE' },
        { outcome: 'not_found', reason_code: null },
      ]);
    } finally {
      await worker.onModuleDestroy();
    }
  });

  it('persists session-open failures with normal intervals using the real logging contract', async () => {
    await shipment('open-error');

    const { worker } = await fixture(async () => {
      throw new Error('CANARY_SESSION_SECRET');
    });

    try {
      await worker.start();
      await worker.tick();

      expect(worker.status().state).toBe('ready');
      expect(
        await db.source.query(
          'SELECT outcome, reason_code FROM tracking_attempts',
        ),
      ).toEqual([{ outcome: 'failed', reason_code: 'SESSION_OPEN_FAILED' }]);

      const [row] = await db.source.query(
        'SELECT next_check_at - last_attempted_at AS delay FROM shipments',
      );

      expect(row.delay.hours).toBe(1);
      expect(logLines.join('')).toContain('tracking.session.open-failed');
      expect(logLines.join('')).not.toContain('CANARY_SESSION_SECRET');
    } finally {
      await worker.onModuleDestroy();
    }
  });

  it('preserves completed work when session cleanup fails and emits safe diagnostics', async () => {
    await shipment('close-error');

    const { worker } = await fixture(async () => ({
      async read() {
        return { outcome: 'not_found', sourceData: null };
      },
      async close() {
        throw new Error('CANARY_CLOSE_SECRET');
      },
    }));

    try {
      await worker.start();
      await worker.tick();

      expect(worker.status().state).toBe('ready');
      expect(await db.source.query('SELECT status FROM tracking_runs')).toEqual(
        [{ status: 'succeeded' }],
      );
      expect(logLines.join('')).toContain('tracking.session.close-failed');
      expect(logLines.join('')).not.toContain('CANARY_CLOSE_SECRET');
    } finally {
      await worker.onModuleDestroy();
    }
  });

  it('interrupts an uncooperative lookup, preserves earlier results and leaves queued manual work intact', async () => {
    await shipment('first');

    const target = await shipment('second');
    const reading = deferred<void>();
    const release = deferred<void>();
    let closes = 0;
    const { worker, tracking } = await fixture(async () => ({
      async read(reference) {
        if (reference === 'second') {
          reading.resolve();
          await release.promise;
        }

        return { outcome: 'not_found', sourceData: null };
      },
      async close() {
        closes++;
      },
    }));

    try {
      await worker.start();
      await reading.promise;

      const queued = await tracking.createRun({
        carrierExternalId: target.carrier.externalId,
        shipmentExternalIds: [target.externalId],
        trigger: 'manual',
        requestedById: null,
      });

      await worker.onModuleDestroy();

      expect(closes).toBe(1);
      expect(
        await db.source.query(
          'SELECT outcome, reason_code FROM tracking_attempts ORDER BY id',
        ),
      ).toEqual([
        { outcome: 'not_found', reason_code: null },
        { outcome: 'failed', reason_code: 'WORKER_SHUTDOWN' },
        { outcome: 'pending', reason_code: null },
      ]);
      expect(
        await new TypeOrmTrackingWorkRepository(db.source).nextManual(),
      ).toEqual({
        externalId: queued.externalId,
        carrierExternalId: target.carrier.externalId,
      });

      release.resolve();
      await worker.tick();

      const [row] = await db.source.query(
        "SELECT consecutive_not_found_count FROM shipments WHERE tracking_reference = 'second'",
      );

      expect(row.consecutive_not_found_count).toBe(0);
    } finally {
      release.resolve();
      await worker.onModuleDestroy();
    }
  });
});
