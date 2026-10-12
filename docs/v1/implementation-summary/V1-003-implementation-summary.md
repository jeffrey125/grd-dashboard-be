# V1-003 implementation summary

## Summary

Implemented independent Nest API and standalone worker composition roots, typed
and validated environment configuration, graceful shutdown, and liveness/readiness
health behavior. The scaffold greeting and its controller/service/test are removed.
Both processes start independently, reject invalid configuration, and execute
shutdown hooks for SIGINT and SIGTERM. Implementation is complete in the working
tree; no ticket changes have been committed, merged, tagged, or pushed.

## Changes Made

### Approved approach and dependencies

The user approved separate PostgreSQL `DB_*` variables, API readiness independent
of worker availability, and these exact production dependencies:

| Package            | Version | Fit and tradeoff                                                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@nestjs/config`   | 12.0.1  | Standard Nest environment-file loading and typed injection; adds configuration dependencies rather than maintaining a loader.  |
| `zod`              | 4.6.6   | Typed environment schemas and consistent validation; adds a schema dependency rather than handwritten parsing.                 |
| `@nestjs/terminus` | 12.1.0  | Health aggregation, dependency timeouts, and shutdown behavior; adds framework integration rather than a custom health engine. |

Compatibility was checked against npm package metadata and upstream documentation.
Both Nest packages support Nest 12; Terminus supports the pinned Node 24 runtime.
See [Nest configuration](https://docs.nestjs.com/techniques/configuration),
[Nest health checks](https://docs.nestjs.com/recipes/terminus), and
[Zod documentation](https://zod.dev/).

Node/Nest built-ins supply process lifecycle, shutdown hooks, and the worker's idle
keepalive. No separate validation adapter is needed. Configuration validation runs
inside the typed configuration factory during Nest initialization. Zod errors are
projected into fixed field guidance instead of exposing raw issue messages.

pnpm automatically added an exact `zod@4.6.6` minimum-release-age exclusion while
installing the explicitly approved version. The exclusion is version-specific;
the repository's existing dependency build-script restrictions remain in place.

### Configuration contract

| Variable      | Required/default | Behavior                                                                             |
| ------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`    | `development`    | Accepts only `development`, `test`, or `production`.                                 |
| `PORT`        | `3000`           | Decimal integer from 1 through 65535. Validated by both roots; only the API listens. |
| `DB_HOST`     | Required         | Nonblank, trimmed host string.                                                       |
| `DB_PORT`     | `5432`           | Decimal integer from 1 through 65535.                                                |
| `DB_NAME`     | Required         | Nonblank, trimmed database name.                                                     |
| `DB_USER`     | Required         | Nonblank, trimmed username.                                                          |
| `DB_PASSWORD` | Required         | Nonblank password, preserved verbatim without trimming or URL decoding.              |

Environment variables override `.env` in the current working directory. Variable
expansion is disabled so `$` in a password stays literal. With `NODE_ENV=test` in
the process environment, local `.env` loading is disabled. Unknown environment
variables are ignored by the schema. Invalid values fail startup with exit code 1
and field-specific guidance, without logging supplied values or retaining the
underlying validation error.

`configuration.KEY` provides the validated `RuntimeConfiguration`, including a
`database` object with `host`, `port`, `database`, `username`, and `password`.
`createConfiguration(environment)` is also a pure entry point for the later CLI
DataSource configuration; calling it does not bootstrap Nest or load a file.

`.env.example` contains no secrets. Its empty `DB_PASSWORD` deliberately requires
local setup. UPS, EchoShip, and FFE variable names are placeholders only. Carrier
validation belongs to the adapter tickets. There is no database connection, TLS
configuration, pool, query, migration, or schema change in this ticket.

### Runtime and health contracts

| Command                                       | Behavior                                                         |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm start` / `pnpm start:dev`               | Build/start the API, with watch mode in the development command. |
| `pnpm start:prod`                             | Run the previously built `dist/main.js`.                         |
| `pnpm start:worker` / `pnpm start:worker:dev` | Build/start the standalone worker, optionally with watch mode.   |
| `pnpm start:worker:prod`                      | Run the previously built `dist/worker.js`.                       |
| `pnpm test:e2e`                               | Build both entry points, then run HTTP and real-process tests.   |

Both composition roots load configuration; only `AppModule` imports the HTTP
health controller, and only `WorkerModule` creates `WorkerLifetimeService`.
The worker uses a referenced idle timer because a standalone Nest context does not
otherwise keep Node alive. The timer performs no application work and is cleared
on module destruction. V1-012 owns scheduling.

Both entry points enable Nest SIGINT/SIGTERM hooks. Safe fixed startup/shutdown
messages confirm lifecycle progress. Framework and Terminus error logging are
disabled until V1-017 supplies the safe logging bridge; unexpected startup errors
produce fixed guidance rather than raw errors/stacks. An API listen failure closes
its initialized context. Nest completes hooks before re-sending a received signal,
so direct child-process exits report the original signal rather than exit code 0.

| Endpoint            | Healthy result                                              | Failure behavior                                            |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /health/live`  | HTTP 200, `{"status":"ok"}`                                 | Independent of dependency readiness while HTTP can respond. |
| `GET /health/ready` | HTTP 200, Terminus `status`, `info`, `error`, and `details` | HTTP 503 for a failed dependency or shutdown.               |
| `GET /`             | HTTP 404                                                    | Scaffold greeting removed.                                  |

