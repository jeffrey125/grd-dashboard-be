import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { shipmentDatabase } from '@test/support/shipment-database.js';
import { TypeOrmShipmentsRepository } from '@modules/shipments/typeorm-shipments.repository.js';
import { TypeOrmCarriersRepository } from '@modules/carriers/typeorm-carriers.repository.js';
import { TypeOrmTrackingRepository } from '@modules/tracking/typeorm-tracking.repository.js';
import { TypeOrmTrackingHttpRepository } from '@modules/tracking/typeorm-tracking-http.repository.js';
import { TrackingService } from '@modules/tracking/tracking.service.js';
import { TrackingExecutorService } from '@modules/tracking/tracking-executor.service.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import type { TrackingResult } from '@modules/carriers/adapters/carrier-adapter.js';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';

const logger: ProjectLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  setLevel() {},
  child() {
    return this;
  },
};
const failed: TrackingResult = {
  outcome: 'failed',
  reasonCode: 'FIXTURE_LOOKUP_FAILED',
  retryable: true,
  message: 'Fixture failure',
  sourceData: null,
};
const found: TrackingResult = {
  outcome: 'found',
  snapshot: {
    carrierStatus: 'In transit',
    carrierStatusDetail: null,
    pickedUpOn: null,
    estimatedDeliveryOn: null,
    deliveredOn: null,
  },
  sourceData: null,
};

