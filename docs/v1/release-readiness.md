# V1-018 release-readiness audit

## Status and approved boundary

**Later decision (DEPLOY-V1-001):** App Platform configuration and CI/CD preparation
are approved. See [the deployment guide](app-platform.md) for the current target
and unresolved rollout gates. This does not authorize live deployment. The
original V1-018 boundary below is historical.

Local release verification and portable packaging are in scope. Production
deployment is **not approved or declared ready** by this report. DigitalOcean
managed PostgreSQL is selected; hosting is undecided. Caddy, production Compose,
App Platform configuration, deployment and new CI/CD workflows are explicitly
deferred. The pre-existing CI workflow remains unchanged.

Read the [implementation summary](implementation-summary/V1-018-implementation-summary.md)
for final commands/results. Baseline is `af76161793ca463d2de26d23a07adda1f8bcc4e3`;
the only pre-existing untracked file was `sample.txt`, which is untouched.

## Acceptance evidence map

Earlier ticket exclusions describe their original scopes, not missing features
after dependent tickets landed. In particular authentication, all real adapters,
manual refresh/events/notifications, and verified TLS are now implemented.

| Tickets / contract                                               | Current evidence                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1-001–002: supported scaffold, frozen dependencies, local gates | Pinned Node/pnpm, frozen lockfile, existing quality scripts and CI; fresh multi-stage image install/build; `pnpm check`. Existing hooks/workflow remain unchanged.                                                                                                              |
| V1-003–004: independent runtimes/config/health/persistence       | `runtime/composition.spec.ts`, `test/integration/runtime.spec.ts`, `test/e2e/app.spec.ts`, database options/CA tests and `test/integration/database-tls.spec.ts`; `test/container/runtime.test.ts`.                                                                             |
| V1-005: schema, seeds, migrations and data integrity             | `test/integration/database.spec.ts`, `schema.spec.ts`; fresh migration, all seven reversals/reapply, schema drift, constraints, ownership and foreign keys. Container test also exercises compiled CLI with production-only dependencies.                                       |
| V1-006: process-local cache                                      | `infrastructure/cache/*.spec.ts`, composition and UPS cache/session tests; no external cache store.                                                                                                                                                                             |
| V1-007–008: Carriers/Shipments                                   | Unit service tests, real repository tests and `test/e2e/carriers.spec.ts` / `shipments.spec.ts`: strict input, public projections, single-item creation, duplicate races, soft deletion, pause/resume.                                                                          |
| V1-009–010: employee auth                                        | Accepted ADR, `auth-api.md`, auth unit/integration/e2e tests: default-deny, roles, Origin/CORS, cookies, expiry/revocation, password lifecycle and transactional admin protection. Interactive CLI's previous PTY verification is historical evidence, not current V8 coverage. |
| V1-011–012: persisted outcomes/scheduling                        | `tracking.spec.ts`, `tracking-worker.spec.ts`, scheduler unit tests: snapshots, retained values, five-result threshold, rollback/races, sequential work, manual priority, startup recovery and cancellation.                                                                    |
| V1-013: UPS                                                      | Mapper/adapter unit tests, `ups-http.spec.ts`, `ups-worker.spec.ts`: tokens, quota/retries/cooldown, mapping, HTTP bounds, privacy and persistence.                                                                                                                             |
| V1-014–015: EchoShip/FFE                                         | Adapter/mapping unit tests and each provider's HTTP/browser/worker integration files, including FFE browser-network tests: isolated authentication, confirmed absence, paging, rate limits, timeouts, redirect protection, cancellation and allowlists.                         |
| V1-016: refresh/events/notifications                             | `test/e2e/refresh.spec.ts` includes HTTP-to-real-worker handoff with fake Carrier I/O; `events.spec.ts`, `notifications.spec.ts`, SSE queue/role tests and notification URL/UTF-8/cancellation tests.                                                                           |
| V1-017: structured logging                                       | Logging unit/e2e and compiled runtime tests: JSON records, correlation, safe projections, canary redaction, startup/shutdown. Child-process evidence is separate from V8 coverage.                                                                                              |
| V1-018: reproducibility and handoffs                             | Root README, frontend handoff, this audit, seven-heading summary, TLS/container regressions, combined coverage command and grouped source/test spacing.                                                                                                                         |

Paths without a prefix above refer to their named `src/` module or
`test/integration/` suite, not new root-level files. The
[ticket index](tickets/README.md) retains the original dependency order.

## Configuration and security review

