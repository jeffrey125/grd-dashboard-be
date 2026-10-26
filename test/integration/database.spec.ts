import { MonitoringSafeguards1793318400000 } from '@infrastructure/database/migrations/1793318400000-MonitoringSafeguards.js';
import { ProviderWeightLimits1793232000000 } from '@infrastructure/database/migrations/1793232000000-ProviderWeightLimits.js';
import { ProviderAdministration1793059200000 } from '@infrastructure/database/migrations/1793059200000-ProviderAdministration.js';
import { AmazonApiMode1793145600000 } from '@infrastructure/database/migrations/1793145600000-AmazonApiMode.js';
import { QuoteComparisons1792540800000 } from '@infrastructure/database/migrations/1792540800000-QuoteComparisons.js';
import { QuoteExecution1792627200000 } from '@infrastructure/database/migrations/1792627200000-QuoteExecution.js';
import { AmazonQuoteBreakdown1792713600000 } from '@infrastructure/database/migrations/1792713600000-AmazonQuoteBreakdown.js';
import { OptionalPackageDimensions1792800000000 } from '@infrastructure/database/migrations/1792800000000-OptionalPackageDimensions.js';
import { InternationalQuoteOptions1792886400000 } from '@infrastructure/database/migrations/1792886400000-InternationalQuoteOptions.js';
import { QuoteHistoryRetry1792972800000 } from '@infrastructure/database/migrations/1792972800000-QuoteHistoryRetry.js';
import { QUOTE_ENTITIES } from '@modules/shipping-quotes/quote.entities.js';
import { TrackingReadProjection1792281600000 } from '@infrastructure/database/migrations/1792281600000-TrackingReadProjection.js';
import { TrackingChangeEvents1792368000000 } from '@infrastructure/database/migrations/1792368000000-TrackingChangeEvents.js';
import { SalesRepsAndShipmentFollowUp1792454400000 } from '@infrastructure/database/migrations/1792454400000-SalesRepsAndShipmentFollowUp.js';
import { AUTH_ENTITIES } from '@modules/auth/auth.entities.js';
import { EmployeeAuth1792108800000 } from '@infrastructure/database/migrations/1792108800000-EmployeeAuth.js';
import { TrackingEvents1792195200000 } from '@infrastructure/database/migrations/1792195200000-TrackingEvents.js';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConfiguration } from '@config/configuration.js';
import { createDatabaseOptions } from '@infrastructure/database/database-options.js';
import { InitialSchema1791849600000 } from '@infrastructure/database/migrations/1791849600000-InitialSchema.js';
import { CarrierFetchMode1791936000000 } from '@infrastructure/database/migrations/1791936000000-CarrierFetchMode.js';
import { FfeRequestMode1792022400000 } from '@infrastructure/database/migrations/1792022400000-FfeRequestMode.js';
import { CarrierEntity } from '@modules/carriers/carrier.entity.js';
import { SalesRepEntity } from '@modules/sales-reps/sales-rep.entity.js';
import { ShipmentEntity } from '@modules/shipments/shipment.entity.js';
import { ShipmentTrackingSnapshotEntity } from '@modules/tracking/shipment-tracking-snapshot.entity.js';
import {
  TrackingRunEntity,
  TrackingRunTrigger,
  TrackingRunStatus,
} from '@modules/tracking/tracking-run.entity.js';
import { TrackingAttemptEntity } from '@modules/tracking/tracking-attempt.entity.js';
import { CarriersService } from '@modules/carriers/carriers.service.js';
import { carriersRepositoryProvider } from '@modules/carriers/typeorm-carriers.repository.js';
import {
  startPostgresqlContainer,
  postgresqlEnvironment,
} from '@test/support/postgresql-container.js';

const require = createRequire(import.meta.url);
const typeormCli = require.resolve('typeorm/cli.js');
const productionSource = 'dist/infrastructure/database/data-source.js';

