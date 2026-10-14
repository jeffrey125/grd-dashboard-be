# V1-018 implementation summary

## Summary

Completed the approved local release-readiness work for backend v1: verified
PostgreSQL TLS, a portable non-root API/worker image, local API/PostgreSQL Compose
with an optional single worker, expanded release/security tests, combined coverage,
operator documentation, frontend handoff, repository instructions and domain
language. The original shipment-monitoring application and Tom deployment repos
were studied before implementation as requested.

The application is locally release-verifiable, not production-deployed. Hosting
is undecided. Caddy, production Compose, App Platform configuration, deployment
and new CI/CD workflows are explicitly deferred. No application database, live
Carrier, notification service or remote host was changed. The existing workflow
is unchanged. The unrelated pre-existing untracked `sample.txt` remains untouched.

## Changes Made

### Database transport and verification

- Added `DB_SSL_MODE=disable|verify-full` and optional `DB_SSL_CA_FILE`. Managed
  PostgreSQL must use verify-full; certificate-chain and hostname checks remain
  enabled. Insecure require/prefer/no-verify modes and plaintext fallback are
  unavailable. Local development retains an explicit plaintext default.
- Optional provider CA input must be a readable, nonempty regular PEM file up to
  64 KiB. Node parses every certificate before pool creation. Nonblocking open
  rejects FIFOs/devices without hanging startup. Safe configuration failures do
  not retain the path, certificate, filesystem error or OpenSSL diagnostic.
- The shared TypeORM options apply to API, worker, migrations, auth CLI, Better
  Auth's reused pg pool and the SSE LISTEN client. A real TLS PostgreSQL fixture
  proves trusted migration/listener connections and rejects a wrong CA, missing
  trust root, hostname mismatch, plaintext server and malformed/non-file inputs.
- Reused installed pg/TypeORM, Zod and Node fs/crypto/TLS; no new application
  package or lockfile change. `synchronize`, `migrationsRun` and `dropSchema`
  remain false. Existing `ON DELETE NO ACTION` mappings/migrations are unchanged.

### Portable image and local Compose

- Added one multi-stage Debian-slim image for both entry points. It installs with
  the frozen lockfile, prunes development packages, bundles Playwright's matching
  Chromium/OS libraries, copies compiled output only and runs as non-root `node`.
  The allowlisted build context excludes dotenv files, Git, source specs, tests,
  captures, artifacts and the user's `sample.txt`.
- Added local-only Compose: private PostgreSQL 18.3 with persistent named volume,
  one-shot migrations, loopback API with readiness healthcheck and an opt-in
  `worker` profile fixed to one replica. API/worker share the image but have
  separate commands. An init process and 40-second grace exceed worker cleanup.
- Added a disposable container test that builds the actual image, migrates before
  API readiness, checks auth default-deny, non-root/no-build-tools/no-local-secret
  properties, launches real Chromium, rejects an unconfigured enabled worker,
  starts/stops exactly one idle worker, parses JSON logs, and fully reverts/reapplies
  all five migrations using production-only dependencies. It removes its uniquely
  named image/project/volume afterward and performs no live Carrier I/O.
- No production Compose, Caddy file, App Platform spec, deploy directory, frontend
  source, Redis/MQ, multi-worker mechanism or new workflow was added.

### Tests, coverage and documentation

- Added SSE regressions for session restriction, output-buffer overflow, queued
  slow consumers and late authentication completion. Added notification tests for
  unsafe topic URLs, blank disablement, UTF-8-safe bounded messages and log privacy.
- Retained `test:cov` as the fast unit-only command and added `test:cov:all` for
  the three Vitest projects. Unit-only coverage now has 228 tests and 49.31% lines;
  combined coverage has 416 tests, 92.06% lines and 82.06% branches. Lower unit
  coverage is expected because integration/e2e own databases, HTTP and browsers.
- Added a root operational README, a requirements/evidence release audit and a
  detailed frontend handoff. The handoff states the critical current product gap:
  Shipment APIs do not expose normalized tracking snapshot/status/date fields.
  It does not invent endpoints or promise deployment behavior.
- Expanded `AGENTS.md` with precise context/testing/security/spacing pointers and
  `CONTEXT.md` with domain-only terms. Updated authoritative v1 decisions,
  architecture, TODO/index and the ticket with actual V1-018 scope.
- Applied grouped blank-line spacing across `src/` and `test/`. A TypeScript AST
  printer comparison checked every touched file while applying it: syntax and
  literal contents were identical. `git diff -w --ignore-blank-lines` isolates
  the small behavioral/configuration test set from this requested formatting.

## Files Changed