Health endpoints set `Cache-Control: no-store`. Readiness has an `application`
indicator that becomes ready after bootstrap and becomes unavailable during
shutdown. The default dependency list is empty: readiness currently proves runtime
initialization, not database connectivity or worker progress. API readiness is not
coupled to the separate worker, and the worker exposes no HTTP listener.

`READINESS_DEPENDENCIES` is an injectable list of named checks with an `AbortSignal`.
Later tickets can replace its provider with a factory that injects their database
or worker services. Keep names fixed and non-sensitive, and reserve `application`
for the lifecycle indicator. Configure each composition root's dependencies
separately when worker-specific checks are added; do not add worker imports to
`AppModule`. Each check is bounded to one second using Terminus and exposes only
`up`/`down`, omitting error messages and arbitrary metadata. Dependency code must
honor cancellation or use its own bounded I/O: a timeout cannot terminate arbitrary
noncooperative application work.

## Files Changed

| File                                                                        | Review purpose                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `package.json`                                                              | Exact production dependencies, worker scripts, build-before-e2e.                                                         |
| `pnpm-lock.yaml`                                                            | Reproducible dependency resolution.                                                                                      |
| `pnpm-workspace.yaml`                                                       | pnpm-generated exact-version release-age exception.                                                                      |
| `.env.example`                                                              | Runtime settings and future Carrier placeholders without secrets.                                                        |
| `src/config/env.schema.ts`                                                  | Strict field validation, defaults, and safe error projection.                                                            |
| `src/config/configuration.ts`                                               | Pure typed configuration mapping and Nest registration.                                                                  |
| `src/config/config.module.ts`                                               | `.env` loading, precedence, and test isolation.                                                                          |
| `src/config/env.schema.spec.ts`                                             | Missing/invalid values, coercion boundaries, password preservation, secret safety.                                       |
| `src/main.ts`                                                               | API startup, validated port, shutdown hooks, safe startup failure handling.                                              |
| `src/app.module.ts`                                                         | API-only configuration and health imports.                                                                               |
| `src/worker.ts`                                                             | Standalone worker startup/readiness and shutdown hooks.                                                                  |
| `src/worker.module.ts`                                                      | Worker-only provider composition without HTTP controllers.                                                               |
| `src/runtime/worker-lifetime.service.ts`                                    | Idle process lifetime and cleanup.                                                                                       |
| `src/runtime/startup-error.ts`                                              | Safe shared startup error reporting.                                                                                     |
| `src/runtime/composition.spec.ts`                                           | Root isolation and worker timer cleanup.                                                                                 |
| `src/modules/health/health.controller.ts`                                   | Liveness/readiness HTTP endpoints.                                                                                       |
| `src/modules/health/health.module.ts`                                       | API controller composition.                                                                                              |
| `src/modules/health/readiness.module.ts`                                    | Shared controller-free readiness providers.                                                                              |
| `src/modules/health/readiness.service.ts`                                   | Lifecycle state, dependency timeout, safe status aggregation.                                                            |
| `src/modules/health/health.controller.spec.ts`                              | Healthy/failed/stalled dependencies and lifecycle behavior.                                                              |
| `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts` | Removed temporary scaffold behavior; recoverable from Git history.                                                       |
| `test/support/environment.ts`                                               | Disposable, nonconnecting test configuration.                                                                            |
| `test/support/create-test-app.ts`                                           | Override readiness dependencies through existing Supertest helper.                                                       |
| `test/e2e/app.spec.ts`                                                      | HTTP health contracts, dependency failures, and removed route.                                                           |
| `test/e2e/runtime.spec.ts`                                                  | Real compiled processes, signal shutdown, configuration safety, `.env` precedence, occupied port, and root independence. |
| `vitest.config.ts`                                                          | Exclude the side-effecting worker entry point from unit coverage; covered by process tests.                              |
| `docs/v1/decisions.md`                                                      | Record newly approved production dependencies.                                                                           |
| `docs/v1/tickets/V1-003-runtime-config-and-health.md`                       | Link implementation status to this handoff.                                                                              |
| `docs/v1/implementation-summary/V1-003-implementation-summary.md`           | Decisions, contracts, verification, and review guidance.                                                                 |

## Verification

