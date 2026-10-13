import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  afterAll,
  beforeAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  startPostgresqlContainer,
  postgresqlEnvironment,
} from '@test/support/postgresql-container.js';
import { AppModule } from '@app/app.module.js';
import { DatabaseModule } from '@infrastructure/database/database.module.js';
import { DatabaseReadiness } from '@infrastructure/database/database-readiness.js';
import { ApplicationLifecycleLogger } from '@infrastructure/logging/application-lifecycle-logger.js';
import { ReadinessService } from '@modules/health/readiness.service.js';
import { testEnvironment } from '@test/support/environment.js';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import { InitialSchema1791849600000 } from '@infrastructure/database/migrations/1791849600000-InitialSchema.js';

type Runtime = {
  child: ChildProcessWithoutNullStreams;
  output: () => string;
  closed: () => boolean;
};
const children: Runtime[] = [];
const directories: string[] = [];
const runtimeEnvironment = {
  ...testEnvironment,
  NODE_ENV: 'production',
  LOG_LEVEL: 'debug',
};
let container: StartedPostgreSqlContainer | undefined;
beforeAll(async () => {
  container = await startPostgresqlContainer();
  Object.assign(runtimeEnvironment, postgresqlEnvironment(container), {
    NODE_ENV: 'production',
    LOG_LEVEL: 'debug',
  });
  const source = new DataSource({
    ...createDatabaseOptions(createConfiguration(runtimeEnvironment)),
    migrations: [InitialSchema1791849600000],
  });
  await source.initialize();
  try {
    await source.runMigrations();
    // V1-012 ships the scheduler; real adapters arrive in V1-013 through V1-015.
    await source.query('UPDATE carriers SET is_active = false');
  } finally {
    await source.destroy();
  }
});
afterAll(async () => {
  await container?.stop();
});

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
  let closed = false;
  child.once('close', () => {
    closed = true;
  });
  const runtime = { child, output: () => output, closed: () => closed };
  children.push(runtime);
  return runtime;
}

async function waitForExit(runtime: Runtime) {
  await vi.waitFor(
    () => {
      expect(runtime.closed()).toBe(true);
    },
    { timeout: 25000, interval: 25 },
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

function jsonRecords(runtime: Runtime) {
  return runtime
    .output()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
  vi.unstubAllEnvs();
});

describe.each([
  { entry: 'main' as const, label: 'API' },
  { entry: 'worker' as const, label: 'Worker' },
])('$label production entry point', ({ entry, label }) => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'executes application shutdown hooks on %s',
    async (signal) => {
      const runtime = start(entry, {
        ...runtimeEnvironment,
        PORT: await availablePort(),
      });
      await waitForReady(runtime, label);
      runtime.child.kill(signal);
      await waitForExit(runtime);
      expect({
        exit: runtime.child.exitCode,
        signal: runtime.child.signalCode,
      }).toEqual({ exit: null, signal });
      expect(runtime.output()).toContain('Application stopped');
      // Nest completes shutdown hooks, removes its listener, then re-sends the signal.
      expect(runtime.child.signalCode).toBe(signal);
      expect(runtime.output()).not.toContain('startup failed');
      const records = jsonRecords(runtime);
      expect(records.filter((record) => record.event === 'nest.error')).toEqual(
        [],
      );
      expect(
        records.filter(
          (record) =>
            record.event === 'application.ready' &&
            record.message === `${label} ready`,
        ),
      ).toEqual([
        expect.objectContaining({
          level: 'info',
          service: 'grd-dashboard-be',
          environment: 'production',
          runtime: entry === 'main' ? 'api' : 'worker',
          component: 'application',
          event: 'application.ready',
          message: `${label} ready`,
        }),
      ]);
      expect(records).toContainEqual(
        expect.objectContaining({
          component: 'nest',
          event: 'nest.lifecycle',
        }),
      );
      expect(
        records.filter((record) => record.event === 'application.stopped'),
      ).toHaveLength(1);
    },
  );

  it('fails for missing database configuration before reporting ready', async () => {
    const runtime = start(entry, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'debug',
      PORT: await availablePort(),
    });
    await waitForExit(runtime);
    expect(runtime.child.exitCode).toBe(1);
    expect(runtime.output()).toContain('DB_PASSWORD is required');
    expect(runtime.output()).toContain('DB_HOST is required');
    expect(runtime.output()).not.toContain(`${label} ready`);
    expect(jsonRecords(runtime)).toContainEqual(
      expect.objectContaining({
        level: 'error',
        event: 'application.startup.failed',
      }),
    );
  });

  it('exits after three failed connection attempts without leaking credentials', async () => {
    const runtime = start(entry, {
      ...runtimeEnvironment,
      DB_PORT: await availablePort(),
      DB_PASSWORD: 'CANARY_DATABASE_SECRET',
      PORT: await availablePort(),
    });
    await waitForExit(runtime);
    expect(runtime.child.exitCode).toBe(1);
    const records = jsonRecords(runtime);
    expect(
      records.filter((record) => record.event === 'database.connecting'),
    ).toHaveLength(3);
    expect(
      records.filter((record) => record.event === 'database.connection.failed'),
    ).toHaveLength(3);
    expect(runtime.output()).not.toContain('CANARY_DATABASE_SECRET');
    expect(runtime.output()).not.toContain(`${label} ready`);
  });

  it('rejects invalid configuration without printing any supplied secrets', async () => {
    const canary = 'CANARY_PROCESS_SECRET';
    const runtime = start(entry, {
      ...runtimeEnvironment,
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
    jsonRecords(runtime);
  });
});

