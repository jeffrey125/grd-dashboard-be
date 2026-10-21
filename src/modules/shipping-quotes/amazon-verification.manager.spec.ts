import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { AmazonAccountAccess } from './amazon-account-access.js';
import { AmazonVerificationManager } from './amazon-verification.manager.js';
import {
  VerificationError,
  verificationCommandSchema,
} from './amazon-verification.contract.js';

const identity = {
  owner: 'staff:1',
  actorExternalId: '11111111-1111-4111-8111-111111111111',
  comparisonId: '22222222-2222-4222-8222-222222222222',
  attemptId: '33333333-3333-4333-8333-333333333333',
};
const managers: AmazonVerificationManager[] = [];
function setup() {
  let now = Date.now();
  const browser = {
    start: vi.fn(async () => {}),
    view: vi.fn(async () => ({
      verified: false as boolean,
      image: 'fixture',
      frame: '44444444-4444-4444-8444-444444444444',
      width: 400,
      height: 300,
    })),
    act: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const access = new AmazonAccountAccess();
  const logger = { info: vi.fn() };
  const manager = new AmazonVerificationManager(
    access,
    () => browser as never,
    logger as unknown as ProjectLogger,
    () => now,
  );
  managers.push(manager);
  const start = async () => {
    const view = await manager.command({ ...identity, operation: 'start' });
    await new Promise((resolve) => setImmediate(resolve));
    return view;
  };
  return {
    browser,
    access,
    manager,
    logger,
    start,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});

describe('Staff verification ownership and lifetime', () => {
  it('binds control to the staff auth session and comparison, preserving one Amazon account lock', async () => {
    const { manager, access, start, browser } = setup();
    const view = await start();
    expect(() => access.acquire()).toThrow('busy');
    await expect(
      manager.command({ ...identity, owner: 'other:2', operation: 'start' }),
    ).rejects.toThrow('busy');
    for (const operation of ['poll', 'cancel'] as const)
      await expect(
        manager.command({
          ...identity,
          owner: 'staff:2',
          operation,
          id: view.id,
        }),
      ).rejects.toThrow('owner_required');
    await expect(
      manager.command({
        ...identity,
        comparisonId: identity.attemptId,
        operation: 'poll',
        id: view.id,
      }),
    ).rejects.toThrow('owner_required');
    expect(browser.view).not.toHaveBeenCalled();
    expect(
      (await manager.command({ ...identity, operation: 'start' })).id,
    ).toBe(view.id);
    await manager.command({ ...identity, operation: 'cancel', id: view.id });
    expect(browser.close).toHaveBeenCalled();
    expect(access.acquire()).toBeTypeOf('function');
  });

  it('saves only after protected verification, closes the browser, and does not save twice', async () => {
    const { manager, browser, start, logger } = setup();
    const { id } = await start();
    expect(
      await manager.command({ ...identity, operation: 'poll', id }),
    ).toMatchObject({ state: 'challenge', image: 'fixture' });
    expect(browser.save).not.toHaveBeenCalled();
    browser.view.mockResolvedValueOnce({ verified: true } as never);
    expect(
      await manager.command({ ...identity, operation: 'poll', id }),
    ).toMatchObject({ state: 'verified' });
    expect(browser.save).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    await manager.command({ ...identity, operation: 'poll', id });
    expect(browser.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('fixture');
    expect(logger.info).toHaveBeenCalledWith(
      'amazon.verification',
      expect.any(String),
      { actorExternalId: identity.actorExternalId, outcome: 'verified' },
    );
  });

  it('expires disconnected staff without saving and releases the account', async () => {
    const { manager, browser, start, advance, access } = setup();
    const { id } = await start();
    advance(60_001);
    await expect(
      manager.command({ ...identity, operation: 'poll', id }),
    ).rejects.toThrow('expired');
    expect(browser.save).not.toHaveBeenCalled();
    expect(access.acquire()).toBeTypeOf('function');
  });

  it('enforces the absolute ten-minute deadline despite polling', async () => {
    const { manager, start, advance } = setup();
    const { id } = await start();
    for (let n = 0; n < 19; n++) {
      advance(30_000);
      await manager.command({ ...identity, operation: 'poll', id });
    }
    advance(30_000);
    await expect(
      manager.command({ ...identity, operation: 'poll', id }),
    ).rejects.toThrow('expired');
  });

  it('cancellation during verification prevents saving an in-flight result', async () => {
    const { manager, start, browser } = setup();
    const { id } = await start();
    let resolve!: (value: never) => void;
    browser.view.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const poll = manager.command({ ...identity, operation: 'poll', id });
    await new Promise((done) => setImmediate(done));
    await manager.command({ ...identity, operation: 'cancel', id });
    resolve({ verified: true } as never);
    await expect(poll).rejects.toThrow('expired');
    expect(browser.save).not.toHaveBeenCalled();
  });

  it('does not allow a failed save to be reported as verified', async () => {
    const { manager, start, browser } = setup();
    const { id } = await start();
    browser.view.mockResolvedValueOnce({ verified: true } as never);
    browser.save.mockRejectedValueOnce(new Error('private details'));
    await expect(
      manager.command({ ...identity, operation: 'poll', id }),
    ).rejects.toThrow('unsupported');
    await expect(
      manager.command({ ...identity, operation: 'poll', id }),
    ).rejects.toThrow('expired');
  });

  it('rejects arbitrary navigation, script execution, shortcuts and invalid coordinates', () => {
    const base = { ...identity, operation: 'action', id: identity.attemptId };
    for (const action of [
      { type: 'navigate', url: 'https://example.test' },
      { type: 'key', key: 'Control+L', frame: identity.attemptId },
      { type: 'click', x: 2, y: 0.5, frame: identity.attemptId },
      { type: 'text', text: 'a'.repeat(101), frame: identity.attemptId },
    ])
      expect(
        verificationCommandSchema.safeParse({ ...base, action }).success,
      ).toBe(false);
  });

  it('retains a session on stale frames but rejects overlapping control', async () => {
    const { manager, start, browser } = setup();
    const { id } = await start();
    browser.act.mockRejectedValueOnce(new VerificationError('stale_frame'));
    await expect(
      manager.command({
        ...identity,
        operation: 'action',
        id,
        action: { type: 'click', x: 0.5, y: 0.5, frame: identity.attemptId },
      }),
    ).rejects.toThrow('stale_frame');
    expect(
      await manager.command({ ...identity, operation: 'poll', id }),
    ).toMatchObject({ state: 'challenge' });
  });
});

it('waits for a fresh poll after input instead of capturing a page mid-navigation', async () => {
  const { manager, start, browser } = setup();
  const { id } = await start();
  browser.view.mockResolvedValueOnce({ verified: true } as never);
  const result = await manager.command({
    ...identity,
    operation: 'action',
    id,
    action: { type: 'click', x: 0.5, y: 0.5, frame: identity.attemptId },
  });
  expect(result.state).toBe('preparing');
  expect(browser.view).not.toHaveBeenCalled();
  expect(browser.save).not.toHaveBeenCalled();
  expect(
    (await manager.command({ ...identity, operation: 'poll', id })).state,
  ).toBe('verified');
  expect(browser.save).toHaveBeenCalledTimes(1);
});
