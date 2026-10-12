# V1-005 implementation summary

## Summary

Implemented the five-table initial PostgreSQL schema in one reviewed TypeORM
migration, with matching production entities and the approved UPS, EchoShip, and
FFE seeds. Local checks pass, including migration up/revert/up, real PostgreSQL
constraints, repository DI, and runtime regressions. Changes are uncommitted;
no production database was accessed or migrated.

## Changes Made

### Approved decisions and dependency approach

- Reused installed `@nestjs/typeorm`, `typeorm`, `pg`, Vitest, and PostgreSQL
  Testcontainers. No dependency or lockfile change was needed. TypeORM owns
  mappings and migrations; explicit PostgreSQL SQL implements the constraints,
  descending indexes, and immutable-row triggers the schema requires.
- One atomic migration creates UUID support verification, enums, Carrier,
  Shipment, snapshot, the circular ownership FK, run, attempt, indexes, protection
  triggers, and seeds in dependency order. Its reverse migration removes all
  application tables, enums, and trigger functions. Synchronization and startup
  migration execution remain disabled.
- All seven foreign keys explicitly use `ON DELETE NO ACTION`. The user explicitly
  replaced the schema's earlier `CASCADE` and `RESTRICT` requirements and made
  `NO ACTION` the default for future foreign keys unless they approve an override.
  `AGENTS.md` records the default and the schema document records this ticket's
  behavior. Foreign keys are immediate and non-deferrable.
- The temporary Carrier repository contract/provider/service uses the production
  entity only in tests. V1-007 must replace and remove it when the real Carrier
  repository lands; that follow-up is recorded in the ticket. It accepts explicit
  codes and does not implement V1-007's slug generation or API behavior.

### Database behavior

- Carrier/Shipment retain the audit/UUID base. Snapshots, runs, and attempts use
  purpose-specific columns. PostgreSQL generates integer/bigint identities and
  UUIDv4 public identifiers. Bigints and calendar dates map to TypeScript strings.
- PostgreSQL triggers reject changes to IDs, including `SET id = DEFAULT`, and
  public UUIDs. A snapshot trigger protects every persisted field. No-op UUID
  and snapshot-fact updates are permitted; identity columns still follow
  PostgreSQL's `GENERATED ALWAYS` assignment restrictions.
- Partial uniqueness prevents concurrent active Carrier/reference duplicates,
  permits re-add after soft deletion, and prevents conflicting restoration.
  Carrier codes/public UUIDs remain unique across soft-deleted rows.
- Composite foreign keys prevent either Shipments or attempts from referencing
  another Shipment's snapshot. State/reason, run timestamp, attempt outcome,
  retryability, source JSON-object, snapshot-data, and numeric checks enforce the
  documented valid combinations, including null edge cases.
- UPS starts at 30 minutes / threshold 5 / limit 10. EchoShip and FFE start at
  5 minutes / threshold 5 / null generic limit. Deferred fields/tables and User
  foreign keys are absent.
- Soft deletion preserves history. Permanent deletion requires explicit ordered
  cleanup in a transaction: clear the Shipment snapshot pointer, delete its
  attempts, delete snapshots, then delete the Shipment. Runs and Carriers also
  require their dependents to be removed first. Tests prove this order; no purge
  API is added.
- The old proof entity, migration, contract/provider/service, CLI sources, and
  fixture build config are removed. `pnpm test:integration` now builds production
  code only; existing CI already runs that command. CLI rollback tests generate
  a disposable failing migration against the real Carrier table and clean it up.

## Files Changed

