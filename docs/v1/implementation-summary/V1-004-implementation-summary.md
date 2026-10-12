# V1-004 implementation summary

## Summary

Implemented the shared PostgreSQL/TypeORM foundation for the API, worker, and
migration CLI. Real PostgreSQL tests prove the repository seam, reviewed migration
lifecycle, entity metadata, immutable identifiers, readiness recovery, and pool
cleanup. No production business tables are introduced. The implementation is in
the working tree; staging, committing, merging, tagging, and pushing are pending
explicit authorization.

## Changes Made

### Approved approach

The approved production dependencies are pinned to `@nestjs/typeorm@12.0.2`,
`typeorm@1.1.2`, and `pg@8.23.1`, using the existing pnpm lockfile. Compatibility
was checked against package metadata and upstream documentation. Nest supplies
connection ownership/retries; TypeORM supplies mappings, migrations, and repository
operations; node-postgres supplies pooling and connection/query timeouts. Existing
configuration, Pino logging, Terminus, Vitest, and Testcontainers remain in use.
The installed TypeORM binary supplies the CLI, and Node's built-in environment-file
loading avoids a runtime loader. No extra CLI or database abstraction dependency
was added.

### Runtime and migration behavior

- API and worker share validated `DB_*` settings and database options. Repeated
  imports reuse one DataSource within a Nest context; independent processes own
  independent pools. Each pool allows ten connections.
- Startup makes three initialization attempts, separated by one second. Connection
  acquisition is bounded to five seconds. Startup initialization also runs queries,
  so five seconds is not a total-startup deadline. Failed startup exits with code 1.
- Database readiness runs `SELECT 1`, coalesces overlapping checks, and exposes
  status only. Terminus limits its response to one second; driver query work is
  separately bounded. Later outages do not disable HTTP liveness, and readiness
  recovers when connectivity returns.
- Synchronization, automatic migrations, schema dropping, and automatic extension
  installation are disabled. Compiled production entity/migration globs exclude
  test fixtures. Both runtimes require a reachable database even though V1-004 has
  no production migrations yet.
- Migration generate/run/revert/show, schema-log, and query scripts build first
  and use the same options without starting Nest or HTTP. Migration/entity/subscriber
  creation scripts do not require a database build. `pnpm typeorm <command>` exposes the
  complete installed CLI. The CLI loads `.env` with Node, preserves literal
  passwords, and respects process-environment precedence; test mode skips `.env`.
  Migration transactions default to `all`.
- Database infrastructure lives under `src/infrastructure/database`. Cross-directory
  imports use the area-specific TypeScript aliases `@app/*`, `@config/*`,
  `@infrastructure/*`, `@modules/*`, `@runtime/*`, and `@test/*`; sibling imports
  stay relative. The Nest compiler rewrites aliases for ESM output, Vitest
  resolves them from `tsconfig.json`, and the fixture build uses the same Nest
  compiler.
- `worker.ts` now follows the same bootstrap/cleanup/error-reporting structure as
  `main.ts`, while retaining its worker-only readiness check before reporting ready.

### Entity, logging, and repository contracts

`AuditableEntity` defines an internal integer `GENERATED ALWAYS` identity,
creation/update/deletion timestamps, and nullable integer actor IDs without User
relations. `ExternallyIdentifiedEntity` adds a unique database-generated UUID with
application insert/update disabled. Neither extends TypeORM `BaseEntity`.

The disposable proof migration rejects changes to both `id` and `external_id`,
including identity reset through `SET id = DEFAULT`. V1-005 must implement these
reviewed triggers on production tables: TypeScript readonly fields and ORM mapping
alone do not protect direct SQL. No-op identifier assignments remain valid.
UUID uniqueness also applies to soft-deleted rows.

A test-only service injects a symbol-token repository contract, not TypeORM. Its
adapter handles persistence and returns a DTO without the internal integer ID.
The fixture is intentionally temporary and must be replaced/removed in V1-005
while preserving the assertions against real schema/repositories.

Runtime database lifecycle/error logging uses the project logger and fixed
messages, never SQL, parameters, credentials, or raw driver errors. By explicit
user decision, operator-invoked TypeORM CLI commands preserve complete stdout and
stderr, including failed SQL, parameters, driver diagnostics, and connection
metadata. This improves local diagnostics but can expose secrets or personal data;
output must be reviewed before sharing. Runtime application query logging remains
disabled.

Database shutdown exposed an existing asynchronous logging race. Shutdown now
waits for the log stream to drain using a positive one-byte buffer threshold.
The installed stream's `EINVAL` from `fsync` on stdout pipes is ignored only after
draining; other flush failures become a fixed safe error. Both signals for both
production entry points assert final lifecycle records without Nest errors.

## Files Changed

