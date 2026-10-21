import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Opt-in live quote command', () => {
  it('reports every missing provider/mode as blocked without loading local credentials', () => {
    const run = spawnSync(
      process.execPath,
      ['test/support/shipping-quotes/live-adapter-smoke.mts'],
      { env: { PATH: process.env.PATH }, encoding: 'utf8' },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toBe('');
    expect(
      run.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual(
      [
        { provider: 'amazon', mode: 'api' },
        { provider: 'unishippers', mode: 'request' },
        { provider: 'unishippers', mode: 'browser' },
      ].map(({ provider, mode }) => ({
        provider,
        mode,
        outcome: 'blocked',
        reason: 'credentials_missing',
      })),
    );
  });

  it('limits an explicitly selected live check to its provider and mode', () => {
    const run = spawnSync(
      process.execPath,
      [
        'test/support/shipping-quotes/live-adapter-smoke.mts',
        '--',
        '--provider',
        'amazon',
        '--mode',
        'api',
      ],
      { env: { PATH: process.env.PATH }, encoding: 'utf8' },
    );
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual({
      provider: 'amazon',
      mode: 'api',
      outcome: 'blocked',
      reason: 'credentials_missing',
    });
  });
});
