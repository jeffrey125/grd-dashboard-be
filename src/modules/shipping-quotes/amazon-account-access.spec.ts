import { expect, it, vi } from 'vitest';
import { AmazonAccountAccess } from './amazon-account-access.js';
import { SenderDefaultsWorker } from './sender-defaults.worker.js';
import type { SenderDefaultsRepository } from './sender-defaults.repository.js';

it('holds Amazon exclusion through quote cleanup and refuses concurrent readiness/recovery', async () => {
  const access = new AmazonAccountAccess();
  const adapter = {
    simulated: false,
    quote: vi.fn(async () => ({ outcome: 'success' })),
    relogin: vi.fn(),
    close: vi.fn(async () => {}),
  };
  const quote = access.quote(adapter as never);
  const readiness = access.readiness({ readiness: vi.fn(), close: vi.fn() });
  await quote.quote({} as never, new AbortController().signal);
  expect(() => access.acquire()).toThrow('busy');
  await expect(readiness.readiness('request')).rejects.toThrow('busy');
  await readiness.close();
  expect(() => access.acquire()).toThrow('busy');
  await quote.close({} as never);
  const release = access.acquire();
  expect(
    await quote.quote({} as never, new AbortController().signal),
  ).toMatchObject({ reason: 'verification_required' });
  await quote.close({} as never);
  expect(() => access.acquire()).toThrow('busy');
  release();
  expect(access.acquire()).toBeTypeOf('function');
});

it('includes legacy Amazon sender refresh in the lock while allowing another provider', async () => {
  const access = new AmazonAccountAccess();
  const release = access.acquire();
  const repository = {
    claim: vi
      .fn()
      .mockResolvedValueOnce({ code: 'amazon' })
      .mockResolvedValueOnce({ code: 'unishippers' }),
    finish: vi.fn(),
  };
  const gateway = { read: vi.fn().mockResolvedValue({ country: 'US' }) };
  const worker = new SenderDefaultsWorker(
    repository as unknown as SenderDefaultsRepository,
    gateway,
    access,
  );
  await worker.runOnce();
  expect(gateway.read).not.toHaveBeenCalled();
  expect(repository.finish).toHaveBeenLastCalledWith({ code: 'amazon' }, null);
  await worker.runOnce();
  expect(gateway.read).toHaveBeenCalledWith('unishippers');
  release();
});