| Area                                                                         | Review purpose                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/config/env.schema.ts`, `configuration.ts`, config/database option tests | Validate/map TLS mode and CA path with safe errors and local defaults.           |
| `src/infrastructure/database/database-tls.ts`, `database-options.ts`         | Bounded CA loading plus verified-only pg TLS options.                            |
| `test/integration/database-tls.spec.ts`                                      | Real TLS migration/pool/listener and fail-closed cases.                          |
| `Dockerfile`, `.dockerignore`                                                | Portable production-dependency runtime with Chromium and allowlisted context.    |
| `docker-compose.dev.yml`, `.env.docker.example`                              | Local DB/migration/API lifecycle and opt-in one-worker profile.                  |
| `test/container/runtime.test.ts`, `package.json`                             | Opt-in release check and clearly named combined coverage/container commands.     |
| `src/modules/events/events.controller.spec.ts`                               | SSE authorization and bounded-backpressure regressions.                          |
| `src/modules/notifications/notifications.service.spec.ts`                    | Topic validation, UTF-8 bound, optionality and privacy regressions.              |
| `README.md`, `docs/v1/release-readiness.md`, `frontend-handoff.md`           | Operator commands, acceptance/security evidence, rollout gates and FE contract.  |
| `AGENTS.md`, `CONTEXT.md`                                                    | Agent navigation/completion rules and canonical domain language.                 |
| `docs/v1/README.md`, `architecture.md`, `decisions.md`, `TODO.md`, ticket    | Reconcile TLS/packaging status and explicitly deferred infrastructure.           |
| Existing TypeScript under `src/` and `test/`                                 | Requested whitespace-only statement grouping outside the functional files above. |
| This summary                                                                 | Review-ready scope, evidence, risks and planned commits.                         |

`.gitignore` permits the tracked Docker environment template while continuing to
ignore actual `.env*` files. `.env.example` documents native TLS configuration.
No migration/entity/schema, dependency lock, CI workflow or deployment file changed.

## Verification

| Exact command/check                                                                                                                        | Result                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                           | Passed; lockfile unchanged and package-manager supply-chain policy passed.                                                                                                                                                                                                                           |
| `pnpm audit --prod` and `pnpm audit`                                                                                                       | Passed; no known published vulnerabilities in production or full locked graph at verification time.                                                                                                                                                                                                  |
| Initial `pnpm test:cov`                                                                                                                    | Passed 214 baseline unit tests after localhost permission escalation; 47.55% lines / 42.56% branches.                                                                                                                                                                                                |
| Initial `pnpm build && pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/grd-v1018-combined-coverage`                       | Passed 396 baseline tests in 49 files; 91.76% lines / 81.23% branches.                                                                                                                                                                                                                               |
| Red/green TLS option tests                                                                                                                 | Initially 3 expected failures; implementation rerun passed 17 focused configuration/database tests.                                                                                                                                                                                                  |
| `pnpm build && pnpm exec vitest run --project integration test/integration/database-tls.spec.ts`                                           | Passed 6 tests against TLS and plaintext disposable PostgreSQL, including compiled migration CLI and SSE listener. Final CA FIFO hardening focused rerun passed.                                                                                                                                     |
| `pnpm exec vitest run --project unit src/modules/events/events.controller.spec.ts src/modules/notifications/notifications.service.spec.ts` | Passed 13 focused authorization/backpressure/notification tests.                                                                                                                                                                                                                                     |
| `docker build -t grd-dashboard-be:v1-018-check .`                                                                                          | Passed using pinned Node 24.21.0 slim runtime and matching Playwright Chromium.                                                                                                                                                                                                                      |
| `pnpm test:container`                                                                                                                      | Passed all 6 checks in 155.4 seconds; disposable API reachable at an ephemeral loopback port; project/image/volume removed.                                                                                                                                                                          |
| `node /tmp/grd-auth-cli-check.mjs`                                                                                                         | Passed disposable-DB PTY bootstrap, second-bootstrap refusal, hidden-password recovery, replacement flag and noninteractive rejection.                                                                                                                                                               |
| `pnpm check`                                                                                                                               | Passed Prettier, zero-warning Oxlint, typecheck, 228 unit tests in 25 files and production build.                                                                                                                                                                                                    |
| Final `pnpm test:cov`                                                                                                                      | Passed 228 unit tests; 49.31% lines, 44.77% branches, 48.49% statements, 48.33% functions.                                                                                                                                                                                                           |
| Final `pnpm test:cov:all`                                                                                                                  | Passed 416 tests in 51 files; 92.06% lines, 82.06% branches, 90.64% statements, 91.41% functions.                                                                                                                                                                                                    |
| TypeScript spacing AST equivalence; `git diff -w --ignore-blank-lines` review                                                              | Syntax/literals unchanged by spacing; only intended implementation/config/test files have non-whitespace tracked changes.                                                                                                                                                                            |
| Standards/Spec parallel review                                                                                                             | Both agents inspected the changes and reported no material issue before their accounts hit usage limits. Standards identified the CA FIFO startup edge; it was fixed and regression-tested. Their final report generation was unavailable, so the lead performed the final two-axis fallback review. |

The full run emits the existing non-failing node-postgres concurrent-query
deprecation warning during TypeORM schema introspection. No test was skipped.
PostgreSQL/Testcontainers, local sockets, Docker and Chromium were available.
Remote CI, live provider/ntfy, production deployment/database and actual-domain
browser testing were intentionally not run.

## Review Notes

- Baseline is `af76161793ca463d2de26d23a07adda1f8bcc4e3`. Only untracked
  `sample.txt` predated this task; it remains untouched/excluded. No existing user
  change was incorporated. The requested broad spacing makes the raw diff large;
  ignore whitespace first when reviewing behavior.
- The image pins Node's exact patch tag; production rollout should additionally
  decide registry/digest update policy and scan the final pushed image. Chromium
  raises image size but keeps both approved browser fallback modes portable. The
  locally built verification image measured 1,973,872,260 bytes (~1.97 GB), so
  registry/storage transfer and later size optimization deserve deployment review.
- `verify-full` with no custom CA intentionally uses Node's trust store. A managed
  provider CA path is expected for DigitalOcean. Use the provider hostname and
  direct/session-capable connection; an IP mismatch or transaction pooler fails
  by design or breaks LISTEN semantics.
- Existing operational boundaries remain: one API/worker, process-local auth/
  Carrier limiting, best-effort non-durable ntfy, transient SSE plus HTTP resync,
  and no worker HTTP health endpoint. Container liveness is not scheduler health.
- The frontend can build auth, Carrier, Shipment CRUD/monitoring, manual refresh,
  run state and SSE invalidation. It cannot truthfully display normalized Carrier
  status or pickup/delivery dates until a backend read projection is approved.
- `implement-ticket` governed context/acceptance/handoff, TDD supplied observable
  red/green seams, `writing-for-agents` kept `AGENTS.md` as concise pointers, and
  `domain-modeling` kept `CONTEXT.md` free of implementation details.

## Remaining Issues

- Production hosting/ingress is not selected. Caddy, production Compose, App
  Platform specs, deployment and new CI/CD remain deferred by user decision.
- Before rollout: configure actual DigitalOcean PostgreSQL network/CA/version,
  backups/restore and migration privileges; solve trusted client-IP handling for
  the selected ingress; size/scan/monitor the runtime; keep exactly one worker;
  and run actual-domain browser/SSE and controlled live-provider checks.
- The Shipment read API lacks normalized Tracking Snapshot status/date fields.
  Frontend tracking-detail parity is blocked until that separate contract/change.
- Remote CI has not run. The pre-existing pg/TypeORM introspection deprecation
  warning remains. Interactive CLI/process/container checks are valid behavioral
  evidence but are not attributed to the parent Vitest V8 coverage report.

## Suggested Review Order

1. `docs/v1/release-readiness.md`, ticket amendments and this summary for scope,
   evidence and remaining gates.
2. TLS schema/loader/options and `database-tls.spec.ts` for fail-closed behavior.
3. Dockerfile, allowlist, local Compose and container test for lifecycle/safety.
4. Focused SSE/notification tests, coverage scripts and requested spacing diff.
5. README, frontend handoff, AGENTS/CONTEXT and reconciled v1 documents.

## Approved Commits

The user explicitly approved all five commits:

1. `315b5ab feat(database): V1-018 add verified PostgreSQL TLS` — config, TLS
   loader, options/tests, `.env.example` and TLS integration coverage.
2. `a618a46 feat(containers): V1-018 package portable local runtime` — Docker
   image, build allowlist, local Compose/template, container test and package
   scripts.
3. `1098bcc feat(testing): V1-018 expand release behavior coverage` — SSE and
   notification regression tests.
4. `8f13c69 feat(style): V1-018 group TypeScript statement spacing` — isolated
   whitespace-only `src/` and `test/` changes.
5. `feat(docs): V1-018 document release and frontend handoff` — this approved
   documentation commit; its hash is reported in the interactive handoff because
   a commit cannot contain its own hash.

No push, merge, tag, migration or deployment is implied by this approval.
