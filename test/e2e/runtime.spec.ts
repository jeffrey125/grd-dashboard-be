import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testEnvironment } from '../support/environment.js';

type Runtime = { child: ChildProcessWithoutNullStreams; output: () => string };
const children: Runtime[] = [];
const directories: string[] = [];

function start(
  entry: 'main' | 'worker',
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Runtime {
  const child = spawn(process.execPath, [resolve('dist', `${entry}.js`)], {
    cwd,
    // Do not inherit developer credentials or other application configuration.
    env: { PATH: process.env.PATH, ...env },
    stdio: 'pipe',
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const runtime = { child, output: () => output };
  children.push(runtime);
  return runtime;
}

async function waitForExit(runtime: Runtime) {
  await vi.waitFor(
    () => {
      expect(
        runtime.child.exitCode !== null || runtime.child.signalCode !== null,
      ).toBe(true);
    },
    { timeout: 10000, interval: 25 },
  );
}

async function waitForReady(runtime: Runtime, label: string) {
  await vi.waitFor(
    () => {
      expect(runtime.output()).toContain(`${label} ready`);
      expect(runtime.child.exitCode).toBeNull();
      expect(runtime.child.signalCode).toBeNull();
    },
    { timeout: 10000, interval: 25 },
  );
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return String(address.port);
}

afterEach(async () => {
  for (const runtime of children.splice(0)) {
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
      runtime.child.kill('SIGKILL');
      await waitForExit(runtime);
    }
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe.each([
  { entry: 'main' as const, label: 'API' },
  { entry: 'worker' as const, label: 'Worker' },
])('$label production entry point', ({ entry, label }) => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'executes application shutdown hooks on %s',
    async (signal) => {
      const runtime = start(entry, {
        ...testEnvironment,
        PORT: await availablePort(),
      });
      await waitForReady(runtime, label);
      runtime.child.kill(signal);
      await waitForExit(runtime);
      expect(runtime.output()).toContain('Application stopped');
      // Nest completes shutdown hooks, removes its listener, then re-sends the signal.
      expect(runtime.child.signalCode).toBe(signal);
      expect(runtime.output()).not.toContain('startup failed');
    },
  );

  it('fails for missing database configuration before reporting ready', async () => {
    const runtime = start(entry, {
      NODE_ENV: 'test',
      PORT: await availablePort(),
    });
    await waitForExit(runtime);
    expect(runtime.child.exitCode).toBe(1);
    expect(runtime.output()).toContain('DB_PASSWORD is required');
    expect(runtime.output()).toContain('DB_HOST is required');
    expect(runtime.output()).not.toContain(`${label} ready`);
  });

  it('rejects invalid configuration without printing any supplied secrets', async () => {
    const canary = 'CANARY_PROCESS_SECRET';
    const runtime = start(entry, {
      ...testEnvironment,
      NODE_ENV: canary,
      PORT: canary,
      DB_PASSWORD: canary,
      ECHOSHIP_PASSWORD: canary,
    });
    await waitForExit(runtime);
    expect(runtime.child.exitCode).toBe(1);
    expect(runtime.output()).toContain('Invalid configuration');
    expect(runtime.output()).not.toContain(canary);
    expect(runtime.output()).not.toContain(`${label} ready`);
  });
});

describe('runtime boundaries', () => {
  it('keeps API readiness healthy with no worker, while sharing a configured port, and after worker shutdown', async () => {
    const port = await availablePort();
    const env = { ...testEnvironment, PORT: port };
    const api = start('main', env);
    await waitForReady(api, 'API');
    const url = `http://127.0.0.1:${port}/health/ready`;
    expect((await fetch(url)).status).toBe(200);
    const worker = start('worker', env);
    await waitForReady(worker, 'Worker');
    // The API owns this port. A worker HTTP listener would fail startup here.
    expect((await fetch(url)).status).toBe(200);
    worker.child.kill('SIGTERM');
    await waitForExit(worker);
    expect((await fetch(url)).status).toBe(200);
  });

  it('loads .env without expanding passwords and gives process environment precedence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'grd-runtime-env-'));
    directories.push(directory);
    await writeFile(
      join(directory, '.env'),
      [
        'NODE_ENV=development',
        'PORT=invalid-file-port',
        'DB_PORT=5432',
        'DB_HOST=127.0.0.1',
        'DB_NAME=runtime_test',
        'DB_USER=runtime_test',
        'DB_PASSWORD="$UNSET_LITERAL_PASSWORD"',
      ].join('\n'),
    );
    const port = await availablePort();
    const api = start('main', { PORT: port }, directory);
    await waitForReady(api, 'API');
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(
      200,
    );
    expect(api.output()).not.toContain('$UNSET_LITERAL_PASSWORD');
  });

  it('reports an occupied API port safely and exits without leaving its context open', async () => {
    const port = await availablePort();
    const first = start('main', { ...testEnvironment, PORT: port });
    await waitForReady(first, 'API');
    const second = start('main', {
      ...testEnvironment,
      PORT: port,
      DB_PASSWORD: 'CANARY_PORT_SECRET',
    });
    await waitForExit(second);
    expect(second.child.exitCode).toBe(1);
    expect(second.output()).toContain('Application stopped');
    expect(second.output()).toContain(
      'Check runtime configuration and port availability',
    );
    expect(second.output()).not.toContain('CANARY_PORT_SECRET');
    expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(
      200,
    );
  });
});
