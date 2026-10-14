# V1-016 implementation summary

## Summary

Implemented authenticated single-Shipment manual refresh, safe tracking-run
status, PostgreSQL-backed SSE change signaling, and best-effort Axios ntfy
notifications. The approved ticket scope is implemented and locally verified.
The four approved local commits described below were created. No production
migrations, deployment, push, merge or tag was performed.

The original shipment-monitoring worker, refresh API, SSE snapshot/heartbeat
behavior and notification handling were studied before the interview. Auth was
initially missing; work resumed after V1-009/V1-010 landed. Baseline for this work
is `5a414c4`. The unrelated untracked `sample.txt` remains untouched.

## Changes Made

- Staff/Admin can queue a single manual refresh and read public run status.
  Concurrent/repeated pending refreshes reuse one run, keeping its original
  requester. UUID casing is canonicalized before the advisory lock. Public bodies
  cannot supply actors. Missing/deleted targets return 404 and unavailable targets
  return 409. Refresh-all remains absent.
- Existing single-worker execution, minute discovery, manual priority, rate
  limits, active schedule preservation and threshold-pause recovery remain in
  place. The HTTP producer creates runs/attempts atomically in PostgreSQL.
- PostgreSQL triggers emit public-ID change signals only after commit, including
  attempt completion. The API uses a feature-owned EventsSource and its TypeORM/pg
  transport, with one shared listener, bounded reconnect delay, and resync.
  Authenticated SSE has 15-second heartbeats, per-frame session revalidation,
  bounded pending writes, disconnect cleanup and shutdown closure. HTTP remains
  authoritative; there is no event replay log.
- The user explicitly selected the already installed Axios package, replacing
  the ticket's original fetch default. Existing Nest, RxJS, pg, TypeORM and Zod
  cover the remaining work; package files are unchanged.
- Optional NTFY_URL enables notifications. First/changed results and stop
  transitions publish after persistence. Delivery combines change and stop into
  one message. Automatic pauses notify once per transition; reactivation permits
  another pause alert. Ordinary failures never claim monitoring stopped.
- Failed publishing is safely logged and discarded, without retries or durable
  delivery state. One failure alert per Carrier is suppressed until a confirmed
  found/not-found response. Axios has a 15-second total deadline, bounded payload/
  response sizes, no redirects, and shutdown cancellation. No live external
  notifications were sent during development.

## Files Changed

