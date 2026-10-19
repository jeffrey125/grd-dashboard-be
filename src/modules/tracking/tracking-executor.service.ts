import { Inject, Injectable } from '@nestjs/common';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { safeErrorFields } from '@infrastructure/logging/safe-error-fields.js';
import type { CarrierRecord } from '@modules/carriers/carriers.repository.js';
import { CarrierAdapterRegistry } from '@modules/carriers/adapters/carrier-adapter.registry.js';
import type {
  TrackingResult,
  TrackingSession,
} from '@modules/carriers/adapters/carrier-adapter.js';
import { trackingResultSchema } from '@modules/carriers/adapters/carrier-result.js';
import {
  firstValueFrom,
  from,
  fromEvent,
  mergeMap,
  race,
  throwError,
} from 'rxjs';
import { TrackingService } from './tracking.service.js';
import type {
  StartedTrackingRun,
  TrackingExecutionTarget,
} from './tracking.repository.js';

/** Observe cancellation even if a provider ignores its signal; discard late results. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const interrupted = () => new Error('Tracking interrupted');

  if (signal.aborted) return Promise.reject(interrupted());

  return firstValueFrom(
    race(
      from(operation),
      fromEvent(signal, 'abort').pipe(mergeMap(() => throwError(interrupted))),
    ),
  );
}

function technicalFailure(
  reasonCode: string,
): Extract<TrackingResult, { outcome: 'failed' }> {
  return {
    outcome: 'failed',
    retryable: true,
    reasonCode,
    message: 'Carrier lookup could not be completed.',
    sourceData: null,
  };
}

@Injectable()
export class TrackingExecutorService {
  constructor(
    @Inject(TrackingService) private readonly tracking: TrackingService,
    @Inject(CarrierAdapterRegistry)
    private readonly adapters: CarrierAdapterRegistry,
    @Inject(ProjectLogger) private readonly logger: ProjectLogger,
  ) {}

  async execute(
    runExternalId: string,
    carrier: CarrierRecord | null,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();

    const run = await this.tracking.startRun(runExternalId);
    const log = this.logger.child({
      component: 'tracking.executor',
      carrierCode: run.carrierCode,
      runExternalId,
      trigger: run.trigger,
    });
    let session: TrackingSession | undefined;

    try {
      signal.throwIfAborted();

      if (!run.targets.length) {
        await this.tracking.finalizeRun(runExternalId);

        return;
      }

      if (!carrier) throw new Error('Carrier unavailable');

      const adapter = this.adapters.validate(
        run.carrierCode,
        run.fetchMode ?? undefined,
      );
      const interval = Math.max(
        carrier.pollIntervalMinutes,
        adapter.minimumIntervalMinutes,
      );
      const targets: TrackingExecutionTarget[] = [];

      for (const target of run.targets) {
        signal.throwIfAborted();

        try {
          targets.push({
            ...target,
            trackingReference: adapter.referencePolicy.normalize(
              target.trackingReference,
            ),
          });
        } catch {
          await this.persist(
            run,
            target,
            {
              ...technicalFailure('INVALID_TRACKING_REFERENCE'),
              outcome: 'failed',
              retryable: false,
            },
            interval,
          );
        }
      }

      if (!targets.length) {
        await this.tracking.finalizeRun(runExternalId);

        return;
      }

      const opening = Promise.resolve().then(() =>
        adapter.openSession({
          fetchMode: run.fetchMode ?? undefined,
          signal,
          rateLimitPerMinute: carrier.rateLimitPerMinute,
        }),
      );

      // A late session must still be closed after cancellation won the race.
      void opening
        .then(async (opened) => {
          if (signal.aborted) await opened.close();
        })
        .catch((error) =>
          log.warn(
            'tracking.session.late-close-failed',
            'Late Carrier session failed',
            safeErrorFields(error),
          ),
        );

      try {
        session = await abortable(opening, signal);
      } catch (error) {
        signal.throwIfAborted();
        log.warn(
          'tracking.session.open-failed',
          'Carrier session could not be opened',
          safeErrorFields(error),
        );

        for (const target of targets) {
          signal.throwIfAborted();
          await this.persist(
            run,
            target,
            technicalFailure('SESSION_OPEN_FAILED'),
            interval,
          );
        }

        await this.tracking.finalizeRun(runExternalId);

        return;
      }

      if (session.readMany) {
        let results: ReadonlyMap<string, TrackingResult>;

        try {
          results = await abortable(
            session.readMany(
              targets.map((target) => target.trackingReference),
              signal,
            ),
            signal,
          );
        } catch (error) {
          signal.throwIfAborted();
          log.warn(
            'tracking.batch.failed',
            'Carrier batch lookup failed',
            safeErrorFields(error),
          );
          results = new Map(
            targets.map((target) => [
              target.trackingReference,
              technicalFailure('BATCH_LOOKUP_FAILED'),
            ]),
          );
        }

        for (const target of targets) {
          signal.throwIfAborted();
          await this.persist(
            run,
            target,
            results.get(target.trackingReference) ??
              technicalFailure('BATCH_RESULT_MISSING'),
            interval,
          );
        }
      } else {
        for (const target of targets) {
          signal.throwIfAborted();

          let result: TrackingResult;

          try {
            result = await abortable(
              session.read(target.trackingReference, signal),
              signal,
            );
          } catch (error) {
            signal.throwIfAborted();
            log.warn('tracking.lookup.failed', 'Carrier lookup failed', {
              shipmentExternalId: target.shipmentExternalId,
              ...safeErrorFields(error),
            });
            result = technicalFailure('LOOKUP_FAILED');
          }

          signal.throwIfAborted();
          await this.persist(run, target, result, interval);
        }
      }

      await this.tracking.finalizeRun(runExternalId);
      log.info('tracking.run.completed', 'Tracking run completed', {
        attemptedCount: run.targets.length,
      });
    } catch (error) {
      log.warn(
        'tracking.run.interrupted',
        'Tracking run interrupted',
        safeErrorFields(error),
      );
      await this.tracking.interruptRun({
        runExternalId,
        retryable: true,
        reasonCode: signal.aborted ? 'WORKER_SHUTDOWN' : 'RUN_EXECUTION_FAILED',
        message: signal.aborted
          ? 'Worker stopped before tracking completed.'
          : 'Tracking execution could not be completed.',
      });
    } finally {
      if (session) {
        try {
          await abortable(session.close(), AbortSignal.timeout(30_000));
        } catch (error) {
          log.warn(
            'tracking.session.close-failed',
            'Carrier session cleanup did not complete',
            safeErrorFields(error),
          );
        }
      }
    }
  }

  private async persist(
    run: StartedTrackingRun,
    target: TrackingExecutionTarget,
    input: TrackingResult,
    effectiveIntervalMinutes: number,
  ) {
    const parsed = trackingResultSchema.safeParse(input);
    const result = parsed.success
      ? parsed.data
      : technicalFailure('INVALID_ADAPTER_RESULT');
    const command = {
      runExternalId: run.externalId,
      shipmentExternalId: target.shipmentExternalId,
      expectedLockVersion: target.expectedLockVersion,
      effectiveIntervalMinutes,
    };

    switch (result.outcome) {
      case 'found':
        await this.tracking.finalizeFound({
          ...command,
          snapshot: result.snapshot,
          sourceData: result.sourceData,
        });
        break;
      case 'not_found':
        await this.tracking.finalizeNotFound({
          ...command,
          sourceData: result.sourceData,
        });
        break;
      case 'failed':
        await this.tracking.finalizeFailed({
          ...command,
          retryable: result.retryable,
          reasonCode: result.reasonCode,
          message: result.message,
          sourceData: result.sourceData,
        });
        break;
    }
  }
}