describe('production migrations and repository foundation', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let source: DataSource;
  let module: TestingModule;
  let service: CarriersService;

  // Provision test records like migrations; the runtime API cannot create them.
  const provision = (code: string, name: string) =>
    source
      .getRepository(CarrierEntity)
      .save({ code, name, pollIntervalMinutes: 5 });

  const environment = () => ({
    PATH: process.env.PATH,
    ...postgresqlEnvironment(container!),
  });
  const cli = (command: string, args: string[] = []) =>
    promisify(execFile)(
      process.execPath,
      [typeormCli, command, ...args, '-d', productionSource],
      { env: environment() },
    );

  beforeAll(async () => {
    container = await startPostgresqlContainer();
    source = new DataSource({
      ...createDatabaseOptions(
        createConfiguration(postgresqlEnvironment(container)),
      ),
      entities: [
        ...AUTH_ENTITIES,
        ...QUOTE_ENTITIES,
        CarrierEntity,
        SalesRepEntity,
        ShipmentEntity,
        ShipmentTrackingSnapshotEntity,
        TrackingRunEntity,
        TrackingAttemptEntity,
      ],
      migrations: [
        InitialSchema1791849600000,
        CarrierFetchMode1791936000000,
        FfeRequestMode1792022400000,
        EmployeeAuth1792108800000,
        TrackingEvents1792195200000,
        TrackingReadProjection1792281600000,
        TrackingChangeEvents1792368000000,
        SalesRepsAndShipmentFollowUp1792454400000,
        QuoteComparisons1792540800000,
        QuoteExecution1792627200000,
        AmazonQuoteBreakdown1792713600000,
        OptionalPackageDimensions1792800000000,
        InternationalQuoteOptions1792886400000,
        QuoteHistoryRetry1792972800000,
        ProviderAdministration1793059200000,
        AmazonApiMode1793145600000,
        ProviderWeightLimits1793232000000,
        MonitoringSafeguards1793318400000,
      ],
    });
    await source.initialize();
    await source.runMigrations();
    module = await Test.createTestingModule({
      providers: [
        { provide: DataSource, useValue: source },
        carriersRepositoryProvider,
        CarriersService,
      ],
    }).compile();
    service = module.get(CarriersService);
  });

  afterAll(async () => {
    await module?.close();

    if (source?.isInitialized) await source.destroy();

    await container?.stop();
  });

  it('retrieves a provisioned database-generated UUID through the production repository without exposing internal IDs', async () => {
    const seeded = await provision('contract', 'Contract Carrier');
    const record = await service.find(seeded.externalId);

    expect(record.externalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(record).not.toHaveProperty('id');
    expect(await service.find(record.externalId)).toEqual(record);

    await expect(
      service.find('00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('maintains audit timestamps and excludes soft-deleted Carriers through the production repository', async () => {
    const created = await provision('audit', 'Before');

    await new Promise((resolve) => setTimeout(resolve, 10));
    await service.update(created.externalId, { name: 'After' });

    const updated = await service.find(created.externalId);

    expect(updated).toMatchObject({
      externalId: created.externalId,
      code: 'audit',
      name: 'After',
      createdAt: created.createdAt,
    });
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(
      created.updatedAt.getTime(),
    );

    await source
      .getRepository(CarrierEntity)
      .softDelete({ externalId: created.externalId });
    await expect(service.find(created.externalId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.update(created.externalId, { name: 'Cannot revive' }),
    ).rejects.toMatchObject({ status: 404 });

    expect(
      (await service.list()).some(
        (row) => row.externalId === created.externalId,
      ),
    ).toBe(false);
    expect(
      (await service.listActive()).some(
        (row) => row.externalId === created.externalId,
      ),
    ).toBe(false);

    const deleted = await source.getRepository(CarrierEntity).findOne({
      where: { externalId: created.externalId },
      withDeleted: true,
    });

    expect(deleted!.deletedAt).toBeInstanceOf(Date);
    expect(deleted).toMatchObject({
      createdById: null,
      updatedById: null,
      deletedById: null,
    });
    expect(deleted!.name).toBe('After');

    await expect(provision('audit', 'Duplicate')).rejects.toMatchObject({
      driverError: { code: '23505' },
    });
  });

  it('excludes disabled Carriers from scheduled eligibility without changing their Shipments', async () => {
    const created = await provision('eligibility', 'Eligibility');
    const shipments = source.getRepository(ShipmentEntity);
    const shipment = await shipments.save({
      carrierId: created.id,
      trackingReference: 'KEEP-RELATIONSHIP',
    });

    expect(
      (await service.listActive()).some(
        (row) => row.externalId === created.externalId,
      ),
    ).toBe(true);

    const updated = await service.update(created.externalId, {
      isActive: false,
      name: 'Renamed',
      notFoundPauseThreshold: 2,
      pollIntervalMinutes: 32767,
      rateLimitPerMinute: 1,
    });

    expect(updated).toMatchObject({
      code: 'eligibility',
      isActive: false,
      name: 'Renamed',
      notFoundPauseThreshold: 2,
      pollIntervalMinutes: 32767,
      rateLimitPerMinute: 1,
    });
    expect(
      (await service.listActive()).some(
        (row) => row.externalId === created.externalId,
      ),
    ).toBe(false);
    expect(await service.list()).toContainEqual(updated);
    expect(await shipments.findOneByOrFail({ id: shipment.id })).toEqual(
      shipment,
    );

    const enabled = await service.update(created.externalId, {
      isActive: true,
      rateLimitPerMinute: null,
    });

    expect(enabled).toMatchObject({
      isActive: true,
      rateLimitPerMinute: null,
      pollIntervalMinutes: 32767,
    });
    expect(await service.listActive()).toContainEqual(enabled);
  });

  it('preserves independent concurrent setting updates and does not change codes through ORM writes', async () => {
    const created = await provision('concurrent-settings', 'Concurrent');

    await Promise.all([
      service.update(created.externalId, { name: 'New display' }),
      service.update(created.externalId, { pollIntervalMinutes: 15 }),
    ]);

    expect(await service.find(created.externalId)).toMatchObject({
      name: 'New display',
      pollIntervalMinutes: 15,
      code: 'concurrent-settings',
    });

    await source
      .getRepository(CarrierEntity)
      .update(
        { externalId: created.externalId },
        { code: 'changed-code', name: 'ORM display' },
      );

    expect(await service.find(created.externalId)).toMatchObject({
      code: 'concurrent-settings',
      name: 'ORM display',
    });
  });

  it('ignores application-supplied UUIDs and maps generated IDs, dates, audit times and versions', async () => {
    const carriers = source.getRepository(CarrierEntity);
    const supplied = '00000000-0000-4000-8000-000000000000';
    const carrier = await carriers.save(
      carriers.create({
        code: 'orm-identities',
        name: 'ORM Carrier',
        pollIntervalMinutes: 5,
        externalId: supplied,
      }),
    );

    expect(carrier.externalId).not.toBe(supplied);

    const shipments = source.getRepository(ShipmentEntity);
    const shipment = await shipments.save(
      shipments.create({
        carrierId: carrier.id,
        trackingReference: 'ORM-1',
        externalId: supplied,
      }),
    );

    expect(shipment.externalId).not.toBe(supplied);
    expect(shipment.lockVersion).toBe(1);

    await shipments.update({ id: shipment.id }, { notes: 'Updated' });

    expect(await shipments.findOneByOrFail({ id: shipment.id })).toMatchObject({
      lockVersion: 2,
    });

    const snapshots = source.getRepository(ShipmentTrackingSnapshotEntity);
    const snapshot = await snapshots.save(
      snapshots.create({ shipmentId: shipment.id, deliveredOn: '2026-10-13' }),
    );

    expect(typeof snapshot.id).toBe('string');
    expect(
      (await snapshots.findOneByOrFail({ id: snapshot.id })).deliveredOn,
    ).toBe('2026-10-13');

    const runs = source.getRepository(TrackingRunEntity);
    const run = await runs.save(
      runs.create({
        carrierId: carrier.id,
        trigger: TrackingRunTrigger.Manual,
        externalId: supplied,
      }),
    );

    expect(run.externalId).not.toBe(supplied);
    expect(run.externalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(typeof run.id).toBe('string');
    expect(run.requestedById).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runs.update(
      { id: run.id },
      { status: TrackingRunStatus.Running, startedAt: new Date() },
    );

    expect(
      (await runs.findOneByOrFail({ id: run.id })).updatedAt.getTime(),
    ).toBeGreaterThan(run.updatedAt.getTime());

    const attempts = source.getRepository(TrackingAttemptEntity);
    const attempt = await attempts.save(
      attempts.create({ trackingRunId: run.id, shipmentId: shipment.id }),
    );

    expect(typeof attempt.id).toBe('string');

    await carriers.update(
      { id: carrier.id },
      { name: 'Updated', externalId: supplied },
    );

    expect(
      (await carriers.findOneByOrFail({ id: carrier.id })).externalId,
    ).toBe(carrier.externalId);
  });

  it('reverses FFE mode selection without rewriting historical run modes', async () => {
    const carrier = await source
      .getRepository(CarrierEntity)
      .findOneByOrFail({ code: 'ffe' });

    expect(carrier.fetchMode).toBe('request');

    const runs = source.getRepository(TrackingRunEntity);
    const run = await runs.save(
      runs.create({
        carrierId: carrier.id,
        trigger: TrackingRunTrigger.Manual,
        fetchMode: 'browser',
      }),
    );

    await source.undoLastMigration(); // Monitoring safeguards migration.
    await source.undoLastMigration(); // Provider weight limits migration.
    await source.undoLastMigration(); // Amazon API mode migration.
    await source.undoLastMigration(); // Provider administration migration.
    await source.undoLastMigration(); // History and retry migration.
    await source.undoLastMigration(); // International quote options migration.
    await source.undoLastMigration(); // Optional package dimensions migration.
    await source.undoLastMigration(); // Amazon quote breakdown migration.
    await source.undoLastMigration(); // Quote execution migration.
    await source.undoLastMigration(); // Quote comparison migration.
    await source.undoLastMigration(); // Sales Rep and follow-up migration.
    await source.undoLastMigration(); // Precise tracking event migration.
    await source.undoLastMigration(); // Tracking projection migration.
    await source.undoLastMigration(); // Event trigger migration.
    await source.undoLastMigration(); // Auth migration.
    await source.undoLastMigration(); // FFE mode migration.

    // Current entities include newer columns; inspect only columns present at this historical schema.
    expect(
      (
        await source.query(
          'SELECT fetch_mode FROM carriers WHERE external_id = $1',
          [carrier.externalId],
        )
      )[0].fetch_mode,
    ).toBe('browser');
    expect(
      (
        await source.query(
          'SELECT fetch_mode FROM tracking_runs WHERE id = $1',
          [run.id],
        )
      )[0].fetch_mode,
    ).toBe('browser');

    await source.runMigrations();

    expect((await service.find(carrier.externalId)).fetchMode).toBe('request');
    expect((await runs.findOneByOrFail({ id: run.id })).fetchMode).toBe(
      'browser',
    );
  });

  it('runs the shipped CLI show/run/revert/run sequence and leaves no migration drift', async () => {
    for (let count = 0; count < source.migrations.length; count++)
      await source.undoLastMigration();

    expect((await cli('migration:show')).stdout).toContain(
      '[ ] InitialSchema1791849600000',
    );

    const firstRun = await cli('migration:run');

    expect(firstRun.stdout).toContain('CREATE TABLE carriers');
    expect((await cli('migration:show')).stdout).toContain('[X]');

    for (let count = 0; count < source.migrations.length; count++)
      await cli('migration:revert');

    expect(
      await source.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'",
      ),
    ).toEqual([]);
    expect(
      await source.query(
        "SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace",
      ),
    ).toEqual([]);
    expect(
      await source.query(
        "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace",
      ),
    ).toEqual([]);

    const directory = await mkdtemp(join(tmpdir(), 'grd-v1005-generation-'));

    try {
      expect(
        (
          await cli('migration:generate', [
            join(directory, 'Preview'),
            '--dryrun',
          ])
        ).stdout,
      ).toContain('CREATE TABLE');

      await cli('migration:run');

      expect(await source.showMigrations()).toBe(false);

      await expect(
        provision('second-migration', 'After second migration').then((row) =>
          service.find(row.externalId),
        ),
      ).resolves.toMatchObject({ name: 'After second migration' });

      expect(await source.getRepository(CarrierEntity).count()).toBe(4);

      await cli('migration:generate', [join(directory, 'Check'), '--check']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rolls back a failed migration against real tables and preserves full CLI diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'grd-v1005-rollback-'));

    try {
      const failingSource = join(directory, 'failing-source.mjs');

      // Reuse the production source; no fixture build or fake table is needed.
      await writeFile(
        failingSource,
        `import source from ${JSON.stringify(pathToFileURL(join(process.cwd(), productionSource)).href)};
        class FailingMigration1791849600001 {
          async up(runner) {
            await runner.query("INSERT INTO carriers (code, name, poll_interval_minutes) VALUES ('rollback-canary', 'Rollback', 5)");
            await runner.query('SELECT $1::integer', ['CANARY_MIGRATION_PARAMETER']);
          }
          async down() {}
        }
        export default source.setOptions({migrations: [FailingMigration1791849600001]});`,
      );

      const result = await promisify(execFile)(
        process.execPath,
        [typeormCli, 'migration:run', '-d', failingSource],
        { env: environment() },
      ).catch(
        (error: { code: number; stdout: string; stderr: string }) => error,
      );

      expect(result).toHaveProperty('code', 1);
      expect(result.stdout + result.stderr).toContain(
        'CANARY_MIGRATION_PARAMETER',
      );
      expect(
        await source.query(
          "SELECT id FROM carriers WHERE code = 'rollback-canary'",
        ),
      ).toEqual([]);
      expect(
        await source.query(
          "SELECT id FROM migrations WHERE name = 'FailingMigration1791849600001'",
        ),
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves TypeORM CLI connection diagnostics', async () => {
    const missingDatabase = 'CANARY_MISSING_DATABASE';
    const result = await promisify(execFile)(
      process.execPath,
      [typeormCli, 'migration:show', '-d', productionSource],
      { env: { ...environment(), DB_NAME: missingDatabase } },
    ).catch((error: { code: number; stdout: string; stderr: string }) => error);

    expect(result).toHaveProperty('code', 1);
    expect(result.stdout + result.stderr).toContain(missingDatabase);
  });

  it('creates a reviewable TypeScript migration without connecting to PostgreSQL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'grd-v1005-migration-'));

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