| File                                                                    | Review purpose                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                             | Persist the approved default deletion policy for future agents.                                                                        |
| `src/infrastructure/database/migrations/1791849600000-InitialSchema.ts` | Atomic schema, checks, indexes, triggers, seeds, and reverse migration.                                                                |
| `src/modules/carriers/carrier.entity.ts`                                | Carrier columns, numeric checks, and code uniqueness.                                                                                  |
| `src/modules/shipments/shipment.entity.ts`                              | Monitoring enums/checks, partial indexes, ownership pointer, and version column.                                                       |
| `src/modules/tracking/shipment-tracking-snapshot.entity.ts`             | Immutable snapshot mapping, ownership, calendar dates, and history index declaration.                                                  |
| `src/modules/tracking/tracking-run.entity.ts`                           | Run identity, enums, timestamps, constraints, and indexes.                                                                             |
| `src/modules/tracking/tracking-attempt.entity.ts`                       | Attempt outcomes, source data, constraints, uniqueness, and snapshot ownership.                                                        |
| `test/integration/schema.spec.ts`                                       | Real PostgreSQL seeds, schema/catalog agreement, valid/invalid states, concurrency, immutability, ownership, and explicit purge order. |
| `test/integration/database.spec.ts`                                     | Production CLI migration lifecycle/rollback/diagnostics and real-entity repository/ORM coverage.                                       |
| `test/support/carrier-repository.ts`                                    | Temporary symbol-token Carrier repository and consuming service; removal owned by V1-007.                                              |
| `test/support/database-proof/proof.entity.ts` (removed)                 | Replace fake entity with production entities.                                                                                          |
| `test/support/database-proof/proof.migration.ts` (removed)              | Replace fake schema with the initial production migration.                                                                             |
| `test/support/database-proof/proof.contract.ts` (removed)               | Replace fake contract with the temporary real-Carrier contract.                                                                        |
| `test/support/database-proof/proof.repository.ts` (removed)             | Replace fake provider/service with real-Carrier DI coverage.                                                                           |
| `test/support/database-proof/data-source.ts` (removed)                  | Exercise the shipped production CLI DataSource.                                                                                        |
| `test/support/database-proof/failing-data-source.ts` (removed)          | Use a disposable runtime-generated rollback source against real tables.                                                                |
| `test/tsconfig.fixtures.json` (removed)                                 | Remove the obsolete fixture-only build.                                                                                                |
| `package.json`                                                          | Remove fixture compilation from `test:integration`; dependencies unchanged.                                                            |
| `src/infrastructure/database/README.md`                                 | Document production schema, mapping limitations, deletion behavior, and replacement tests.                                             |
| `docs/v1/database-schema.md`                                            | Align every FK deletion action and purge guidance with the approved policy.                                                            |
| `docs/v1/tickets/V1-005-initial-database-schema.md`                     | Record the policy override and implementation status.                                                                                  |
| `docs/v1/tickets/V1-007-carriers-module.md`                             | Require replacement/removal of the temporary Carrier test seam.                                                                        |
| `docs/v1/implementation-summary/V1-005-implementation-summary.md`       | This review and verification handoff.                                                                                                  |

## Verification

| Exact command/check                                                                                               | Result                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                                                                      | Passed during incremental migration/entity development and within final suites.                                                                                                                     |
| `pnpm typecheck`                                                                                                  | Passed during implementation and within `pnpm check`.                                                                                                                                               |
| `pnpm exec vitest run --project integration test/integration/schema.spec.ts`                                      | Passed: 17 tests against disposable PostgreSQL 18.3. Earlier red runs proved missing Carrier/Shipment tables, absent entity mappings, and absent immutability triggers.                             |
| `pnpm exec vitest run --project integration test/integration/database.spec.ts`                                    | Passed: 7 repository/ORM/CLI tests.                                                                                                                                                                 |
| `pnpm check`                                                                                                      | Passed formatting, warning-free lint, typecheck, 28 unit tests in 8 files, and production build. An earlier formatting failure was fixed before this passing run.                                   |
| `pnpm test:integration`                                                                                           | Passed: 40 tests in 4 files, including the production runtime regressions, after the production build.                                                                                              |
| `pnpm test:cov`                                                                                                   | Passed: 28 unit tests; 46.84% statements / 46.04% lines. Database entities/migrations are exercised by integration tests, outside these unit-only percentages. No coverage threshold is configured. |
| `pnpm test:e2e`                                                                                                   | Passed: 3 HTTP/logging tests in 2 files after production build.                                                                                                                                     |
| `env NODE_OPTIONS=--trace-deprecation pnpm exec vitest run --project integration test/integration/schema.spec.ts` | Passed: all 17 schema tests after adding explicit identity-insert rejection. Traced the dependency warning to TypeORM's concurrent enum metadata queries on a single `pg` client.                   |
| `git diff --check`                                                                                                | Passed; final tracked diff and all untracked additions reviewed against baseline `b8f8ea8`.                                                                                                         |