| File                                                                     | Review purpose                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `src/modules/tracking/tracking-http.module.ts`                           | Authenticated controller routes and feature composition.                    |
| `src/modules/tracking/tracking-http.service.ts`                          | Refresh input/error policy and safe status lookup.                          |
| `src/modules/tracking/tracking-http.repository.ts`                       | Queue/status contracts and public projections.                              |
| `src/modules/tracking/typeorm-tracking-http.repository.ts`               | Atomic coalescing, requester attribution and PostgreSQL status reads.       |
| `src/modules/tracking/typeorm-tracking.repository.ts`                    | Reuse existing transactional run/attempt primitives.                        |
| `src/app.module.ts`                                                      | Wire API-only tracking HTTP and events.                                     |
| `src/modules/events/events.source.ts`                                    | Feature-owned signal contract and validated public-ID schema.               |
| `src/modules/events/typeorm-events.source.ts`                            | Shared PostgreSQL listener, reconnect and lifecycle.                        |
| `src/modules/events/events.controller.ts`                                | Credentialed SSE, authorization checks, heartbeats and cleanup.             |
| `src/modules/events/events.module.ts`                                    | Bind source contract and controller dependencies.                           |
| `src/infrastructure/database/migrations/1792195200000-TrackingEvents.ts` | Reversible functions/triggers for commit-ordered signals; no new FK.        |
| `src/modules/notifications/tracking-notifications.ts`                    | Notification boundary and normalized outcome notice.                        |
| `src/modules/notifications/notifications.service.ts`                     | Axios publishing, outage suppression and safe failure diagnostics.          |
| `src/modules/notifications/notifications.module.ts`                      | Worker notification dependency binding.                                     |
| `src/modules/notifications/notifications.service.spec.ts`                | HTTP failure, suppression/recovery and shutdown cancellation.               |
| `src/modules/tracking/tracking.service.ts`                               | Capture transition notices under locks and publish after successful commit. |
| `src/modules/tracking/tracking.module.ts`                                | Wire the notification interface into worker persistence.                    |
| `test/e2e/refresh.spec.ts`                                               | Authenticated refresh race/status and real SSE lifecycle coverage.          |
| `test/integration/events.spec.ts`                                        | PostgreSQL commit/rollback signals and listener reconnection.               |
| `test/integration/notifications.spec.ts`                                 | All-Carrier transition alerts and persistence despite publishing failure.   |
| `test/support/shipment-database.ts`                                      | Include the event migration in disposable databases.                        |
| `test/integration/database.spec.ts`                                      | Include the migration in up/down/reapply CLI coverage.                      |
| `test/integration/runtime.spec.ts`                                       | Use current migrations in runtime fixtures.                                 |
| `test/e2e/carriers.spec.ts`                                              | Use current migrations in authenticated Carrier fixtures.                   |
| `.env.example`                                                           | Document optional notification configuration.                               |
| `docs/v1/architecture.md`                                                | HTTP/event/notification module boundaries and lifecycle.                    |
| `docs/v1/tracking-behavior.md`                                           | Approved endpoints, reconnect recovery and notification semantics.          |
| `docs/v1/decisions.md`                                                   | Record approved existing-dependency approach.                               |
| `docs/v1/tickets/V1-016-refresh-events-and-notifications.md`             | Replace the fetch default with the explicitly approved Axios choice.        |
| This summary                                                             | Review, verification, remaining boundaries and proposed commits.            |

## Verification

Final `pnpm exec vitest run --project e2e test/e2e/refresh.spec.ts` passed all
5 tests, including HTTP-to-worker handoff, on the final implementation. Final
`pnpm format:check` and `git diff --check` also passed after the summary update.

