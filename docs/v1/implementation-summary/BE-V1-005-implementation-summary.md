# BE-V1-005 implementation summary

## Summary

Implemented and locally verified the precise `tracking.changed` server-sent
event. A committed Shipment current-snapshot change now publishes the Shipment
UUID, public snapshot UUID and observation timestamp while the existing generic
Shipment/run invalidations, resync, heartbeat and authorization behavior remain
compatible. Deployment was not performed.

## Changes Made

- Added additive migration `1792368000000-TrackingChangeEvents`. Its PostgreSQL
  trigger publishes through the existing `grd_changes` channel only when
  `current_tracking_snapshot_id` changes to a non-null snapshot owned by the
  Shipment. PostgreSQL transaction semantics suppress rolled-back notifications.
- Extended the strict Zod event union with `tracking.changed`, validated public
  UUIDs and a timestamp transformed to a `Date`. SSE serialization emits only
  `externalId`, `snapshotExternalId` and canonical UTC `observedAt`.
- Preserved the broad `shipment.changed` signal for the same tracking write.
  Snapshot inserts, unchanged pointers, null pointers, notes, scheduling,
  pause/resume, failed and not-found metadata do not produce the precise event.
- Kept the current SSE session revalidation, bounded queue/output buffering,
  listener recovery, resync, heartbeat and no-replay behavior. Staff and Admin
  sessions use the same existing policy.
- Reused PostgreSQL `LISTEN`/`NOTIFY`, Zod, RxJS, NestJS and the existing TypeORM
  migration infrastructure. No production dependency or lockfile change was
  needed.
- Updated migration fixtures and rollback/count expectations from six to seven
  migrations. Updated backend contracts/schema/release notes and the frontend
  API contract, ticket status and handoff documentation.

## Files Changed

| File                                                                                                                                         | Review purpose                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/infrastructure/database/migrations/1792368000000-TrackingChangeEvents.ts`                                                               | Add the reversible transactional pointer-change trigger.                                |
| `src/modules/events/events.source.ts`                                                                                                        | Validate and type the precise database event.                                           |
| `src/modules/events/events.controller.ts`                                                                                                    | Serialize the complete public SSE payload with a UTC timestamp.                         |
| `src/modules/events/events.source.spec.ts`                                                                                                   | Verify timestamp parsing and rejection of malformed/internal fields.                    |
| `src/modules/events/events.controller.spec.ts`                                                                                               | Verify the exact browser-facing frame.                                                  |
| `test/integration/events.spec.ts`                                                                                                            | Verify commit/rollback, exact payloads and false-positive exclusions in PostgreSQL.     |
| `test/e2e/refresh.spec.ts`                                                                                                                   | Verify authenticated Admin/Staff SSE behavior and the exact live event over HTTP.       |
| `test/support/shipment-database.ts`, `test/integration/database.spec.ts`, `test/integration/runtime.spec.ts`, `test/e2e/carriers.spec.ts`    | Register the additive migration in explicit disposable-database fixtures.               |
| `test/integration/database-tls.spec.ts`, `test/integration/tracking-projection-migration.spec.ts`, `test/container/runtime.test.ts`          | Update migration-stack count and rollback/reapply expectations.                         |
| `docs/v1/frontend-handoff.md`, `docs/v1/tracking-behavior.md`, `docs/v1/database-schema.md`, `docs/v1/release-readiness.md`                  | Document exact event behavior, migration mechanics, compatibility and no-replay limits. |
| Frontend `docs/v1/README.md`, `docs/v1/api-contracts.md`, `docs/v1/tickets/README.md`, `docs/v1/tickets/BE-V1-005-tracking-change-events.md` | Mark the prerequisite implemented and publish the exact frontend contract.              |

The pre-existing backend `sample.txt` and frontend
`docs/v1/tickets/FE-V1-002-quality-and-ci.md` changes are unrelated and remain
outside this ticket.

## Verification

| Command                                                                                                                                                                     | Result                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit src/modules/events/events.controller.spec.ts --reporter=verbose` before implementation                                                 | Expected red test: the old controller omitted snapshot identity and observation time.                                                                                                                                   |
| `pnpm check`                                                                                                                                                                | Passed: formatting, lint, typecheck, 261 unit tests in 26 files, and build.                                                                                                                                             |
| `pnpm exec vitest run --project integration test/integration/events.spec.ts test/integration/database.spec.ts --reporter=verbose --maxWorkers=1`                            | Passed: 13 tests in 2 files against disposable PostgreSQL.                                                                                                                                                              |
| `pnpm exec vitest run --project e2e test/e2e/refresh.spec.ts --reporter=verbose --maxWorkers=1`                                                                             | Passed: 5 SSE/refresh tests against disposable PostgreSQL and a local Nest HTTP listener.                                                                                                                               |
| `pnpm exec vitest run --project integration test/integration/database-tls.spec.ts test/integration/tracking-projection-migration.spec.ts --reporter=verbose --maxWorkers=1` | Passed: 7 focused migration/TLS regression tests after updating migration-stack expectations.                                                                                                                           |
| `pnpm exec vitest run --project integration --maxWorkers=1`                                                                                                                 | Passed: 166 tests in 25 files.                                                                                                                                                                                          |
| `pnpm test:e2e`                                                                                                                                                             | Passed: 49 tests in 7 files.                                                                                                                                                                                            |
| `pnpm test:cov:all`                                                                                                                                                         | Passed: 476 tests in 58 files; 91.04% statements, 82.54% branches, 91.80% functions and 92.43% lines.                                                                                                                   |
| `pnpm test:container`                                                                                                                                                       | Passed: 6 production-image/Compose checks, including applying, fully reverting and reapplying all seven migrations. Disposable API was reachable at `http://127.0.0.1:32773` during the test and was removed afterward. |
| `git diff --check` in backend and frontend repositories                                                                                                                     | Passed.                                                                                                                                                                                                                 |
| Parallel standards/spec review, followed by focused rereview                                                                                                                | Initial shared documentation finding corrected; final result: zero remaining findings on either axis.                                                                                                                   |

No live Carrier endpoint or production database was contacted. The first sandboxed
integration/check attempts could not access Docker or localhost sockets; the same
checks were rerun successfully with the repository's disposable local test
infrastructure.

## Review Notes

- PostgreSQL `NOTIFY` is commit-aware but not durable. Reconnect emits `resync`;
  `Last-Event-ID` still does not replay missed changes.
- A real tracking change emits both `shipment.changed` and `tracking.changed`.
  Existing consumers therefore retain their broad invalidation behavior while new
  consumers can identify the exact public snapshot revision.
- `snapshotExternalId` is the deduplication identity. `observedAt` describes when
  the normalized snapshot was first observed and is serialized in UTC; it is not
  a replay cursor.
- The ownership-safe composite foreign key already prevents cross-Shipment pointer
  assignments. The trigger repeats that ownership predicate when selecting public
  snapshot data and fails the transaction if the invariant is unexpectedly absent.
- The migration adds no foreign key, table, column or index. Rollback removes only
  the precise trigger and its function.

## Remaining Issues

None.

## Suggested Review Order

1. `src/infrastructure/database/migrations/1792368000000-TrackingChangeEvents.ts`
2. `src/modules/events/events.source.ts` and `src/modules/events/events.controller.ts`
3. `test/integration/events.spec.ts`, then the unit and SSE end-to-end tests
4. Migration-fixture/count updates
5. Backend contract documents, then frontend handoff documents
