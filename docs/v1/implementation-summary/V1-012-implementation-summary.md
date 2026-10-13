# V1-012 implementation summary

## Summary

Implemented the worker-only scheduler, Carrier adapter/session contract, due-work
selection, sequential execution, manual priority, and interruption recovery.
The approved V1-012 scope is complete and locally verified. Real Carrier adapters
remain in V1-013–015. The user approved both planned commits. Implementation was
committed as `ab02777`; this summary accompanies the approved documentation commit.

The original application under `/home/jeff/apps/shipment-monitoring/` was studied
before the design interview. Its sequential Carrier execution, individual/batch
lookup support, cancellation, and failure isolation informed this implementation.
The new worker uses PostgreSQL run state and per-run sessions rather than the
legacy process-local coordinator and sessions retained between rounds.

## Changes Made

### Approved behavior and dependencies

- Added the explicitly approved `@nestjs/schedule@12.0.2`, pinned with pnpm.
  Its peer range supports Nest 12 and its Node requirement supports the installed
  Node 24.21.0. Node timers were evaluated as an alternative; the selected package
  supplies cron registration/lifecycle and `waitForCompletion` without maintaining
  those mechanisms locally. A process-local guard also protects the initial scan
  and direct tick calls. No external broker or distributed claims were added.
- After database readiness, validate every enabled Carrier adapter, recover
  running work, cancel abandoned queued scheduled selections, and scan immediately.
  Later scans occur each minute. An enabled Carrier without a registered adapter
  prevents startup. Disabled/deleted Carriers receive no new scheduled work.
- Execute one Carrier at a time. Drain queued manual runs in creation order
  before scheduled work and between Carrier runs. A request arriving during a run
  waits for that Carrier to finish. An idle worker discovers requests on its next
  minute scan. Continuous manual requests can delay scheduled work.
- Manual refresh is for one Shipment and does not delay its automatic check.
  The adapter-minimum eligibility query consults scheduled attempt history rather
  than `last_attempted_at`, which also includes manual attempts. Skips and worker
  interruptions do not establish a new minimum wait. Existing outcome services
  still compute normal intervals from database completion time.
- Abort on shutdown, preserve committed results, and allow 30 seconds for cleanup.
  Pending attempts become retryable interruptions; queued manual work survives.
  Startup recovery preserves V1-011 summary rules, including partial success when
  earlier outcomes were saved. No attempt at exactly-once or multiple-worker
  coordination is made.

### Execution and safety

The small adapter boundary exposes local configuration validation, the existing
reference-policy seam, minimum interval, and a cancellable session. Individual
reads and batch reads share reference validation. A batch receives all valid
targets once, and missing result entries become technical failures. Rate-limit
configuration is passed to the session; real adapters own physical requests,
retries, bounded I/O, and provider hard caps.

Tracking lifecycle writes remain in `TrackingService`; the new read-side
repository owns only due/manual/recovery queries. Runtime result validation uses
existing Zod schemas. Invalid results, lookup errors, and session-open errors are
isolated and persisted without counting as not-found. Sessions close after each
run. Late results from cancelled operations are discarded; late-opened sessions
are closed. Completed outcomes survive cleanup failures.

Worker state/reason codes are available through `status()` and safe structured
logs. Configuration errors retain only the existing safe error projection for
backend diagnostics, never raw messages, causes, credentials, or provider data.
A worker-level configuration/persistence failure stops further scans until the
operator resolves it and restarts the process. The API has no worker scheduler
provider or dependency on worker readiness.

The production registry is empty until the real adapter tickets land. Fresh
database seeds are enabled, so operators must disable unfinished Carriers through
the existing configuration API to start an idle V1-012 worker. Fake adapters are
confined to tests. No live Carrier requests or application database changes were
performed during this implementation.

## Files Changed

