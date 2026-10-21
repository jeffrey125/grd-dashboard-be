import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import { AmazonAccountAccess } from './amazon-account-access.js';
import { AmazonVerificationWorker } from './amazon-verification.worker.js';
import { AmazonVerificationBridge } from './amazon-verification.bridge.js';

afterEach(() => vi.unstubAllEnvs());

it('starts optional worker IPC without API auth, shares the Amazon lock and closes cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staff-worker-'));
  const socket = join(directory, 'worker.sock');
  vi.stubEnv('AMAZON_VERIFICATION_SOCKET', socket);
  vi.stubEnv('AMAZON_SESSION_DIRECTORY', directory);
  vi.stubEnv('AMAZON_SESSION_KEY_FILE', join(directory, 'key'));
  vi.stubEnv('AMAZON_SHIPPING_EMAIL', 'fixture@example.test');
  vi.stubEnv('QUOTE_DEMO_MODE', 'false');
  const access = new AmazonAccountAccess();
  const worker = new AmazonVerificationWorker(access, {
    info: vi.fn(),
  } as unknown as ProjectLogger);
  const bridge = new AmazonVerificationBridge(socket);
  const command = {
    operation: 'start' as const,
    owner: 'staff:1',
    actorExternalId: '11111111-1111-4111-8111-111111111111',
    comparisonId: '22222222-2222-4222-8222-222222222222',
    attemptId: '33333333-3333-4333-8333-333333333333',
  };
  const release = access.acquire();
  try {
    await worker.onModuleInit();
    // Refusing a competing quote lock proves the optional worker is wired to
    // shared account access, without launching a browser or using credentials.
    await expect(bridge.send(command)).rejects.toThrow('busy');
    await worker.onModuleDestroy();
    await expect(bridge.send(command)).rejects.toThrow('unavailable');
  } finally {
    release();
    await worker.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  }
});