| Exact command/check                                                                                                                                                                                                                                                                                   | Result                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit src/modules/auth/auth.guard.spec.ts src/modules/auth/auth.config.spec.ts`                                                                                                                                                                                        | Passed: 3 prerequisite auth tests.                                                                                                                       |
| `pnpm check`                                                                                                                                                                                                                                                                                          | Passed on final implementation: formatting, lint, typecheck, 214 unit tests in 24 files, and production build.                                           |
| `pnpm exec vitest run --project integration --project e2e`                                                                                                                                                                                                                                            | Complete suite: 180 passed, 1 failed across 25 files. The failure was an old FFE rollback test counting migrations; fixed and its full file rerun below. |
| `pnpm build && pnpm exec vitest run --project integration test/integration/database.spec.ts test/integration/runtime.spec.ts test/integration/schema.spec.ts test/integration/events.spec.ts test/integration/notifications.spec.ts --project e2e test/e2e/refresh.spec.ts test/e2e/carriers.spec.ts` | Passed: all 75 tests in 7 affected files, including the rollback correction and final reviewed implementation.                                           |
| `pnpm exec vitest run --project e2e test/e2e/refresh.spec.ts --project integration test/integration/events.spec.ts`                                                                                                                                                                                   | Passed: 6 tests at the review-fix stage, including the mixed-case UUID race and database-listener reconnect.                                             |
| Independent Standards and Spec reviews and follow-up reviews                                                                                                                                                                                                                                          | Zero remaining findings on both axes after corrections.                                                                                                  |
| `git diff --check` and final diff/working-tree review                                                                                                                                                                                                                                                 | Passed; pre-existing `sample.txt` excluded and unchanged.                                                                                                |

Development red/green evidence includes the missing refresh endpoint, actor-spoofing
rejection, transactional event emission, and mixed-case UUID concurrency checks.
The UUID regression produced two runs before canonicalization and one afterward.
Notification tests cover all three Carriers and real local HTTP publishing failure;
SSE tests use real authenticated HTTP streams for heartbeat, reconnect, revocation
and API shutdown. A final test also hands an HTTP-created run to the real scheduler
and persistence using fake Carrier I/O, then reads its successful status by HTTP.

The initial sandbox lacked Docker/localhost access; required tests ran with
approved escalation against disposable PostgreSQL and local HTTP stand-ins.
The full long-running integration/e2e suite ran once; complete affected files
were rerun after corrections. Existing auth, worker priority/minimum intervals,
adapter rate limiting and interruption coverage passed in the complete run.
The existing pg schema-introspection deprecation warning remains non-failing.
Coverage generation, remote CI, frontend testing, production migration/deployment,
and live ntfy/Carrier calls were not run. This is backend-only; the API was reachable
on an ephemeral local test port and closed during shutdown verification. No
development server was left running.

## Review Notes

- Independent Standards review found the initial listener needed a feature-owned
  contract; EventsSource/TypeOrmEventsSource resolves it. Recheck: zero findings.
- Independent Spec review found case-sensitive advisory keys for case-insensitive
  UUIDs; canonical SQL casting and the reproduced regression resolve it.
  Recheck: zero material findings.
- Existing carrier adapters and scheduler are unchanged. HTTP manual requests
  can wait until the next minute scan, and continuous manual traffic can delay
  scheduled work, as previously approved in V1-012.
- Notifications are not exactly-once delivery: a crash after commit can lose an
  alert, and an ambiguous HTTP failure can mean ntfy received it. There are no
  application retries. Worker restart clears outage suppression.
- SSE sends invalidation signals, not every intermediate state. Clients refetch
  after resync and after changes received during a fetch. A quiet revoked session
  closes at the next heartbeat; a check immediately preceding revocation may
  finish. Long-lived listeners never hold open database transactions.
- The migration adds functions/triggers only. New foreign keys are not needed.
  Notification payloads contain references by product requirement; logs contain
  public UUIDs and safe static diagnostics, never topic URLs or Axios errors.

## Remaining Issues

No incomplete local acceptance criterion remains. Remote CI, production migration/
deployment, frontend integration and live ntfy/Carrier smoke tests have not run.
The existing non-failing pg introspection warning and deferred PostgreSQL TLS
work remain outside this ticket. Approved best-effort alert loss and transient
SSE delivery limits are described above; they are intentional product decisions.

## Suggested Review Order

1. Tracking HTTP contracts/repository, routes and refresh e2e tests.
2. Migration and EventsSource transport/controller with SSE tests.
3. Tracking outcome notices, Axios notification service and transition tests.
4. Documentation and verification evidence.

## Approved Commits

1. `feat(tracking): V1-016 add authenticated manual refresh runs`
   - Created as `781b494`.
   - Tracking HTTP files, transaction export, refresh/status e2e coverage and
     the tracking HTTP hunk in AppModule.
2. `feat(events): V1-016 stream committed shipment and run changes`
   - Created as `34c6d92`.
   - Event migration/module/source/controller, event integration and SSE e2e
     coverage, migration fixture updates, and EventsModule hunk in AppModule.
3. `feat(notifications): V1-016 publish best-effort tracking alerts`
   - Created as `337b74d`.
   - Notifications files/tests, tracking service/module integration, all-Carrier
     notification integration tests, and `.env.example`.
4. `feat(docs): V1-016 record refresh events and notification behavior`
   - This summary accompanies the approved documentation commit.
   - Architecture, decisions, tracking behavior, ticket and this summary.

Shared files were staged by coherent hunks, and the pre-commit typecheck plus all
214 unit tests passed for every commit. The user explicitly approved all four
commits. No push, merge or tagging is included.
