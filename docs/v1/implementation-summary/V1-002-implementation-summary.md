# V1-002 implementation summary

## Summary

Implemented deterministic local quality gates, staged-file checks, separate unit,
PostgreSQL integration and HTTP e2e suites, V8 coverage, and GitHub Actions CI.
Actual TypeORM migration/repository tests remain in V1-004; application schema
migration tests remain in V1-005, as agreed during implementation.

## Changes Made

### Local commands

| Command                             | Behavior                                                                |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `pnpm format` / `pnpm format:check` | Write/check Prettier formatting across the repository.                  |
| `pnpm lint` / `pnpm lint:fix`       | Oxlint correctness checks; warnings fail; fixes use safe `--fix` only.  |
| `pnpm typecheck`                    | Typecheck application, test support, all suites, and Vitest configs.    |
| `pnpm test` / `pnpm test:watch`     | Run/watch only the unit project, without Docker.                        |
| `pnpm test:cov`                     | Unit tests with V8 text, HTML, and LCOV reports under `coverage/`.      |
| `pnpm test:integration`             | PostgreSQL suites; requires an accessible Docker runtime.               |
| `pnpm test:e2e`                     | HTTP suites using Supertest and an initialized Nest application.        |
| `pnpm build`                        | Existing Nest production build.                                         |
| `pnpm prepare`                      | Install Husky hooks.                                                    |
| `pnpm check`                        | Format check → lint → typecheck → unit tests → build; stops on failure. |

The pre-commit hook runs lint-staged, typecheck, and unit tests in that order.
Within lint-staged, JS/TS files receive safe Oxlint fixes followed by Prettier;
other supported files receive Prettier formatting. Disjoint file patterns avoid
concurrent writes to the same file; unknown file formats are ignored.

### Dependencies and configuration

Added exact development versions: Oxlint 1.87.0, Prettier 3.9.10, Husky 9.1.7,
lint-staged 17.6.0, `@vitest/coverage-v8` 5.0.3,
`@testcontainers/postgresql` 12.2.0, Supertest 7.3.1, and
`@types/supertest` 7.2.1. The coverage provider matches existing Vitest 5.0.3.
Existing Node 24.21.0 and pnpm 12.11.2 pins are retained. No production dependency
was added. Vite's built-in `resolve.tsconfigPaths` provides path resolution.

`pnpm-workspace.yaml` contains package-manager settings only; it does not introduce
multiple packages or a workspace orchestrator. It explicitly disables the
transitive `cpu-features`, `ssh2`, and `protobufjs` build scripts: these supply
optional native acceleration or a version warning, and are unnecessary for the
verified local Docker tests. This resolves pnpm's ignored-build install failure
without globally enabling dependency scripts.

### Test and CI behavior

The root Vitest configuration selects named unit, integration, and e2e projects.
The default unit command excludes integration/e2e suffixes. Integration and e2e
projects discover both their `test/` directories and corresponding colocated
`src/**/*.integration.spec.ts` / `src/**/*.e2e.spec.ts` files. Database suites run
files serially, with 120-second setup and 30-second test timeouts.

The PostgreSQL helper starts a disposable `postgres:18.3-alpine` container. The
smoke test executes `SELECT 1` through the image's `psql` client and asserts both
exit status and output. Container cleanup runs in `afterAll`. A missing runtime
fails the suite; there is no conditional success or skip fallback. Application
driver connectivity and migrations will be tested when V1-004 installs `pg` and
TypeORM.

The HTTP smoke test boots the real `AppModule`, exercises `GET /` through
Supertest, and closes the application. V1-003 explicitly replaces its temporary
greeting assertion with health endpoint coverage.

CI runs on pull requests and pushes to `main`, using Ubuntu 24.04 runners,
read-only repository permissions, frozen installs, pinned project Node/pnpm
versions, and disabled Husky hooks. Independent jobs run quality/coverage/e2e/build
checks and PostgreSQL integration checks. The latter calls `docker info` before
running Testcontainers. Neither job publishes or deploys anything.

## Files Changed

| File                                                              | Review purpose                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `package.json`                                                    | Required scripts and exact development dependency versions.                |
| `pnpm-lock.yaml`                                                  | Reproducible dependency graph, including new peer resolutions.             |
| `pnpm-workspace.yaml`                                             | Explicit transitive build-script decisions.                                |
| `.oxlintrc.json`                                                  | Correctness rules, debugger rejection, generated-file exclusions.          |
| `prettier.config.mjs`                                             | Formatting conventions matching existing TypeScript.                       |
| `.prettierignore`                                                 | Exclude generated output, lockfile, and Husky internals.                   |
| `lint-staged.config.mjs`                                          | Ordered JS/TS fixes and non-overlapping formatting tasks.                  |
| `.husky/pre-commit`                                               | Staged checks → typecheck → unit tests.                                    |
| `tsconfig.json`                                                   | Include test/support and all Vitest configuration files in typechecking.   |
| `vitest.config.ts`                                                | Project registration, unit selection, and V8 reports.                      |
| `vitest.config.integration.ts`                                    | PostgreSQL suite discovery and timeouts.                                   |
| `vitest.config.e2e.ts`                                            | HTTP suite discovery and timeouts.                                         |
| `test/support/postgresql-container.ts`                            | Reusable disposable PostgreSQL startup.                                    |
| `test/integration/postgresql.spec.ts`                             | Real database SQL smoke test and cleanup.                                  |
| `test/support/create-test-app.ts`                                 | Initialize Nest for HTTP tests; clean up on startup failure.               |
| `test/e2e/app.spec.ts`                                            | Supertest scaffold smoke test and application cleanup.                     |
| `.github/workflows/ci.yml`                                        | Quality and integration jobs, without deployment.                          |
| `docs/v1/cache-design.md`                                         | Formatting-only normalization of embedded TypeScript.                      |
| `docs/v1/implementation-summary/V1-001-implementation-summary.md` | Formatting-only table alignment.                                           |
| `docs/v1/tickets/V1-002-quality-tooling-and-ci.md`                | Clarify container smoke-test scope and migration deferral.                 |
| `docs/v1/tickets/V1-003-runtime-config-and-health.md`             | Carry the new e2e test forward into health coverage.                       |
| `docs/v1/tickets/V1-004-typeorm-and-repository-foundation.md`     | Require actual migration/repository tests through the existing CI command. |
| `docs/v1/tickets/V1-005-initial-database-schema.md`               | Require schema migration tests through the same CI command.                |
| `docs/v1/implementation-summary/V1-002-implementation-summary.md` | This implementation and verification handoff.                              |