describe('runtime boundaries', () => {
  it('refuses worker startup for an enabled missing adapter without affecting API startup', async () => {
    const source = new DataSource(
      createDatabaseOptions(createConfiguration(runtimeEnvironment)),
    );
    await source.initialize();
    try {
      await source.query(
        "UPDATE carriers SET is_active = true WHERE code = 'ups'",
      );
      const worker = start('worker', runtimeEnvironment);
      await waitForExit(worker);
      expect(worker.child.exitCode).toBe(1);
      expect(worker.output()).not.toContain('Worker ready');
      expect(jsonRecords(worker)).toContainEqual(
        expect.objectContaining({
          event: 'tracking.worker.failed',
          reasonCode: 'ADAPTER_MISSING',
          carrierCode: 'ups',
        }),
      );
      const api = start('main', {
        ...runtimeEnvironment,
        PORT: await availablePort(),
      });
      await waitForReady(api, 'API');
    } finally {
      await source.query('UPDATE carriers SET is_active = false');
      await source.destroy();
    }
  });

  it('reuses one DataSource across repeated imports and closes its pool with the context', async () => {
    for (const [key, value] of Object.entries({
      ...runtimeEnvironment,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }))
      vi.stubEnv(key, value);
    const module = await Test.createTestingModule({
      imports: [AppModule, DatabaseModule],
    }).compile();
    const source = module.get(DataSource);
    const lifecycle = vi.spyOn(
      module.get(ApplicationLifecycleLogger),
      'onApplicationShutdown',
    );
    try {
      await module.init();
      expect(module.select(DatabaseModule).get(DataSource)).toBe(source);
      const [row] = await source.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'",
      );
      expect(row.count).toBe(1);
      await expect(module.get(ReadinessService).check()).resolves.toMatchObject(
        { details: { database: { status: 'up' } } },
      );
      expect(() =>
        module.get(DatabaseReadiness).check(AbortSignal.abort()),
      ).toThrow();
    } finally {
      await module.close();
    }
    expect(source.isInitialized).toBe(false);
    expect(lifecycle).toHaveBeenCalledOnce();
  });

  it('keeps API readiness healthy with no worker, while sharing a configured port, and after worker shutdown', async () => {
    const port = await availablePort();
    const env = { ...runtimeEnvironment, PORT: port };
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
        `DB_PORT=${runtimeEnvironment.DB_PORT}`,
        `DB_HOST=${runtimeEnvironment.DB_HOST}`,
        `DB_NAME=${runtimeEnvironment.DB_NAME}`,
        `DB_USER=${runtimeEnvironment.DB_USER}`,
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
    const first = start('main', { ...runtimeEnvironment, PORT: port });
    await waitForReady(first, 'API');
    const second = start('main', {
      ...runtimeEnvironment,
      PORT: port,
      ECHOSHIP_PASSWORD: 'CANARY_PORT_SECRET',
    });
    await waitForExit(second);
    expect(second.child.exitCode).toBe(1);
    expect(second.output()).toContain('Application stopped');
    expect(second.output()).toContain(
      'Check runtime configuration and port availability',
    );
    expect(second.output()).not.toContain('CANARY_PORT_SECRET');
    jsonRecords(second);
    expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(
      200,
    );
  });

  it('fails readiness but keeps liveness available during a database outage, then recovers', async () => {
    const port = await availablePort();
    const api = start('main', { ...runtimeEnvironment, PORT: port });
    await waitForReady(api, 'API');
    await promisify(execFile)('docker', ['pause', container!.getId()]);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { database: { status: 'down' } },
      });
      expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(
        200,
      );
    } finally {
      await promisify(execFile)('docker', ['unpause', container!.getId()]);
    }
    await vi.waitFor(
      async () => {
        expect(
          (await fetch(`http://127.0.0.1:${port}/health/ready`)).status,
        ).toBe(200);
      },
      { timeout: 15000, interval: 250 },
    );
  });
});