| File                                                             | Review purpose                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                   | Approved exact scheduler dependency.                                                                                                  |
| `pnpm-lock.yaml`                                                 | Reproducible scheduler and transitive dependencies.                                                                                   |
| `src/modules/carriers/adapters/carrier-adapter.ts`               | Session, adapter, cancellation, reference and rate-limit contract.                                                                    |
| `src/modules/carriers/adapters/carrier-result.ts`                | Typed and validated normalized result union.                                                                                          |
| `src/modules/carriers/adapters/carrier-adapter.registry.ts`      | Registry, duplicate detection, enabled configuration validation, safe diagnostics.                                                    |
| `src/modules/carriers/adapters/carrier-adapter.registry.spec.ts` | Missing registration and secret-safe configuration tests.                                                                             |
| `src/modules/carriers/adapters/carrier-adapters.module.ts`       | Production registration seam; no synthetic adapters.                                                                                  |
| `src/modules/tracking/tracking-work.repository.ts`               | Feature-owned scheduling read contract.                                                                                               |
| `src/modules/tracking/typeorm-tracking-work.repository.ts`       | PostgreSQL due, queued manual and startup-recovery queries.                                                                           |
| `src/modules/tracking/tracking-executor.service.ts`              | Session orchestration and outcomes through existing tracking services.                                                                |
| `src/modules/tracking/tracking-scheduler.service.ts`             | Initial/minute scans, overlap prevention, manual priority, recovery and shutdown.                                                     |
| `src/modules/tracking/tracking-scheduler.service.spec.ts`        | Fake-clock cadence, long-round overlap, safe startup and bounded shutdown.                                                            |
| `src/modules/tracking/tracking-worker.module.ts`                 | Worker-only provider and scheduler composition.                                                                                       |
| `src/worker.module.ts`                                           | Import the worker tracking module.                                                                                                    |
| `src/worker.ts`                                                  | Start tracking after database readiness.                                                                                              |
| `src/runtime/worker-lifetime.service.ts`                         | Removed obsolete idle keepalive; recoverable from Git.                                                                                |
| `src/runtime/composition.spec.ts`                                | API isolation and scheduler timer lifecycle.                                                                                          |
| `test/integration/tracking-worker.spec.ts`                       | Twelve real-PostgreSQL execution tests, fake-clock scheduler coverage, and real logger contract.                                      |
| `test/integration/runtime.spec.ts`                               | Migrate disposable runtime fixtures, disable unfinished adapters for idle startup, test missing-adapter failure independently of API. |
| `test/support/deferred.ts`                                       | Deterministic async test gates compatible with the existing TypeScript target.                                                        |
| `docs/v1/architecture.md`                                        | Worker startup, operational state, empty registry and recovery behavior.                                                              |
| `docs/v1/tracking-behavior.md`                                   | Approved manual priority and no-delay scheduling semantics.                                                                           |
| `docs/v1/database-schema.md`                                     | Scheduled-history eligibility without a schema change.                                                                                |
| `docs/v1/decisions.md`                                           | Record scheduler dependency approval.                                                                                                 |
| `docs/v1/tickets/V1-012-worker-scheduler.md`                     | Record approved decisions and link this handoff.                                                                                      |
| This summary                                                     | Review, verification, limitations and proposed commits.                                                                               |

## Verification