Existing Nest/TypeORM/pg, Zod, Node TLS/fs/crypto, Vitest, Testcontainers, Docker
and installed Playwright satisfy this work; no application dependency or lockfile
change is needed. The image separates build tools from production dependencies
using [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/).
Matching Playwright Chromium and OS libraries are installed rather than using an
unrelated browser version; see [Playwright container guidance](https://playwright.dev/docs/docker).

Production `NODE_ENV` selects safe JSON logging and Secure cookies. Separate
DB fields preserve literal passwords. `synchronize`, `migrationsRun`, and
`dropSchema` stay false; migrations remain explicit one-shot operator work.
Public UUID projections omit internal numeric IDs, credential records, raw
Carrier bodies and source data. Authentication is default-deny; unsafe requests
require an exact Origin. Application logs omit bodies/references and project
error projections exclude original messages/stacks/causes in production.

`DB_SSL_MODE=verify-full` verifies chain and hostname; optional `DB_SSL_CA_FILE`
loads only a regular PEM file up to 64 KiB. File/configuration failures expose
neither its path nor contents. There is no `require`/`prefer`/insecure mode and no
fallback after TLS failure. Local default `disable` is intentional and **must be
overridden for the managed database**. Certificate files are read at startup;
rotate/mount the CA and restart processes when trust material changes.

The database pool has ten connections, five-second connection/statement limits
and a six-second query timeout. Auth and SSE reuse the TypeORM pool; each API's
listener holds a session connection. Worker and operator CLI processes have
separate pools. Use the managed DB's direct/session-capable endpoint, not a
transaction pooler, and budget connections for overlapping rollout processes.

External I/O bounds are in the provider/notification implementations and verified
with fixtures: UPS 15-second physical requests and bounded retries, EchoShip/FFE
30-second physical operations, 1 MiB UPS/4 MiB portal parsing bounds, notification
15-second deadline and bounded body. Provider RPM queue wait is intentional and
outside physical request timeouts; shutdown aborts pending work. Browser bodies
can be buffered before size validation, so the application cap is **not** a hard
Chromium memory cap. Local memory caches use finite TTL/bounded key domains, not
a project-wide LRU. SSE caps queued frames/output buffering and rechecks sessions.

Dependency advisory results are a point-in-time check, not proof of absence of
vulnerabilities. Bottleneck's older maintenance cadence remains a prior approved
tradeoff. Review image/OS vulnerabilities, exact managed server version and package
updates again at deployment; this ticket does not silently upgrade dependencies.
Ordinary tests never load production Carrier credentials or contact live providers.
The migration CLI intentionally retains operator-facing TypeORM diagnostics;
its output is not the public API's safe error envelope.

## Coverage interpretation

Before changes, unit-only coverage was **47.55% lines / 42.56% branches** with
214 tests. The same source under all three test projects reached **91.76% lines /
81.23% branches**, with 396 tests. Low unit-only coverage primarily reflected
repositories/migrations/auth/HTTP paths tested in PostgreSQL and e2e suites.

`pnpm test:cov` remains unit-only for the existing workflow. `pnpm test:cov:all`
builds and measures unit + integration + e2e together. Both write `coverage/`, so
run the combined command last for the release report. Remaining uncovered lines
include interactive CLI and compiled subprocess startup paths; V8 in the parent
does not instrument these automatically. Their process/container assertions do
not justify falsifying coverage exclusions or claiming 100% coverage.

## Open rollout and product gates

1. **Hosting and ingress:** select the hosting product/topology. Configure managed
   HTTPS/routing or an approved proxy, actual domains, SSE streaming and trusted
   client-IP handling. Current `AUTH_TRUST_PROXY` supports only false/loopback;
   a non-loopback managed ingress needs reviewed trusted-proxy configuration
   before relying on per-client rate limits. Do not set blanket trust.
2. **Managed database:** verify actual PostgreSQL version, network/trusted-source
   access, CA mount and hostname, migration permissions, backups/restore and
   operator connectivity. No managed database or production data was touched.
   The verified local test server is PostgreSQL 18.3, not evidence for every
   possible managed version.
3. **Runtime operations:** enforce one API and exactly one worker, provision
   secrets and enabled-Carrier credentials, decide resource limits, restart/
   alerting policy and worker readiness monitoring, run a controlled migration
   and bootstrap/recovery procedure. The worker has no HTTP health port and a
   running process alone does not prove active scheduling after a worker failure.
   The local verification image measured about 1.97 GB with Chromium; account for
   registry/startup transfer and evaluate size optimization after hosting is chosen.
4. **Frontend data:** BE-V1-001 adds normalized current tracking, latest completed
   lookup and latest associated run to Shipment responses after its additive
   migration. BE-V1-002 adds paginated Shipment search, and BE-V1-003 adds
   normalized snapshot history. BE-V1-004 adds bounded operational overview
   aggregates. BE-V1-005 adds precise committed tracking-change SSE events.
   Source diagnostics still have no public API. The
   [frontend handoff](frontend-handoff.md) describes the available fields and
   live-event payloads.
5. **External verification:** remote CI, actual-domain browser integration,
   production image/OS security scan, performance/load testing and live provider/
   notification checks are not performed here. No new CI/deployment workflow,
   external MQ, Redis, frontend, deploy folder or multi-worker claims are included.

Best-effort ntfy alerts can be lost after commit or ambiguously delivered on
network failure; there is no durable retry/outbox. SSE has no replay and requires
HTTP resync. Auth throttles and provider quotas are process-local. These are
approved v1 limits, not guarantees added by packaging.

### DEPLOY-V1-001 worker ownership and ingress follow-up

The worker entrypoint now acquires a dedicated PostgreSQL advisory lock before
Nest initialization, holds it through process exit, and exits on ownership loss
or scheduler failure. Waiting replacements do not start background work. The
App Platform spec enables validated `do-connecting-ip` login tracking while
retaining false Express proxy trust. See [App Platform guide](app-platform.md)
for trust assumptions, lock limitations, and the remaining live acceptance gates.
These changes do not authorize deployment or live database migration.
