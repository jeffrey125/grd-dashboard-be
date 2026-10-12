import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import { ProofEntity } from '@test/support/database-proof/proof.entity.js';
import { ProofMigration1791800000000 } from '@test/support/database-proof/proof.migration.js';
import {
  ProofService,
  proofRepositoryProvider,
} from '@test/support/database-proof/proof.repository.js';
import {
  startPostgresqlContainer,
  postgresqlEnvironment,
} from '@test/support/postgresql-container.js';

const require = createRequire(import.meta.url);
const typeormCli = require.resolve('typeorm/cli.js');

describe('migrations and repository foundation', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let source: DataSource;
  let module: TestingModule;
  let service: ProofService;

  beforeAll(async () => {
    container = await startPostgresqlContainer();
    source = new DataSource({
      ...createDatabaseOptions(
        createConfiguration(postgresqlEnvironment(container)),
      ),
      entities: [ProofEntity],
      migrations: [ProofMigration1791800000000],
    });
    await source.initialize();
    await source.runMigrations();
    module = await Test.createTestingModule({
      providers: [
        { provide: DataSource, useValue: source },
        proofRepositoryProvider,
        ProofService,
      ],
    }).compile();
    service = module.get(ProofService);
  });

  afterAll(async () => {
    await module?.close();
    if (source?.isInitialized) await source.destroy();
    await container?.stop();
  });

  it('creates and retrieves a database-generated identity through the repository contract', async () => {
    const record = await service.create('first');
    expect(record.externalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(record).not.toHaveProperty('id');
    expect(await service.find(record.externalId)).toEqual(record);
    expect(
      await service.find('00000000-0000-4000-8000-000000000000'),
    ).toBeNull();
  });

  it('maintains audit timestamps and excludes soft-deleted rows through the contract', async () => {
    const created = await service.create('before');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await service.rename(created.externalId, 'after');
    const updated = await service.find(created.externalId);
    expect(updated).toMatchObject({
      externalId: created.externalId,
      label: 'after',
      createdAt: created.createdAt,
    });
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(
      created.updatedAt.getTime(),
    );
    await service.remove(created.externalId);
    expect(await service.find(created.externalId)).toBeNull();
    const deleted = await source.getRepository(ProofEntity).findOne({
      where: { externalId: created.externalId },
      withDeleted: true,
    });
    expect(deleted!.deletedAt).toBeInstanceOf(Date);
    await expect(
      source.query(
        "INSERT INTO repository_proof (external_id, label) VALUES ($1, 'deleted duplicate')",
        [created.externalId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('enforces generated identity, UUID uniqueness, and immutable identifiers at the SQL boundary', async () => {
    const created = await service.create('protected');
    const [row] = await source.query(
      'SELECT * FROM repository_proof WHERE external_id = $1',
      [created.externalId],
    );
    expect(Number.isInteger(row.id)).toBe(true);
    expect(row.created_by_id).toBeNull();
    expect(row.updated_by_id).toBeNull();
    expect(row.deleted_by_id).toBeNull();
    await expect(
      source.query(
        "INSERT INTO repository_proof (id, label) VALUES (99999, 'manual')",
      ),
    ).rejects.toMatchObject({ driverError: { code: '428C9' } });
    await expect(
      source.query(
        "INSERT INTO repository_proof (external_id, label) VALUES ($1, 'duplicate')",
        [created.externalId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      source.query(
        'UPDATE repository_proof SET id = id + 1000 WHERE external_id = $1',
        [created.externalId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '428C9' } });
    await expect(
      source.query(
        'UPDATE repository_proof SET id = DEFAULT WHERE external_id = $1',
        [created.externalId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await expect(
      source.query(
        'UPDATE repository_proof SET external_id = gen_random_uuid() WHERE external_id = $1',
        [created.externalId],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await source.query(
      'UPDATE repository_proof SET external_id = external_id WHERE external_id = $1',
      [created.externalId],
    );
    expect(await service.find(created.externalId)).toEqual(created);
  });

  it('agrees with migrated column metadata and does not add User foreign keys', async () => {
    const runner = source.createQueryRunner();
    try {
      const table = await runner.getTable('repository_proof');
      expect(table!.foreignKeys).toHaveLength(0);
      expect(
        table!.columns.find((column) => column.name === 'id'),
      ).toMatchObject({
        type: 'integer',
        generationStrategy: 'identity',
        generatedIdentity: 'ALWAYS',
      });
      const changes = await source.driver.createSchemaBuilder().log();
      expect(changes.upQueries).toEqual([]);
    } finally {
      await runner.release();
    }
  });

  it('runs the shipped CLI show/run/revert/run sequence on a fresh database', async () => {
    await source.undoLastMigration();
    const env = {
      PATH: process.env.PATH,
      ...postgresqlEnvironment(container!),
      LOG_LEVEL: 'info',
    };
    const cli = (command: string, args: string[] = []) =>
      promisify(execFile)(
        process.execPath,
        [
          typeormCli,
          command,
          ...args,
          '-d',
          '.test-dist/test/support/database-proof/data-source.js',
        ],
        { env },
      );
    expect((await cli('migration:show')).stdout).toContain(
      '[ ] ProofMigration1791800000000',
    );
    const firstRun = await cli('migration:run');
    expect(firstRun.stdout).toContain('CREATE TABLE repository_proof');
    expect((await cli('migration:show')).stdout).toContain(
      'ProofMigration1791800000000',
    );
    await cli('migration:revert');
    expect(
      await source.query("SELECT to_regclass('repository_proof') AS name"),
    ).toEqual([{ name: null }]);
    const generated = await cli('migration:generate', [
      '/tmp/grd-proof-preview',
      '--dryrun',
    ]);
    expect(generated.stdout).toContain('CREATE TABLE');
    await cli('migration:run');
    expect(await source.showMigrations()).toBe(false);
    await expect(
      service.create('after second migration'),
    ).resolves.toMatchObject({ label: 'after second migration' });
    await cli('migration:generate', ['/tmp/grd-proof-check', '--check']);
  });

  it('rolls back failed migrations and preserves full TypeORM CLI diagnostics', async () => {
    const result = await promisify(execFile)(
      process.execPath,
      [
        typeormCli,
        'migration:run',
        '-d',
        '.test-dist/test/support/database-proof/failing-data-source.js',
      ],
      {
        env: { PATH: process.env.PATH, ...postgresqlEnvironment(container!) },
      },
    ).catch((error: { code: number; stdout: string; stderr: string }) => error);
    expect(result).toHaveProperty('code', 1);
    expect(result.stdout + result.stderr).toContain(
      'CANARY_MIGRATION_PARAMETER',
    );
    expect(result.stdout + result.stderr).toContain('Migration');
    expect(
      await source.query("SELECT to_regclass('rollback_proof') AS name"),
    ).toEqual([{ name: null }]);
  });

  it('preserves TypeORM CLI connection diagnostics', async () => {
    const missingDatabase = 'CANARY_MISSING_DATABASE';
    const result = await promisify(execFile)(
      process.execPath,
      [
        typeormCli,
        'migration:show',
        '-d',
        '.test-dist/test/support/database-proof/data-source.js',
      ],
      {
        env: {
          PATH: process.env.PATH,
          ...postgresqlEnvironment(container!),
          DB_NAME: missingDatabase,
        },
      },
    ).catch((error: { code: number; stdout: string; stderr: string }) => error);
    expect(result).toHaveProperty('code', 1);
    expect(result.stdout + result.stderr).toContain(missingDatabase);
  });

  it('creates a reviewable TypeScript migration without connecting to PostgreSQL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'grd-v1004-migration-'));
    try {
      await promisify(execFile)(
        process.execPath,
        [typeormCli, 'migration:create', join(directory, 'ReviewedChange')],
        { env: { PATH: process.env.PATH, NODE_ENV: 'test' } },
      );
      const [filename] = await readdir(directory);
      expect(filename).toMatch(/^\d+-ReviewedChange\.ts$/);
      const migration = await readFile(join(directory, filename), 'utf8');
      expect(migration).toContain('implements MigrationInterface');
      expect(migration).toContain('async down');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