| Exact command/check                                                                                                    | Result                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm add --save-exact @nestjs/schedule@12.0.2`                                                                        | Passed with network escalation after sandbox DNS failure.                                                                                                                                                       |
| `pnpm exec vitest run --project unit src/modules/tracking/tracking-scheduler.service.spec.ts`                          | Passed: 4 fake-clock tests.                                                                                                                                                                                     |
| `pnpm exec vitest run --project integration test/integration/tracking-worker.spec.ts test/integration/runtime.spec.ts` | Passed: 28 tests against disposable PostgreSQL.                                                                                                                                                                 |
| `pnpm check`                                                                                                           | Passed: formatting, zero-warning lint, typecheck, 118 unit tests in 16 files, and build.                                                                                                                        |
| `pnpm test:integration && pnpm test:e2e`                                                                               | Passed: 76 integration tests in 7 files; 35 e2e tests in 4 files.                                                                                                                                               |
| `node /tmp/grd-v1-012-smoke.mjs`                                                                                       | Passed: compiled worker reached ready against disposable PostgreSQL; manually sent Enter to trigger SIGTERM; database disconnected, application stopped, process exited via SIGTERM, and container was removed. |
| Parallel Standards and Spec review, then follow-up review                                                              | Passed after corrections: 0 remaining findings on either axis.                                                                                                                                                  |
| `git diff --check`                                                                                                     | Passed during final review.                                                                                                                                                                                     |

Development red/green checks caught missing initial implementations and the
malformed-result case before their fixes. Review found invalid log event names
and missing batch reference validation; both were corrected and covered using
the real project logger and batch adapter fixture. The first full integration
run exposed a runtime-test migration-discovery error; explicit fixture migration
registration fixed it, and the full suite then passed.

Tests and the process smoke check used disposable PostgreSQL 18.3 containers with
approved Docker/local-port access. No SQLite substitute was used. Fake time
controls scheduler cadence, including manual priority across three blocked ticks;
PostgreSQL controls persisted timestamps and due comparisons.

The pre-existing Console Ninja injection in `node_modules/@nestjs/core/index.js`
added output/timers and caused a composition assertion failure. It was temporarily
disabled for clean verification and restored afterward. Original SHA-256:
`364eba7cc3835b3c22c76dea1f90c11bb071bbab4fb60bd78384fabbf661b8bf`.
The inherited `pg` concurrent-query deprecation warning remains in schema
introspection. Remote CI, deployment, live Carrier smoke tests and coverage
generation were not run. This is backend-only; no development server was left
running after the explicit start/stop verification.

## Review Notes

- Baseline: `94dd45e21ef714342c6f9b6e2b33ee6dfff8e83b`. The only pre-existing
  working-tree item was untracked `sample.txt`; it remains untouched and excluded.
- Database and API prerequisite behavior is present. Prior TLS, authentication,
  and real-adapter deferrals do not block this scheduler ticket. No migration,
  new foreign key, tracking persistence rewrite, or HTTP endpoint was introduced.
- Due work is reselected after manual work so a refreshed Shipment's current state
  and lock version are used. Existing tracking services recheck Carrier/Shipment
  eligibility and protect against edits made during lookups.
- Session cleanup failure is logged without undoing completed tracking. Adapters
  must honor cancellation and bound their own I/O; the worker cannot forcibly
  terminate arbitrary provider code, and startup recovery handles interrupted
  persistence after hard process termination.
- `implement-ticket` shaped the acceptance checks and handoff; `grilling` resolved
  behavior before coding; `implement`/`tdd` supplied test-driven slices and
  `code-review` supplied independent Standards and Spec reviews.

## Remaining Issues

- No incomplete V1-012 acceptance criterion remains. Real adapters and physical
  request limiting arrive in V1-013–015; the authenticated manual-refresh producer
  remains in V1-016. Missing enabled adapters intentionally prevent worker startup.
- Remote CI has not run. Pre-existing PostgreSQL TLS deferral, `pg` introspection
  warning, and local Console Ninja test interference remain outside this ticket.

## Suggested Review Order

1. Adapter contract/result/registry and scheduling read repository.
2. Scheduler/executor and worker composition.
3. Unit/integration/process tests, approved behavior docs and this summary.

## Approved Commits

1. `feat(tracking): V1-012 add worker scheduling and adapter execution`
   - Created as `ab02777`. Normal pre-commit formatting/lint, typecheck, and all
     118 unit tests passed with the same temporary instrumentation isolation.
   - Files: `package.json`, `pnpm-lock.yaml`, all source and test files in the table.
   - Purpose: deliver one coherent executable scheduler with its adapter contract,
     lifecycle, database reads, dependency, and regression coverage.
2. `feat(docs): V1-012 record worker behavior and verification`
   - Files: the six documentation files in the table, including this summary.
   - Purpose: preserve approved behavior, operational requirements and evidence.

The user explicitly approved staging and creating both commits.
No merge, tag, push or deployment is included in this handoff.
