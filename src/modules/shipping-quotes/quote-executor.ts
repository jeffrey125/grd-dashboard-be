import type {
  ExecutionResult,
  LeasedQuote,
  QuoteReason,
  QuoteOutcome,
} from './quote-execution.repository.js';
import { firstValueFrom, from, fromEvent, map, race, take, timer } from 'rxjs';

export interface QuoteAdapter {
  readonly simulated: boolean;
  quote(job: LeasedQuote, signal: AbortSignal): Promise<ExecutionResult>;
  relogin(job: LeasedQuote, signal: AbortSignal): Promise<void>;
  close(job: LeasedQuote): Promise<void>;
}

export class ProviderVerificationRequired extends Error {}

export function quoteFailure(
  reason: QuoteReason,
  simulated = false,
): ExecutionResult {
  const outcomes: Partial<Record<QuoteReason, QuoteOutcome>> = {
    validation_failed: 'validation_failed',
    sender_company_too_long: 'validation_failed',
    contact_details_required: 'validation_failed',
    unsupported: 'unsupported',
    timeout: 'timeout',
    authentication_failed: 'authentication_failed',
  };

  return {
    outcome: outcomes[reason] ?? 'failed',
    reason,
    simulated,
    relogins: 0,
    quotes: [],
  };
}

export async function executeQuote(
  job: LeasedQuote,
  adapter: QuoteAdapter | undefined,
  shutdown: AbortSignal,
  timeoutMs = 90000,
  reserveRelogin: () => Promise<boolean> = async () => true,
): Promise<ExecutionResult> {
  let relogins: 0 | 1 = job.reloginCount ?? 0;
  let relogging = false;

  if (!job.enabled) return { ...quoteFailure('provider_disabled'), relogins };

  if (!adapter) return { ...quoteFailure('adapter_unavailable'), relogins };

  const deadline = new AbortController();
  const signal = AbortSignal.any([shutdown, deadline.signal]);

  const deadlineTimer = setTimeout(() => deadline.abort(), timeoutMs);

  try {
    if (signal.aborted)
      return {
        ...quoteFailure('timeout', adapter.simulated),
        relogins,
      };

    const run = async () => {
      signal.throwIfAborted();
      let result = await adapter.quote(job, signal);

      if (
        result.outcome === 'authentication_failed' &&
        relogins === 0 &&
        (await reserveRelogin())
      ) {
        signal.throwIfAborted();
        relogins = 1;
        relogging = true;
        await adapter.relogin(job, signal);
        relogging = false;
        signal.throwIfAborted();
        result = await adapter.quote(job, signal);
      }

      return { ...result, simulated: adapter.simulated };
    };

    const cancelled = fromEvent(signal, 'abort').pipe(
      take(1),
      map(() => quoteFailure('timeout', adapter.simulated)),
    );

    return {
      ...(await firstValueFrom(race(from(run()), cancelled))),
      relogins,
    };
  } catch (error) {
    return {
      ...quoteFailure(
        error instanceof ProviderVerificationRequired
          ? 'verification_required'
          : relogging
            ? 'authentication_failed'
            : 'provider_failed',
        adapter.simulated,
      ),
      relogins,
    };
  } finally {
    clearTimeout(deadlineTimer);
    deadline.abort();
    // Cleanup is bounded even when a provider adapter ignores cancellation.
    await firstValueFrom(
      race(
        from(Promise.resolve().then(() => adapter.close(job))).pipe(
          map(() => undefined),
        ),
        timer(1000).pipe(map(() => undefined)),
      ),
    ).catch(() => undefined);
  }
}