| File                                                                                                                                                                                     | Review purpose                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`                                                                                                                                                         | Approved exact dependencies, migration scripts, build-before-integration.                                                    |
| `.gitignore`, `test/tsconfig.fixtures.json`                                                                                                                                              | Isolate compiled disposable fixtures in ignored `.test-dist/`.                                                               |
| `src/infrastructure/database/database-options.ts`, `src/infrastructure/database/database-options.spec.ts`                                                                                | Shared safe options, paths, limits, and safety assertions.                                                                   |
| `src/infrastructure/database/database.module.ts`, `src/infrastructure/database/database-data-source.ts`                                                                                  | Nest ownership, retry policy, and safe connection/pool lifecycle.                                                            |
| `src/infrastructure/database/database-readiness.ts`                                                                                                                                      | Bounded/coalesced connectivity probe.                                                                                        |
| `src/infrastructure/database/database-logger.ts`, `src/infrastructure/database/database-logger.spec.ts`                                                                                  | Suppress unsafe driver/query data and allow bounded migration status.                                                        |
| `src/infrastructure/database/entities/auditable.entity.ts`                                                                                                                               | Shared integer identity, audit timestamps, actor columns.                                                                    |
| `src/infrastructure/database/entities/externally-identified.entity.ts`                                                                                                                   | Database-generated unique public UUID mapping.                                                                               |
| `src/infrastructure/database/data-source.ts`                                                                                                                                             | Compiled ESM DataSource used directly by TypeORM CLI.                                                                        |
| `src/infrastructure/database/README.md`                                                                                                                                                  | Operator commands, repository rules, lifecycle limits, and deferrals.                                                        |
| `src/main.ts`, `src/worker.ts`, `src/app.module.ts`, `src/worker.module.ts`, `src/modules/health/readiness.module.ts`                                                                    | Consistent runtime bootstrap, aliases, database connection, and readiness.                                                   |
| `tsconfig.json`, `test/tsconfig.fixtures.json`, `docs/v1/folder-structure.md`                                                                                                            | Alias resolution, fixture compilation, and infrastructure placement.                                                         |
| `src/infrastructure/logging/application-lifecycle-logger.ts`, `src/infrastructure/logging/logging.module.ts`                                                                             | Await complete final log writes during asynchronous database shutdown.                                                       |
| `src/runtime/composition.spec.ts`, `src/modules/health/health.controller.spec.ts`, `test/support/create-test-app.ts`, `test/support/test-database.module.ts`, `test/e2e/logging.spec.ts` | Keep HTTP/composition tests isolated while database behavior has real integration coverage.                                  |
| `test/support/postgresql-container.ts`, `test/integration/postgresql.spec.ts`                                                                                                            | Reuse disposable PostgreSQL setup and literal-password fixture environment.                                                  |
| `test/support/database-proof/proof.entity.ts`, `test/support/database-proof/proof.migration.ts`                                                                                          | Disposable matching schema, constraints, and immutable-identifier trigger.                                                   |
| `test/support/database-proof/proof.contract.ts`, `test/support/database-proof/proof.repository.ts`                                                                                       | Repository token, contract, adapter, and consuming service.                                                                  |
| `test/support/database-proof/data-source.ts`, `test/support/database-proof/failing-data-source.ts`                                                                                       | Real CLI fixtures and deliberately failing transactional migration.                                                          |
| `test/integration/database.spec.ts`                                                                                                                                                      | Repository/audit/identity behavior, CLI lifecycle, schema agreement, rollback, and complete error diagnostics.               |
| `test/integration/runtime.spec.ts` (moved from `test/e2e/runtime.spec.ts`)                                                                                                               | Real compiled roots now require PostgreSQL; verify signals, retries, single pool, outage/recovery, config, and independence. |
| `docs/v1/TODO.md`, `docs/v1/decisions.md`                                                                                                                                                | Explicit user-approved TLS deferral.                                                                                         |
| `docs/v1/database-schema.md`, `docs/v1/tickets/V1-005-initial-database-schema.md`                                                                                                        | Both identifiers immutable; replace proof fixture with real V1-005 coverage.                                                 |
| `docs/v1/tickets/V1-004-typeorm-and-repository-foundation.md`, this summary                                                                                                              | Implementation status and review-ready handoff.                                                                              |

## Verification

| Exact command/check                | Result                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`   | Passed; lockfile unchanged and dependency resolution skipped.                                                                                                          |
| `pnpm check`                       | Passed formatting, warning-free lint, TypeScript typecheck, 28 unit tests in 8 files, and production build.                                                            |
| `pnpm test:integration`            | Passed: 24 tests in 3 files after building production and fixture code. Uses disposable PostgreSQL 18.3 containers.                                                    |
| `npm run typeorm -- --help`        | Passed; exposed the complete installed TypeORM CLI through the package script.                                                                                         |
| `npm run migration:show -- --help` | Passed after a build; verified the named migration shortcut supplies the compiled DataSource.                                                                          |
| `pnpm test:e2e`                    | Passed: 3 HTTP/logging tests in 2 files after a production build.                                                                                                      |
| `pnpm test:cov`                    | Passed: 28 unit tests; 68.72% statements and 68.69% lines. Database/CLI/process behavior is covered by integration tests, not included in these unit-only percentages. |
| `git diff --check`                 | Passed; tracked diff and all new implementation/test files reviewed against the ticket and approved decisions.                                                         |

