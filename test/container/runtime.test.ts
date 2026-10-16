import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);

// Opt-in release check. Its uniquely named project owns only disposable data.
test(
  'portable image and local Compose lifecycle',
  { timeout: 600_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'grd-container-'));
    const project = `grd-check-${randomUUID().slice(0, 8)}`;
    const image = `${project}:test`;
    const envFile = join(directory, 'local.env');
    const override = join(directory, 'compose.json');

    await writeFile(envFile, '');
    await writeFile(
      override,
      JSON.stringify({
        services: {
          api: { image },
          worker: { image },
          migrate: { image },
        },
      }),
    );

    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOCKER_HOST: process.env.DOCKER_HOST,
      DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
      AUTH_SECRET: 'disposable-container-secret-'.repeat(3),
      GRD_API_PORT: '0',
    };
    const compose = (...args: string[]) =>
      execute(
        'docker',
        [
          'compose',
          '--project-name',
          project,
          '--env-file',
          envFile,
          '-f',
          resolve('docker-compose.dev.yml'),
          '-f',
          override,
          ...args,
        ],
        { env, timeout: 540_000, maxBuffer: 16 * 1024 * 1024 },
      );
    const sql = async (query: string) =>
      (
        await compose(
          'exec',
          '-T',
          'db',
          'psql',
          '-U',
          'grd_local',
          '-d',
          'grd_local',
          '-Atc',
          query,
        )
      ).stdout.trim();
    const migration = (command: string) =>
      compose(
        'run',
        '--rm',
        '--no-deps',
        'migrate',
        'node',
        'node_modules/typeorm/cli.js',
        command,
        '-d',
        'dist/infrastructure/database/data-source.js',
      );
    const waitForLog = async (service: string, event: string) => {
      const deadline = Date.now() + 20_000;

      while (Date.now() < deadline) {
        const logs = (await compose('logs', '--no-log-prefix', service)).stdout;

        if (logs.includes(`"event":"${event}"`)) return logs;

        await delay(200);
      }

      assert.fail(`${service} did not emit ${event}`);
    };

    try {
      await t.test(
        'builds from an allowlisted context and migrates before a healthy API',
        async () => {
          await compose(
            'up',
            '--build',
            '--wait',
            '--wait-timeout',
            '90',
            'api',
          );
          assert.equal(await sql('SELECT count(*) FROM migrations'), '7');
          assert.equal(await sql('SELECT count(*) FROM carriers'), '3');

          const address = (await compose('port', 'api', '3000')).stdout.trim();
          const response = await fetch(
            `http://${address}/api/v1/health/ready`,
            {
              signal: AbortSignal.timeout(5000),
            },
          );

          assert.equal(response.status, 200);
          assert.equal(
            (await fetch(`http://${address}/api/v1/shipments`)).status,
            401,
          );
          t.diagnostic(`Disposable API verified at http://${address}`);
        },
      );

      await t.test(
        'ships no build tools or local secrets, runs non-root and launches Chromium',
        async () => {
          await compose(
            'exec',
            '-T',
            'api',
            'node',
            '--input-type=module',
            '-e',
            `
        import assert from 'node:assert/strict';
        import { existsSync } from 'node:fs';
        import { createRequire } from 'node:module';
        import { chromium } from 'playwright';
        assert.notEqual(process.getuid(), 0);
        const require = createRequire(import.meta.url);
        assert.throws(() => require.resolve('typescript'));
        for (const path of ['.env', '.env.docker', '.git', 'src', 'test', 'artifacts', 'tmp', 'sample.txt']) {
          assert.equal(existsSync(path), false, path);
        }
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.setContent('<title>Container smoke</title>');
          assert.equal(await page.title(), 'Container smoke');
        } finally { await browser.close(); }
      `,
          );
        },
      );

      await t.test(
        'rejects worker startup without enabled Carrier credentials',
        async () => {
          await assert.rejects(compose('run', '--rm', '--no-deps', 'worker'));
        },
      );

      await t.test(
        'starts one idle worker without API auth and stops it cleanly',
        async () => {
          // This SQL targets only this test's fresh local DB. Never disable real Carriers.
          await sql('UPDATE carriers SET is_active = false');
          await compose(
            '--profile',
            'worker',
            'up',
            '-d',
            '--no-deps',
            'worker',
          );

          const logs = await waitForLog('worker', 'application.ready');

          for (const line of logs.trim().split('\n')) JSON.parse(line);

          const ids = (await compose('ps', '-q', 'worker')).stdout
            .trim()
            .split('\n');

          assert.equal(ids.length, 1);
          await compose('stop', 'worker');
          await waitForLog('worker', 'application.stopped');
        },
      );

      await t.test(
        'fully reverts and reapplies migrations using production-only dependencies',
        async () => {
          await compose('stop', 'api');
          await waitForLog('api', 'application.stopped');

          for (let index = 0; index < 7; index++)
            await migration('migration:revert');

          assert.equal(await sql('SELECT count(*) FROM migrations'), '0');
          await migration('migration:run');
          assert.equal(await sql('SELECT count(*) FROM migrations'), '7');
          await compose('up', '--wait', '--wait-timeout', '60', 'api');
        },
      );
    } finally {
      // Delete only this uniquely named disposable project and its test volume.
      await compose(
        '--profile',
        'worker',
        'down',
        '--volumes',
        '--remove-orphans',
      );
      await execute('docker', ['image', 'rm', image], { env });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
