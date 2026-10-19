import { describe, expect, it, vi } from 'vitest';
import { executeQuote } from './quote-executor.js';
import { FixtureQuoteAdapter } from './fixture-quote.adapter.js';
import type { LeasedQuote } from './quote-execution.repository.js';

const job = { code: 'amazon', enabled: true } as LeasedQuote;

describe('Quote provider execution boundary', () => {
  it('does not relogin again after recovery, and classifies a technical replay error as failed', async () => {
    const recovered = { ...job, reloginCount: 1 as const };
    const expired = new FixtureQuoteAdapter('authentication_failed', 0);
    const login = vi.spyOn(expired, 'relogin');

    expect(
      await executeQuote(recovered, expired, new AbortController().signal),
    ).toMatchObject({ outcome: 'authentication_failed', relogins: 1 });
    expect(login).not.toHaveBeenCalled();

    const replay = new FixtureQuoteAdapter('auth_replay', 0);
    const original = replay.quote.bind(replay);
    let calls = 0;
    replay.quote = async (work, signal) => {
      if (++calls > 1) throw new Error('private technical details');
      return original(work, signal);
    };

    expect(
      await executeQuote(job, replay, new AbortController().signal),
    ).toMatchObject({
      outcome: 'failed',
      reason: 'provider_failed',
      relogins: 1,
    });
  });
  it('relogs in and replays exactly once after authentication expiry', async () => {
    const adapter = new FixtureQuoteAdapter('auth_replay', 0);

    const result = await executeQuote(
      job,
      adapter,
      new AbortController().signal,
      1000,
    );

    expect(result).toMatchObject({
      outcome: 'success',
      relogins: 1,
      simulated: true,
    });

    expect(result.quotes[0]).toMatchObject({
      total: '12.500000',
      currency: 'USD',
    });
  });

  it.each([
    'validation_failed',
    'unsupported',
    'failed',
    'authentication_failed',
  ] as const)(
    'makes %s terminal without technical retries',
    async (scenario) => {
      const adapter = new FixtureQuoteAdapter(scenario, 0);
      const call = vi.spyOn(adapter, 'quote');
      const login = vi.spyOn(adapter, 'relogin');

      const result = await executeQuote(
        job,
        adapter,
        new AbortController().signal,
        1000,
      );

      expect(result.outcome).toBe(scenario);

      expect(call).toHaveBeenCalledTimes(
        scenario === 'authentication_failed' ? 2 : 1,
      );

      expect(login).toHaveBeenCalledTimes(
        scenario === 'authentication_failed' ? 1 : 0,
      );
    },
  );

  it('bounds timeouts and discards an uncooperative late response', async () => {
    const adapter = new FixtureQuoteAdapter('timeout', 0);

    expect(
      await executeQuote(job, adapter, new AbortController().signal, 10),
    ).toMatchObject({ outcome: 'timeout', quotes: [], relogins: 0 });
    adapter.quote = () => new Promise(() => undefined);

    expect(
      await executeQuote(job, adapter, new AbortController().signal, 10),
    ).toMatchObject({ outcome: 'timeout', quotes: [] });
  });

  it('reports an unavailable adapter and never exposes exception text', async () => {
    expect(
      await executeQuote(job, undefined, new AbortController().signal),
    ).toMatchObject({ reason: 'adapter_unavailable', simulated: false });

    const adapter = new FixtureQuoteAdapter('success', 0);
    adapter.quote = async () => {
      throw new Error('SECRET raw provider payload');
    };

    const result = await executeQuote(
      job,
      adapter,
      new AbortController().signal,
    );

    expect(result.reason).toBe('provider_failed');

    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
