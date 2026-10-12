# V1-004: Add TypeORM and repository foundation

## Status

Depends on V1-003 and V1-017.

## Objective

Connect Nest to PostgreSQL with TypeORM, establish reviewed migration commands, implement shared entity bases, and prove the repository seam with real PostgreSQL.

## Required reading

- [`../database-schema.md`](../database-schema.md), especially shared entity columns and migration order
- [`../architecture.md`](../architecture.md), module seams
- [`../decisions.md`](../decisions.md)

## Scope

- Install the already approved `@nestjs/typeorm`, `typeorm`, and `pg` packages using pnpm.
- Add `DatabaseModule` and a CLI `DataSource` that share configuration without bootstrapping the HTTP application.
- Use the project logger for safe database lifecycle events; never enable SQL parameter logging in production.
- Disable schema synchronization and automatic migration execution outside explicitly approved disposable tests.
- Add migration generate/create/run/revert/show scripts compatible with the chosen module format.
- Implement abstract `AuditableEntity` and `ExternallyIdentifiedEntity` exactly as specified.
- Add one small repository contract/provider-token/TypeORM implementation proving services can avoid direct TypeORM injection.

## Acceptance criteria

- API and worker can share one database configuration without duplicate pools inside the same process.
- Identity keys are internal integers; database-generated UUIDs are immutable and unique.
- Audit actor columns are nullable integers with no User relationships yet.
- No entity extends TypeORM `BaseEntity`.
- `synchronize` is false in committed configuration.
- An integration test runs a minimal migration and repository operation against Testcontainers PostgreSQL.

## Verification

Run migration show/run/revert/run on a fresh database, repository integration tests, typecheck, and build.