The CLI tests call the installed TypeORM CLI through Node with
`-d dist/infrastructure/database/data-source.js`: `migration:show`,
`migration:run`, `migration:show`, `migration:revert`, and `migration:run`.
They also run `migration:generate <temporary-path> --dryrun` on an empty schema
and `migration:generate <temporary-path> --check` after restoration. The latter
reports no changes. Catalog tests independently check all columns, generated
identity types, all FK actions, and exact partial/descending index definitions.

Docker and local HTTP/process tests required approved sandbox escalation. The
initial sandboxed container attempt failed because Docker was unavailable there;
the escalated tests passed. Test containers, child processes, and test-created
temporary directories were cleaned up. No frontend exists in this backend-only
ticket. Remote CI, deployment, and production migration were not run.

## Review Notes

- Standards review: no actionable findings. Spec review: no actionable findings.
  Independent reviewers inspected the tracked diff and new files against the
  ticket, schema, repository standards, and user-approved overrides. The TDD
  workflow exercised approved database, migration CLI, and repository-DI seams.
- The initial tree at `b8f8ea8` was clean. `AGENTS.md` was created during this
  conversation at the user's request. All listed changes belong to this task;
  no unrelated edits were included. Removed tracked fixtures remain recoverable
  from Git history. The existing `.test-dist/` ignore remains for legacy local
  build artifacts; no test command creates that directory now.
- Three mixed ASC/DESC indexes use `@Index(..., { synchronize: false })` because
  TypeORM cannot fully express them. Catalog tests verify their definitions;
  ordinary schema-drift checks alone cannot verify these indexes or triggers.
  Future generated migrations must still be reviewed.
- The monitoring-state check uses `IS TRUE` so SQL's three-valued logic cannot
  permit paused/completed rows with a null reason. JSON `null` is rejected as
  source data, while SQL NULL remains valid.
- TypeORM's version column increments on writes; this ticket does not implement
  V1-011's optimistic concurrency workflow. Likewise, actor columns have no User
  relation and Carrier slug behavior remains in V1-007.
- `down` deliberately removes the entire initial schema and its data. It is
  verified only against disposable databases. Application startup still never
  invokes migration execution or reversal automatically.

## Remaining Issues

- Remote CI has not run; all reported verification is local.
- Schema introspection emits a `pg` deprecation warning about concurrent queries
  on one client. Checks pass with the pinned dependencies; no dependency upgrade
  or driver patch is included in this schema ticket.
- The pre-existing PostgreSQL TLS deferral from V1-004 remains in `docs/v1/TODO.md`.
- The intentionally temporary Carrier repository test seam must be replaced and
  removed in V1-007. No required V1-005 implementation or local check is outstanding.

## Suggested Review Order

1. Approved deletion policy (`AGENTS.md`, schema document), then initial migration.
2. Five entity mappings, schema integration tests, and CLI/repository tests.
3. Fixture removals, package script, operator README, V1-007 follow-up, and summary.

## Proposed Commits

1. `feat(database): V1-005 establish no-action deletion policy`
   - Files: `AGENTS.md`, `docs/v1/database-schema.md`.
   - Purpose: record the approved default and explicit cleanup semantics.
2. `feat(database): V1-005 add initial schema and migration coverage`
   - Files: the migration and five entity files; `test/integration/schema.spec.ts`,
     `test/integration/database.spec.ts`, `test/support/carrier-repository.ts`;
     all six removed `test/support/database-proof/` files; removed
     `test/tsconfig.fixtures.json`; `package.json`.
   - Purpose: ship the atomic schema and seeds with matching entities and real
     PostgreSQL/repository/CLI verification, replacing the disposable proof.
3. `feat(docs): V1-005 document schema verification and follow-ups`
   - Files: `src/infrastructure/database/README.md`, the V1-005 and V1-007 tickets,
     and this implementation summary.
   - Purpose: document operation, verification, limitations, and test-seam cleanup.

Explicit final approval is required before staging and creating these commits.
No commit, merge, tag, push, or deployment was performed.
