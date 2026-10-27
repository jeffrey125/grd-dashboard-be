import { Test } from '@nestjs/testing';
import { deferred } from '@test/support/deferred.js';
import { ScheduleModule } from '@nestjs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import {
  CARRIERS_REPOSITORY,
  type CarrierRecord,
  type CarriersRepository,
} from '@modules/carriers/carriers.repository.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import { carrierReferencePolicy } from '@modules/carriers/carrier-reference-policy.js';
import {
  TRACKING_WORK_REPOSITORY,
  type TrackingWorkRepository,
} from './tracking-work.repository.js';
import { TrackingService } from './tracking.service.js';
import { TrackingExecutorService } from './tracking-executor.service.js';
import { TrackingSchedulerService } from './tracking-scheduler.service.js';

const carrier: CarrierRecord = {
  externalId: '00000000-0000-4000-8000-000000000001',
  code: 'ups',
  name: 'UPS',
  isActive: true,
  failurePauseEnabled: true,
  failurePauseThreshold: 2,
  sessionFailureDisableEnabled: true,
  sessionFailureDisableThreshold: 2,
  consecutiveSessionFailures: 0,
  sessionGeneration: 0,
  autoDisabledReason: null,
  fetchMode: 'request',
  pollIntervalMinutes: 30,
  notFoundPauseThreshold: 5,
  rateLimitPerMinute: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
};
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

async function fixture(
  options: {
    work?: Partial<TrackingWorkRepository>;
    missingAdapter?: boolean;
  } = {},
) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));

  const work: TrackingWorkRepository = {
    findDue: vi.fn(async () => []),
    nextManual: vi.fn(async () => null),
    interruptedRuns: async () => [],
    abandonedScheduledRuns: async () => [],
    ...options.work,
  };
  const carriers: CarriersRepository = {
    list: async () => [carrier],
    listActive: async () => [carrier],
    find: async () => carrier,
    update: async () => carrier,
  };
  const registry = new CarrierAdapterRegistry(
    options.missingAdapter
      ? []
      : [
          {
            code: 'ups',
            minimumIntervalMinutes: 60,
            referencePolicy: carrierReferencePolicy('ups'),
            validateConfiguration() {},
            async openSession() {
              throw new Error('No due work in this fixture');
            },
          },
        ],
  );
  // The real persistence service stays installed; this fixture never creates runs.
  const tracking = new TrackingService({
    async transaction() {
      throw new Error('Unexpected persistence');
    },
  });
  vi.spyOn(tracking, 'reconcileDeliveredMonitoring').mockResolvedValue();
  const module = await Test.createTestingModule({
    imports: [ScheduleModule.forRoot()],
    providers: [
      TrackingSchedulerService,
      TrackingExecutorService,
      { provide: TRACKING_WORK_REPOSITORY, useValue: work },
      { provide: CARRIERS_REPOSITORY, useValue: carriers },
      { provide: CarrierAdapterRegistry, useValue: registry },
      { provide: TrackingService, useValue: tracking },
      { provide: ProjectLogger, useValue: logger },
    ],
  }).compile();

  await module.init();

  return { module, worker: module.get(TrackingSchedulerService), work };
}

afterEach(() => vi.useRealTimers());

describe('Worker scheduling with fake time', () => {
  it('starts immediately, scans every 60 seconds, and stops scheduling on shutdown', async () => {
    const f = await fixture();

    try {
      await f.worker.start();
      await f.worker.tick();

      expect(f.work.findDue).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(59_999);

      expect(f.work.findDue).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);

      expect(f.work.findDue).toHaveBeenCalledTimes(2);
      expect(f.work.findDue).toHaveBeenLastCalledWith(carrier.externalId, 60);
    } finally {
      await f.module.close();
    }

    await vi.advanceTimersByTimeAsync(120_000);

    expect(f.work.findDue).toHaveBeenCalledTimes(2);
    expect(f.worker.status()).toEqual({ state: 'stopped', reasonCode: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overlap an immediate startup round with cron ticks or explicit ticks', async () => {
    const gate = deferred<null>();
    const nextManual = vi.fn(async () => gate.promise);
    const f = await fixture({ work: { nextManual } });

    try {
      await f.worker.start();
      await vi.advanceTimersByTimeAsync(180_000);

      expect(nextManual).toHaveBeenCalledTimes(1);
      expect(f.work.findDue).not.toHaveBeenCalled();

      const sameRound = f.worker.tick();

      gate.resolve(null);
      await sameRound;

      expect(f.work.findDue).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve(null);
      await f.module.close();
    }

    await vi.advanceTimersByTimeAsync(100);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses startup before polling if an enabled adapter is missing', async () => {
    const f = await fixture({ missingAdapter: true });

    try {
      await expect(f.worker.start()).rejects.toThrow(
        'Enabled Carrier has no registered adapter: ups',
      );
      await vi.advanceTimersByTimeAsync(120_000);

      expect(f.worker.status()).toEqual({
        state: 'failed',
        reasonCode: 'ADAPTER_MISSING',
      });
      expect(f.work.findDue).not.toHaveBeenCalled();
    } finally {
      await f.module.close();
    }
  });

  it('bounds shutdown even when a database operation never settles', async () => {
    const gate = deferred<null>();
    const f = await fixture({ work: { nextManual: async () => gate.promise } });

    await f.worker.start();

    const stop = f.module.close();

    await vi.advanceTimersByTimeAsync(30_000);
    await stop;

    expect(f.worker.status().state).toBe('stopped');

    gate.resolve(null);
    await f.worker.tick();

    expect(f.work.findDue).not.toHaveBeenCalled();
  });
});
