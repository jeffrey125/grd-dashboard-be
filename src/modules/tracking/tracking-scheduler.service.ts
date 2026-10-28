import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { firstValueFrom, from, map, race, timer } from 'rxjs';
import { safeErrorFields } from '@infrastructure/logging/safe-error-fields.js';
import {
  CARRIERS_REPOSITORY,
  type CarriersRepository,
} from '@modules/carriers/carriers.repository.js';
import {
  AdapterConfigurationError,
  CarrierAdapterRegistry,
} from '@modules/carriers/adapters/carrier-adapter.registry.js';
import { TrackingService } from './tracking.service.js';
import { TrackingExecutorService } from './tracking-executor.service.js';
import {
  TRACKING_WORK_REPOSITORY,
  type TrackingWorkRepository,
} from './tracking-work.repository.js';
import { TrackingOperationError } from './tracking.repository.js';

@Injectable()
export class TrackingSchedulerService implements OnModuleDestroy {
  private state: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped' =
    'stopped';
  private reasonCode: string | null = null;
  private readonly controller = new AbortController();
  private active: Promise<void> | undefined;

  constructor(
    @Inject(TRACKING_WORK_REPOSITORY)
    private readonly work: TrackingWorkRepository,
    @Inject(CARRIERS_REPOSITORY) private readonly carriers: CarriersRepository,
    @Inject(TrackingService) private readonly tracking: TrackingService,
    @Inject(CarrierAdapterRegistry)
    private readonly adapters: CarrierAdapterRegistry,
    @Inject(TrackingExecutorService)
    private readonly executor: TrackingExecutorService,
    @Inject(ProjectLogger) private readonly logger: ProjectLogger,
  ) {}

  status() {
    return { state: this.state, reasonCode: this.reasonCode };
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped' || this.controller.signal.aborted)
      throw new Error('Worker already started or stopped');

    this.state = 'starting';

    try {
      for (const carrier of (await this.carriers.listActive()).filter(
        (carrier) => carrier.code !== 'other',
      ))
        this.adapters.validate(carrier.code, carrier.fetchMode);

      for (const runExternalId of await this.work.interruptedRuns())
        await this.tracking.interruptRun({
          runExternalId,
          retryable: true,
          reasonCode: 'WORKER_INTERRUPTED',
          message: 'Previous worker stopped before tracking completed.',
        });

      // Scheduled targets may have changed during downtime. Cancel and rescan them.
      for (const id of await this.work.abandonedScheduledRuns())
        await this.tracking.cancelRun(id);

      this.state = 'ready';
      void this.tick();
    } catch (error) {
      this.fail(error);

      throw error;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'tracking-due-scan',
    waitForCompletion: true,
  })
  tick(): Promise<void> {
    if (this.active) return this.active;

    if (this.state !== 'ready') return Promise.resolve();

    this.active = this.round()
      .catch((error) => {
        if (!this.controller.signal.aborted) this.fail(error);
      })
      .finally(() => {
        this.active = undefined;
      });

    return this.active;
  }

  async onModuleDestroy(): Promise<void> {
    this.state = 'stopping';
    this.controller.abort();

    try {
      await firstValueFrom(
        race(
          from(this.active ?? Promise.resolve()),
          timer(30_000).pipe(
            map(() => {
              this.logger.warn(
                'tracking.shutdown.timeout',
                'Worker cleanup exceeded 30 seconds; startup recovery will finish interrupted state',
              );
            }),
          ),
        ),
      );
    } finally {
      this.state = 'stopped';
    }
  }

  private async round() {
    const signal = this.controller.signal;
    await this.tracking.reconcileDeliveredMonitoring();
    const carriers = (await this.carriers.listActive()).filter(
      (carrier) => carrier.code !== 'other',
    );
    await this.adapters.retainSessions(carriers.map((carrier) => carrier.code));

    for (const carrier of carriers)
      this.adapters.validate(carrier.code, carrier.fetchMode);

    await this.manualWork();

    for (const selected of carriers) {
      signal.throwIfAborted();
      await this.manualWork();

      const carrier = await this.carriers.find(selected.externalId);

      if (!carrier?.isActive) continue;

      const adapter = this.adapters.validate(carrier.code, carrier.fetchMode);
      const targets = await this.work.findDue(
        carrier.externalId,
        adapter.minimumIntervalMinutes,
      );

      if (!targets.length) continue;

      signal.throwIfAborted();

      try {
        const run = await this.tracking.createRun({
          carrierExternalId: carrier.externalId,
          trigger: 'scheduled',
          shipmentExternalIds: targets,
          requestedById: null,
        });

        await this.executor.execute(run.externalId, carrier, signal);
      } catch (error) {
        if (
          error instanceof TrackingOperationError &&
          ['CARRIER_UNAVAILABLE', 'SHIPMENT_UNAVAILABLE'].includes(error.code)
        )
          continue;

        throw error;
      }
    }

    await this.manualWork();
  }

  private async manualWork() {
    while (!this.controller.signal.aborted) {
      const run = await this.work.nextManual();

      if (!run) return;

      const carrier = await this.carriers.find(run.carrierExternalId);

      await this.executor.execute(
        run.externalId,
        carrier,
        this.controller.signal,
      );
    }
  }

  private fail(error: unknown) {
    this.state = 'failed';
    this.reasonCode =
      error instanceof AdapterConfigurationError
        ? error.reasonCode
        : 'WORKER_FAILED';
    this.logger.error(
      'tracking.worker.failed',
      error instanceof AdapterConfigurationError
        ? error.message
        : 'Tracking worker failed; restart after resolving the failure',
      {
        reasonCode: this.reasonCode,
        ...(error instanceof AdapterConfigurationError
          ? { carrierCode: error.carrierCode, ...error.diagnostics }
          : safeErrorFields(error)),
      },
    );
  }
}