describe('durable monitoring safeguards', () => {
  let db: Awaited<ReturnType<typeof shipmentDatabase>>;
  let carriers: TypeOrmCarriersRepository;
  let tracking: TrackingService;
  let carrierId: string;
  let openFails = false;
  let result: TrackingResult = failed;
  const read = vi.fn(
    async (_reference: string, _signal: AbortSignal) => result,
  );
  const invalidateSession = vi.fn(async () => {});
  let executor: TrackingExecutorService;

  beforeAll(async () => {
    db = await shipmentDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.source.query(
      'TRUNCATE shipment_purchase_orders, tracking_attempts, shipment_tracking_snapshots, tracking_runs, shipments RESTART IDENTITY',
    );
    await db.source
      .query(`UPDATE carriers SET is_active = true, auto_disabled_reason = NULL,
      failure_pause_enabled = true, failure_pause_threshold = 2,
      session_failure_disable_enabled = true, session_failure_disable_threshold = 2,
      consecutive_session_failures = 0, session_generation = 0`);
    carriers = new TypeOrmCarriersRepository(db.source);
    carrierId = (await carriers.list()).find(
      (c) => c.code === 'echoship',
    )!.externalId;
    tracking = new TrackingService(new TypeOrmTrackingRepository(db.source));
    openFails = false;
    result = failed;
    read.mockClear();
    invalidateSession.mockClear();
    const registry = new CarrierAdapterRegistry([
      {
        code: 'echoship',
        minimumIntervalMinutes: 5,
        referencePolicy: carrierReferencePolicy('echoship'),
        validateConfiguration() {},
        invalidateSession,
        async openSession() {
          if (openFails) throw new Error('Fixture authentication unavailable');
          return { read, async close() {} };
        },
      },
    ]);
    executor = new TrackingExecutorService(tracking, registry, logger);
  });

  async function shipment(reference = '123456') {
    const created = await new TypeOrmShipmentsRepository(db.source).createMany([
      {
        carrierExternalId: carrierId,
        trackingReference: reference,
        notes: null,
      },
    ]);
    if (created.kind !== 'created') throw new Error('Expected creation');
    return created.inserted[0]!.externalId;
  }
  async function state(id: string) {
    return (
      await db.source.query(
        'SELECT monitoring_status, monitoring_reason, consecutive_failure_count, consecutive_not_found_count, next_check_at FROM shipments WHERE external_id = $1',
        [id],
      )
    )[0];
  }
  async function run(
    ids: string[],
    trigger: 'scheduled' | 'manual' = 'scheduled',
  ) {
    const run = await tracking.createRun({
      carrierExternalId: carrierId,
      shipmentExternalIds: ids,
      trigger,
      requestedById: null,
    });
    await executor.execute(
      run.externalId,
      await carriers.find(carrierId),
      new AbortController().signal,
    );
    return run;
  }

  it('pauses only a repeatedly failing shipment; valid not-found resets technical failures', async () => {
    const a = await shipment();
    const b = await shipment('654321');
    read.mockImplementation(async (reference) =>
      reference === '123456' ? failed : found,
    );
    await run([a, b]);
    expect(await state(a)).toMatchObject({
      monitoring_status: 'active',
      consecutive_failure_count: 1,
    });
    await run([a, b]);
    expect(await state(a)).toMatchObject({
      monitoring_status: 'paused',
      monitoring_reason: 'failure_threshold',
      consecutive_failure_count: 2,
      next_check_at: null,
    });
    expect(await state(b)).toMatchObject({
      monitoring_status: 'active',
      consecutive_failure_count: 0,
    });
    expect(await carriers.find(carrierId)).toMatchObject({
      isActive: true,
      consecutiveSessionFailures: 0,
    });

    read.mockImplementation(async () => ({
      outcome: 'not_found',
      sourceData: null,
    }));
    await run([a], 'manual');
    expect(await state(a)).toMatchObject({
      monitoring_status: 'paused',
      consecutive_failure_count: 0,
      consecutive_not_found_count: 1,
    });
    read.mockImplementation(async () => found);
    await run([a], 'manual');
    expect(await state(a)).toMatchObject({
      monitoring_status: 'active',
      monitoring_reason: null,
      consecutive_failure_count: 0,
    });
    expect((await state(a)).next_check_at).not.toBeNull();
  });

  it('counts one shared session failure per run and disables the carrier without pausing shipments', async () => {
    const a = await shipment();
    const b = await shipment('654321');
    openFails = true;
    read.mockImplementation(async () => failed);
    const first = await run([a, b]);
    expect(await carriers.find(carrierId)).toMatchObject({
      consecutiveSessionFailures: 1,
      isActive: true,
    });
    // Duplicate/late completion cannot count a finished run again.
    await tracking.recordSessionOutcome(first.externalId, false);
    await run([a, b]);
    expect(await carriers.find(carrierId)).toMatchObject({
      consecutiveSessionFailures: 2,
      isActive: false,
      autoDisabledReason: 'session_failures',
    });
    expect(await state(a)).toMatchObject({
      monitoring_status: 'active',
      consecutive_failure_count: 0,
    });
    expect(await state(b)).toMatchObject({
      monitoring_status: 'active',
      consecutive_failure_count: 0,
    });
    expect(read).not.toHaveBeenCalled();
    expect(invalidateSession).toHaveBeenCalledOnce();
    expect(
      await new TypeOrmTrackingHttpRepository(db.source).queue(a, 1),
    ).toEqual({ kind: 'unavailable' });
    // New service/repository instances retain durable state.
    expect(
      await new TypeOrmCarriersRepository(db.source).find(carrierId),
    ).toMatchObject({ isActive: false, consecutiveSessionFailures: 2 });
  });

  it('stops further lookups after mid-run authentication failure and counts it only against the carrier', async () => {
    const a = await shipment();
    const b = await shipment('654321');
    read.mockImplementation(async () => ({
      ...failed,
      reasonCode: 'ECHOSHIP_AUTHENTICATION_FAILED',
    }));
    await run([a, b]);
    expect(read).toHaveBeenCalledOnce();
    expect(await carriers.find(carrierId)).toMatchObject({
      consecutiveSessionFailures: 1,
    });
    expect(await state(a)).toMatchObject({ consecutive_failure_count: 0 });
    expect(await state(b)).toMatchObject({ consecutive_failure_count: 0 });
  });

  it('supports disabled safeguards and resets counters when re-enabled without resuming paused shipments', async () => {
    const a = await shipment();
    read.mockImplementation(async () => failed);
    await carriers.update(carrierId, {
      failurePauseEnabled: false,
      sessionFailureDisableEnabled: false,
    });
    await run([a]);
    await run([a]);
    await run([a]);
    expect(await state(a)).toMatchObject({
      monitoring_status: 'active',
      consecutive_failure_count: 3,
    });
    openFails = true;
    await run([a]);
    await run([a]);
    await run([a]);
    expect(await carriers.find(carrierId)).toMatchObject({
      isActive: true,
      consecutiveSessionFailures: 3,
    });
    await carriers.update(carrierId, {
      failurePauseEnabled: true,
      sessionFailureDisableEnabled: true,
    });
    expect(await state(a)).toMatchObject({ consecutive_failure_count: 0 });
    expect(await carriers.find(carrierId)).toMatchObject({
      consecutiveSessionFailures: 0,
    });
    openFails = false;
    await carriers.update(carrierId, { failurePauseThreshold: 1 });
    await run([a]);
    await carriers.update(carrierId, { failurePauseEnabled: false });
    await carriers.update(carrierId, { failurePauseEnabled: true });
    expect(await state(a)).toMatchObject({
      monitoring_status: 'paused',
      consecutive_failure_count: 0,
    });
  });

  it('resets session failure streak on healthy validation and honors a configured carrier threshold', async () => {
    const a = await shipment();
    read.mockImplementation(async () => found);
    openFails = true;
    await run([a]);
    openFails = false;
    await run([a]);
    expect(await carriers.find(carrierId)).toMatchObject({
      consecutiveSessionFailures: 0,
    });
    await carriers.update(carrierId, { sessionFailureDisableThreshold: 1 });
    openFails = true;
    await run([a]);
    expect(await carriers.find(carrierId)).toMatchObject({ isActive: false });
    await carriers.update(carrierId, { isActive: true });
    expect(await carriers.find(carrierId)).toMatchObject({
      isActive: true,
      autoDisabledReason: null,
      consecutiveSessionFailures: 0,
    });
  });

  it('resets a prior session failure after lazy authentication succeeds even if the lookup fails', async () => {
    const a = await shipment();
    openFails = true;
    await run([a]);
    const registry = new CarrierAdapterRegistry([
      {
        code: 'echoship',
        minimumIntervalMinutes: 5,
        referencePolicy: carrierReferencePolicy('echoship'),
        validateConfiguration() {},
        async openSession() {
          let authenticated = false;
          return {
            healthVerifiedAtOpen: false,
            get authenticationSucceeded() {
              return authenticated;
            },
            async read() {
              authenticated = true;
              return failed;
            },
            async close() {},
          };
        },
      },
    ]);
    executor = new TrackingExecutorService(tracking, registry, logger);
    await run([a]);
    expect(await carriers.find(carrierId)).toMatchObject({
      consecutiveSessionFailures: 0,
      isActive: true,
    });
    expect(await state(a)).toMatchObject({
      consecutive_failure_count: 1,
      monitoring_status: 'active',
    });
  });

  it('does not apply a stale session result after an admin disables and re-enables a carrier', async () => {
    const a = await shipment();
    const pending = await tracking.createRun({
      carrierExternalId: carrierId,
      shipmentExternalIds: [a],
      trigger: 'scheduled',
      requestedById: null,
    });
    await tracking.startRun(pending.externalId);
    await carriers.update(carrierId, { isActive: false });
    await carriers.update(carrierId, { isActive: true });
    await tracking.recordSessionOutcome(pending.externalId, false);
    expect(await carriers.find(carrierId)).toMatchObject({
      isActive: true,
      consecutiveSessionFailures: 0,
    });
  });
});