## Verification

| Check                                                                                                                                                               | Result                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                    | Passed after explicit build-script policy configuration; Husky initialized.                                                                                                           |
| `pnpm format`                                                                                                                                                       | Passed; established the formatting baseline, including two existing Markdown files.                                                                                                   |
| `pnpm check`                                                                                                                                                        | Passed format check, lint, typecheck, one unit test, and Nest build.                                                                                                                  |
| `pnpm test:cov`                                                                                                                                                     | Passed one unit test; generated text, HTML, and LCOV output.                                                                                                                          |
| `pnpm test:integration`                                                                                                                                             | Passed one SQL smoke test against real Docker/PostgreSQL.                                                                                                                             |
| `pnpm test:e2e`                                                                                                                                                     | Passed one HTTP smoke test.                                                                                                                                                           |
| `/tmp/grd-v1-002-actionlint/actionlint .github/workflows/ci.yml`                                                                                                    | Passed using actionlint 1.7.12.                                                                                                                                                       |
| `sh .husky/_/pre-commit`                                                                                                                                            | Passed; no staged files in the real repository, followed by typecheck and unit tests.                                                                                                 |
| `node /tmp/grd-v1-002-hook-order.mjs`                                                                                                                               | Passed ordered execution and short-circuit probes for all three hook stages.                                                                                                          |
| `node_modules/.bin/lint-staged --cwd /tmp/grd-v1-002-hook-test --config /home/jeff/apps/grd-dashboard/grd-dashboard-be/lint-staged.config.mjs --no-stash --verbose` | Passed against an isolated Git index: formatted staged TS/JSON, preserved an unsupported file.                                                                                        |
| `node /tmp/grd-v1-002-negative.mjs`                                                                                                                                 | All eight commands rejected deliberate fixtures: format, lint, typecheck, unit, integration, e2e, build, and aggregate check; actionlint also rejected an invalid expression context. |
| Frozen install of an isolated mismatched manifest                                                                                                                   | Correctly failed with `ERR_PNPM_OUTDATED_LOCKFILE`.                                                                                                                                   |
| `pnpm test:integration` with sandbox-blocked Docker access                                                                                                          | Correctly failed with `Could not find a working container runtime strategy`.                                                                                                          |
| `git diff --check`                                                                                                                                                  | Passed.                                                                                                                                                                               |

Temporary malformed source/test fixtures were removed before final verification.
Negative hook and install fixtures used separate `/tmp` directories and did not
stage project files or create commits. Docker and HTTP tests needed execution
outside the sandbox because it blocks the Docker socket and local listening ports.
Corepack's pnpm shim was enabled for the current Node installation so `pnpm`
commands and the installed hook work directly in the local shell.

## Review Notes

- The working tree was clean before implementation; no pre-existing user changes
  were mixed into this work. The two documentation formatting changes are required
  for the repository-wide formatter baseline.
- Coverage is reporting-only: this ticket specifies no minimum percentage.
  `src/main.ts` is excluded because importing the entry point starts a server.
- Container smoke coverage proves SQL execution inside PostgreSQL, not application
  driver connectivity, migration correctness, or repository behavior.
- The PostgreSQL image uses a fixed release tag, not a digest. The CI actions use
  upstream major-version tags. Dependency versions are locked with integrity hashes.
- The pre-commit skill supplied the hook sequence; its generic commit step was
  superseded by the repository's explicit final commit-approval requirement.

## Remaining Issues

- The workflow has been checked locally with actionlint, but has not run on GitHub.
- Migration/repository and application schema tests are intentionally deferred to
  V1-004 and V1-005. Health HTTP coverage replaces the scaffold smoke in V1-003.

## Suggested Review Order

1. `package.json`, package-manager settings, formatter/linter configuration, hook.
2. Vitest projects, TypeScript coverage of tests, and test helpers/smoke suites.
3. CI workflow, ticket handoffs, and this summary.

## Commits

1. `b78c56d chore(tooling): configure quality gates and test projects` — package and lockfile,
   package-manager settings, format/lint/hook files, TypeScript and Vitest configs,
   `test/`, and the two formatting-only Markdown changes.
2. `5c2a7f3 ci: run backend quality and PostgreSQL checks` — `.github/workflows/ci.yml`.
3. `docs(v1): record quality tooling and migration test handoff` — tickets V1-002
   through V1-005 and this summary.

No merge, tag, or push was performed.