The integration suite runs the installed TypeORM CLI directly with
`migration:show -d .test-dist/test/support/database-proof/data-source.js`, then
`migration:run`, `migration:show`, `migration:revert`, and `migration:run` with
that same `-d` argument. It verifies the missing table after revert and a successful
repository operation after the second run. It also executes
`migration:generate /tmp/grd-proof-preview --dryrun` on the empty fixture schema
and `migration:generate /tmp/grd-proof-check --check` after restoration, both
with the fixture `-d`; no drift remains. Migration creation uses a newly allocated
temporary directory, and a deliberately failing migration verifies transactional
rollback and preservation of its diagnostic canary in CLI output. A missing
database check verifies that connection diagnostics are also preserved, and a
successful run asserts that TypeORM emits executed migration SQL.

Runtime tests cover one pool across repeated imports, database cleanup, three
startup attempts per root, four signal/root shutdown combinations, plaintext
connectivity with a literal-dollar password, readiness failure/recovery during a
paused disposable container, liveness independence, and safe startup failures.
All final suites passed after fixing the shutdown log-drain regression. Earlier
red runs caught missing final log records and the stdout-pipe `fsync` warning;
the final assertions require both complete lifecycle output and no Nest error.

Docker/socket and HTTP/process tests ran with approved sandbox escalation.
Containers, child processes, and test-created temporary files were cleaned up.
No production database migration or deployment was performed. Remote CI and
watch/debug checks were not run; existing CI invokes `pnpm test:integration`
without a workflow change.

## Review Notes

- The first spec review found that the CLI still sanitized connection failures.
  The CLI now uses a plain TypeORM DataSource while API/worker use the safe subclass;
  SQL and connection-diagnostic regression tests pass. Spec re-review found no
  remaining issue. A final alias review found one documentation wording mismatch
  for `@app/*`; the rule now correctly describes files directly under `src/`.
  Re-review found no remaining actionable issue. Independent reviewers inspected
  changes against baseline `5cf9b99`, including new files.
- The initial working tree was clean. The earlier TODO edit and all listed changes
  belong to this ticket; no unrelated user changes were overwritten. The deleted
  e2e runtime file is a move, with expanded coverage, not discarded tests.
- `@Generated('uuid')` aligns TypeORM metadata with PostgreSQL's generated UUID
  default and avoids perpetual migration churn; real schema comparison verifies it.
- Five-second statement and six-second client query limits apply to migrations
  too. Review these limits before introducing long-running data migrations.
- TypeORM CLI output is intentionally complete by user decision. Failed commands
  can expose SQL, parameter values, connection metadata, credentials embedded in
  errors, or personal data. Review output before sharing or retaining it.
- The general `pnpm typeorm <command>` entry exposes every installed CLI command.
  Destructive `schema:drop` and bypassing `schema:sync` are documented but have no
  named shortcut; reviewed migrations remain the project workflow.
- The implement-ticket workflow preserved approved interview decisions, drove
  test-first verification at the repository/runtime seams, and required this
  handoff and separate standards/spec reviews.

## Remaining Issues

- Verified PostgreSQL TLS is explicitly deferred to `docs/v1/TODO.md`. Current
  connections are plaintext; do not use this configuration over untrusted networks
  or with providers requiring TLS.
- V1-005 owns production entities/migrations, database identifier-protection
  triggers, and replacement/removal of the temporary proof fixtures/build setup.
- Remote CI, deployment, and watch/debug modes were not exercised. No production
  database was accessed. No frontend exists in this backend-only ticket.

## Suggested Review Order

1. Shared database options/module, readiness, CLI, and safe logging boundaries.
2. Entity bases, proof migration/repository, and PostgreSQL/runtime tests.
3. Dependency/scripts diff, operator README, follow-up scope, and verification.

## Proposed Commits

1. `feat(database): V1-004 add PostgreSQL and repository foundation` — all listed
   implementation/test files, `.gitignore`, `package.json`, and `pnpm-lock.yaml`,
   excluding `src/infrastructure/database/README.md` and `docs/`. Connects runtimes and supplies
   migration/repository contracts with regression tests as one coherent change.
2. `feat(docs): V1-004 document database foundation and follow-ups` —
   `src/infrastructure/database/README.md`, `docs/v1/TODO.md`, `docs/v1/decisions.md`,
   `docs/v1/database-schema.md`, both changed ticket files, and this summary.
   Documents operation, verification, identity guarantees, and approved deferrals.

Explicit final approval is required before staging or creating either commit.