| Exact command/check                                                                                                                                   | Result                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm add --save-exact @nestjs/config@12.0.1 zod@4.6.6 @nestjs/terminus@12.1.0`                                                                       | Passed; installed approved versions.                                                                                                        |
| `pnpm typecheck`                                                                                                                                      | Passed.                                                                                                                                     |
| `pnpm lint`                                                                                                                                           | Passed.                                                                                                                                     |
| `pnpm test`                                                                                                                                           | Passed: 18 unit tests in 3 files.                                                                                                           |
| `pnpm build`                                                                                                                                          | Passed; both production entry points emitted.                                                                                               |
| `pnpm test:e2e`                                                                                                                                       | Passed: 13 HTTP/process tests in 2 files, including both signals for both roots.                                                            |
| `pnpm test:cov`                                                                                                                                       | Passed: 18 unit tests; 96.42% statements and 96.36% lines. Startup error reporting is exercised by process tests rather than unit coverage. |
| `pnpm test:integration`                                                                                                                               | Passed: 1 SQL smoke test against disposable PostgreSQL.                                                                                     |
| `env NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=runtime_test DB_USER=runtime_test DB_PASSWORD=fixture-password PORT=3137 pnpm start`        | Passed: API reported ready; Ctrl-C executed shutdown hooks and stopped the package script. Values are fixtures, not live credentials.       |
| `curl --fail --silent --show-error http://127.0.0.1:3137/health/live`                                                                                 | Returned `{"status":"ok"}`.                                                                                                                 |
| `curl --fail --silent --show-error http://127.0.0.1:3137/health/ready`                                                                                | Returned `status: ok` with `application: up`.                                                                                               |
| `curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3137/`                                                                | Returned 404.                                                                                                                               |
| `env NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=runtime_test DB_USER=runtime_test DB_PASSWORD=fixture-password PORT=3137 pnpm start:worker` | Passed outside the sandbox: worker reported ready; Ctrl-C executed shutdown hooks and stopped the package script.                           |
| `pnpm install --frozen-lockfile`                                                                                                                      | Passed outside the sandbox after its read-only store lock blocked the first attempt.                                                        |
| `pnpm check`                                                                                                                                          | Passed format check, lint, typecheck, 18 unit tests, and build.                                                                             |
| `git diff --check`                                                                                                                                    | Passed; final tracked diff and new files reviewed against ticket acceptance criteria.                                                       |

HTTP/process tests and Docker integration ran outside the filesystem/network
sandbox because local listening ports and the Docker socket require that access.
The sandboxed worker terminal check started successfully, but Ctrl-C ended its
wrapper with exit code 1 and no captured shutdown marker. Repeating the check
outside the sandbox produced `Application stopped` and a successful package-script
exit. Direct process tests separately verified both signals for both roots.
The frozen install initially failed with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`
because the sandbox mounted pnpm's store lock read-only; the approved retry passed.
Both manually started processes were stopped after verification. The API was
verified at `http://127.0.0.1:3137`; the worker has no URL.
Tests use only disposable configuration, start no Carrier calls, and remove their
temporary `.env` directory and child processes. Watch/debug modes and GitHub CI
were not exercised. No frontend exists in this backend-only ticket.

## Review Notes

- Prior summaries V1-001 and V1-002 were reconciled with the current scaffold,
  test helper, package scripts, and CI. Existing unit/e2e scaffold coverage was
  replaced rather than left pointing at the deleted greeting route.
- The implementation began with an unrelated untracked `.agents/` skill. It was
  committed externally as `51b011c` during this work. No skill file was edited or
  included in the proposed ticket commits.
- The implement-ticket skill supplied the acceptance review and Markdown handoff
  structure. Previously approved grilling decisions were preserved.
- Required DB credentials are validated now although connection behavior arrives
  in V1-004. The example file therefore cannot start either root until its password
  is filled in. Neither success nor readiness claims connectivity to PostgreSQL.
- Raw framework startup diagnostics are intentionally suppressed until the safe
  logging bridge arrives. This limits diagnostics but prevents raw configuration
  errors from bypassing the explicit safe reporting path.

## Remaining Issues

- Database connectivity/TLS and real database readiness indicators are deferred
  to V1-004. Worker scheduler readiness/monitoring is deferred to V1-012.
- Structured logging and the Nest logger bridge remain in V1-017.

## Suggested Review Order

1. Configuration schema/mapping/module, `.env.example`, dependency changes.
2. API/worker roots, worker lifetime, readiness service/controller, tests.
3. Verification results, decision updates, and this summary.

## Proposed Commits

1. `feat(runtime): add validated API and worker health foundations` — package and
   lockfile/settings, `.env.example`, all `src/` and `test/` changes, and Vitest
   coverage configuration. One coherent runtime change with its tests.
2. `docs(v1): document runtime configuration and health implementation` —
   `docs/v1/decisions.md`, the V1-003 ticket, and this summary.

Explicit commit approval is still required. No staging, commit, merge, tag, or
push was performed for this ticket.
