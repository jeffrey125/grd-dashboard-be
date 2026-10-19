import type {
  ExecutionResult,
  LeasedQuote,
  QuoteReason,
  QuoteOutcome,
} from './quote-execution.repository.js';

export interface QuoteAdapter {
  readonly simulated: boolean;
  quote(job: LeasedQuote, signal: AbortSignal): Promise<ExecutionResult>;
  relogin(job: LeasedQuote, signal: AbortSignal): Promise<void>;
  close(job: LeasedQuote): Promise<void>;
}

export function quoteFailure(
  reason: QuoteReason,
  simulated = false,
): ExecutionResult {
  const outcomes: Partial<Record<QuoteReason, QuoteOutcome>> = {
    validation_failed: 'validation_failed',
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

  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  let abort: () => void = () => undefined;

  try {
    const cancelled = new Promise<ExecutionResult>((resolve) => {
      abort = () => resolve(quoteFailure('timeout', adapter.simulated));
      signal.addEventListener('abort', abort, { once: true });

      if (signal.aborted) abort();
    });

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

    return { ...(await Promise.race([run(), cancelled])), relogins };
  } catch {
    return {
      ...quoteFailure(
        relogging ? 'authentication_failed' : 'provider_failed',
        adapter.simulated,
      ),
      relogins,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    deadline.abort();
    // Cleanup is bounded even when a provider adapter ignores cancellation.
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.resolve()
        .then(() => adapter.close(job))
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        cleanupTimer = setTimeout(resolve, 1000);
      }),
    ]);
    clearTimeout(cleanupTimer);
  }
}
