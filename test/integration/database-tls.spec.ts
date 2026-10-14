import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { firstValueFrom, timeout } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import { TypeOrmEventsSource } from '@modules/events/typeorm-events.source.js';
import type { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import {
  postgresqlEnvironment,
  startPostgresqlContainer,
} from '@test/support/postgresql-container.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

describe('verified PostgreSQL TLS', () => {
  let directory: string;
  let container: StartedPostgreSqlContainer;
  let environment: Record<string, string>;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'grd-tls-'));

    for (const name of ['server', 'untrusted']) {
      await execute(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=localhost',
          '-addext',
          'subjectAltName=DNS:localhost',
          '-keyout',
          join(directory, `${name}.key`),
          '-out',
          join(directory, `${name}.crt`),
        ],
        { timeout: 10_000 },
      );
    }

    container = await new PostgreSqlContainer('postgres:18.3-alpine')
      .withDatabase('grd_tls')
      .withUsername('grd_tls')
      .withPassword('fixture-only')
      .withCopyFilesToContainer([
        { source: join(directory, 'server.key'), target: '/tmp/server.key' },
        { source: join(directory, 'server.crt'), target: '/tmp/server.crt' },
      ])
      .withCommand([
        'sh',
        '-c',
        'chown postgres:postgres /tmp/server.key && chmod 600 /tmp/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key',
      ])
      .withStartupTimeout(120_000)
      .start();

    environment = {
      ...postgresqlEnvironment(container),
      DB_HOST: 'localhost',
      DB_SSL_MODE: 'verify-full',
      DB_SSL_CA_FILE: join(directory, 'server.crt'),
    };
  });

  afterAll(async () => {
    if (container) await container.stop();

    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const sourceFor = (overrides: Record<string, string | undefined> = {}) =>
    new DataSource({
      ...createDatabaseOptions(
        createConfiguration({ ...environment, ...overrides }),
      ),
      entities: [],
      migrations: [],
    });

  it('runs the compiled migration CLI and shares verified TLS with the event listener', async () => {
    await execute(
      process.execPath,
      [
        require.resolve('typeorm/cli.js'),
        'migration:run',
        '-d',
        'dist/infrastructure/database/data-source.js',
      ],
      { env: { PATH: process.env.PATH, ...environment }, timeout: 30_000 },
    );

    const source = await sourceFor().initialize();
    const logger = { warn: vi.fn() } as unknown as ProjectLogger;
    const events = new TypeOrmEventsSource(source, logger);

    try {
      expect(
        await source.query('SELECT count(*)::int AS count FROM migrations'),
      ).toEqual([{ count: 5 }]);

      const ready = firstValueFrom(events.events.pipe(timeout(5000)));

      events.start();
      await expect(ready).resolves.toEqual({ type: 'resync' });

      const connections = await source.query(`
        SELECT s.ssl FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
        WHERE a.datname = current_database() AND a.usename = current_user
      `);

      expect(connections.length).toBeGreaterThanOrEqual(2);
      expect(connections.every((row: { ssl: boolean }) => row.ssl)).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      await events.onModuleDestroy();
      await source.destroy();
    }
  });

  it.each([
    [
      'untrusted CA',
      { DB_SSL_CA_FILE: 'untrusted.crt' },
      /self-signed|certificate/i,
    ],
    ['hostname mismatch', { DB_HOST: '127.0.0.1' }, /IP|hostname|altnames/i],
    [
      'missing trust root',
      { DB_SSL_CA_FILE: undefined },
      /self-signed|certificate/i,
    ],
  ])(
    'rejects %s rather than disabling verification',
    async (_name, overrides, message) => {
      const source = sourceFor({
        ...overrides,
        ...('DB_SSL_CA_FILE' in overrides && overrides.DB_SSL_CA_FILE
          ? { DB_SSL_CA_FILE: join(directory, overrides.DB_SSL_CA_FILE) }
          : {}),
      });

      try {
        await expect(source.initialize()).rejects.toThrow(message);
      } finally {
        if (source.isInitialized) await source.destroy();
      }
    },
  );

  it('rejects empty, malformed, oversized and non-file CA inputs safely', async () => {
    for (const contents of [
      '',
      'CANARY_PEM',
      '-----BEGIN CERTIFICATE-----\nCANARY_PEM',
      'x'.repeat(65_537),
    ]) {
      const path = join(directory, 'invalid.pem');

      await writeFile(path, contents);

      expect(() => sourceFor({ DB_SSL_CA_FILE: path })).toThrow(
        'DB_SSL_CA_FILE',
      );
    }

    expect(() => sourceFor({ DB_SSL_CA_FILE: directory })).toThrow(
      'DB_SSL_CA_FILE',
    );

    const fifo = join(directory, 'invalid.fifo');
    await execute('mkfifo', [fifo]);
    const startedAt = Date.now();
    expect(() => sourceFor({ DB_SSL_CA_FILE: fifo })).toThrow('DB_SSL_CA_FILE');
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('does not fall back to plaintext when the server has no TLS', async () => {
    const plain = await startPostgresqlContainer();
    const source = sourceFor({
      ...postgresqlEnvironment(plain),
      DB_SSL_CA_FILE: undefined,
    });

    try {
      await expect(source.initialize()).rejects.toThrow(
        /does not support SSL/i,
      );
    } finally {
      if (source.isInitialized) await source.destroy();

      await plain.stop();
    }
  });
});
