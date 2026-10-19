import { setTimeout } from 'node:timers/promises';
import type {
  ExecutionResult,
  LeasedQuote,
} from './quote-execution.repository.js';
import { quoteFailure, type QuoteAdapter } from './quote-executor.js';

export type FixtureScenario =
  | 'success'
  | 'validation_failed'
  | 'unsupported'
  | 'timeout'
  | 'auth_replay'
  | 'authentication_failed'
  | 'failed';

/** Explicit test/demo adapter. Never contacts a provider or reads credentials. */
export class FixtureQuoteAdapter implements QuoteAdapter {
  readonly simulated = true;
  private authenticated = false;

  constructor(
    private readonly scenario: FixtureScenario,
    private readonly delayMs = 1500,
  ) {}

  async quote(
    _job: LeasedQuote,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    await setTimeout(
      this.scenario === 'timeout' ? 120000 : this.delayMs,
      undefined,
      { signal },
    );

    if (this.scenario === 'auth_replay' && !this.authenticated)
      return quoteFailure('authentication_failed', true);

    if (this.scenario === 'failed')
      return quoteFailure('provider_failed', true);

    if (
      ['validation_failed', 'unsupported', 'authentication_failed'].includes(
        this.scenario,
      )
    )
      return quoteFailure(
        this.scenario as
          'validation_failed' | 'unsupported' | 'authentication_failed',
        true,
      );

    return {
      outcome: 'success',
      reason: null,
      simulated: true,
      relogins: 0,
      quotes: [
        {
          carrier: 'Simulated carrier',
          service: 'Simulated ground',
          total: '12.500000',
          currency: 'USD',
          estimateMethod: 'native',
        },
      ],
    };
  }

  async relogin(_job: LeasedQuote, signal: AbortSignal) {
    signal.throwIfAborted();
    this.authenticated = true;
  }

  async close() {
    this.authenticated = false;
  }
}
