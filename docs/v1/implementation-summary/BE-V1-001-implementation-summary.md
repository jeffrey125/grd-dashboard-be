# BE-V1-001 implementation summary

## Summary

Implemented current tracking, latest completed lookup and latest associated run
on every public Shipment response. All local acceptance criteria and final checks pass.
Baseline: `75ed0e73e7ee2497dc463abd026ab11f462d381f` on `master`.
The approved backend implementation was committed in two single-purpose commits.
No push, merge, live Carrier call, frontend feature or deployment was performed.

## Changes Made

- Reused approved installed NestJS, Zod, TypeORM, PostgreSQL, Vitest, Supertest
  and Testcontainers. No dependency or lockfile changes.
- Added immutable, unique, non-null snapshot UUIDv4 identities using PostgreSQL's
  existing `gen_random_uuid()` capability. The additive migration preserves
  snapshot values/internal keys, current pointers, attempt references and all
  `ON DELETE NO ACTION` relationships. Added a completed-attempt partial index.
- A shared persistence reader explicitly projects `currentTracking`,
  `latestLookup` and `latestRun`. It uses the current pointer, completion-time/ID
  ordering for completed attempts and creation-time/ID ordering for associated
  runs. Run counts cover all run attempts. Each response read is one SQL statement.
- List/detail, notes, pause/resume and created/existing creation results share the
  projection. Batch public records are read together after existing writes/locks.
  The legacy array, ordering, status codes, authorization and worker behavior stay
  compatible. Pending attempts do not displace completed lookup information.
- Updated API/schema handoffs and the frontend planning contract. Date-only fields
  remain `YYYY-MM-DD`; observation time is distinct from last successful lookup.

## Files Changed

### Backend schema and migration

| File                                                                             | Purpose                                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/infrastructure/database/migrations/1792281600000-TrackingReadProjection.ts` | Snapshot UUID backfill/default/unique constraint and completed-attempt index.          |
| `src/modules/tracking/shipment-tracking-snapshot.entity.ts`                      | Generated immutable public identity mapping.                                           |
| `src/modules/tracking/tracking-attempt.entity.ts`                                | Migration-owned partial index mapping.                                                 |
| `test/integration/tracking-projection-migration.spec.ts`                         | Populated backfill, values/pointers, UUID constraints, ORM defaults, rollback/reapply. |
| `test/integration/schema.spec.ts`                                                | Expected snapshot column; existing drift, FK and immutability checks.                  |
| `test/integration/database.spec.ts`                                              | Include sixth migration and complete rollback/CLI lifecycle.                           |
| `test/support/shipment-database.ts`                                              | Include migration in shared disposable fixtures.                                       |
| `test/integration/database-tls.spec.ts`                                          | Account for the sixth migration in the verified TLS CLI fixture.                       |
| `test/container/runtime.test.ts`                                                 | Account for six migrations in image/Compose rollback and reapply checks.               |
| `test/integration/runtime.spec.ts`                                               | Include migration in process fixtures.                                                 |
| `test/e2e/carriers.spec.ts`                                                      | Include migration in authenticated Carrier fixtures.                                   |
| `docs/v1/database-schema.md`                                                     | Identity/index design and migration/rollback semantics.                                |

### Backend projection and contracts

| File                                                                 | Purpose                                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/modules/tracking/tracking-read.schemas.ts`                      | Strict snapshot, latest lookup and run record schemas.                                    |
| `src/modules/tracking/tracking.repository.ts`                        | Derive run record type from schema; narrow reusable run mapper input.                     |
| `src/modules/shipments/shipments.schemas.ts`                         | Extend the inferred Shipment repository contract with three nullable projections.         |
| `src/modules/shipments/typeorm-shipment-read.ts`                     | Joined SQL selection and explicit public mapping.                                         |
| `src/modules/shipments/typeorm-shipments.repository.ts`              | Reuse the reader across all operations and resolve creation results consistently.         |
| `test/integration/shipment-projection.spec.ts`                       | Real tracking lifecycle, ordering/pointer cases and query-count evidence.                 |
| `test/e2e/shipments.spec.ts`                                         | Exact public fields, every response variant, date strings, Staff/Admin/restricted access. |
| `docs/v1/frontend-handoff.md`                                        | Actual public projection, date semantics and remaining endpoint gaps.                     |
| `docs/v1/release-readiness.md`                                       | Reconcile frontend data gate without changing deployment scope.                           |
| `README.md`                                                          | Link remaining API gaps instead of claiming all tracking fields are missing.              |
| `docs/v1/implementation-summary/BE-V1-001-implementation-summary.md` | Implementation, evidence, review and commit handoff.                                      |

### Frontend planning repository (documentation only)

| File                                                    | Purpose                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `docs/v1/api-contracts.md`                              | Mark only BE-V1-001 implemented locally; document migration and exact behavior. |
| `docs/v1/tickets/BE-V1-001-tracking-read-projection.md` | Ticket status and backend evidence link.                                        |
| `docs/v1/README.md`                                     | Reconcile implemented current tracking with remaining backend prerequisites.    |
| `docs/v1/tickets/README.md`                             | Update prerequisite status without claiming deployment.                         |

## Verification

| Exact command/check                                                                                                                                                                                                | Result                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                                                                                                                                                | Passed on final backend files.                                                                                                                                                                                                            |
| `pnpm lint`                                                                                                                                                                                                        | Passed with zero warnings.                                                                                                                                                                                                                |
| `pnpm typecheck`                                                                                                                                                                                                   | Passed, including the inferred run record contract.                                                                                                                                                                                       |
| `pnpm build`                                                                                                                                                                                                       | Passed; also run by final combined coverage.                                                                                                                                                                                              |
| `pnpm test`                                                                                                                                                                                                        | Passed all 228 unit tests in 25 files with permitted local loopback access.                                                                                                                                                               |
| `pnpm exec vitest run --project integration test/integration/shipment-projection.spec.ts --project e2e test/e2e/shipments.spec.ts`                                                                                 | Passed 15 tests in two files at the projection stage. Final expanded HTTP coverage is included in the combined run below.                                                                                                                 |
| `pnpm exec vitest run --project integration test/integration/shipment-projection.spec.ts test/integration/tracking-projection-migration.spec.ts test/integration/schema.spec.ts test/integration/database.spec.ts` | Passed all 31 tests in four files against disposable PostgreSQL 18.3.                                                                                                                                                                     |
| `pnpm test:cov:all`                                                                                                                                                                                                | Final pass: 421 tests in 53 files. Combined V8: 92.08% lines, 82.11% branches, 90.64% statements, 91.33% functions. Includes all unit, integration and HTTP suites.                                                                       |
| `pnpm test:container`                                                                                                                                                                                              | Final pass: all six checks in 79.6 seconds; production-only migration up/down/reapply, API readiness, non-root Chromium and worker lifecycle. Disposable API reachable at `http://127.0.0.1:32771`, then project/image/volume cleaned up. |
| `git diff --check`                                                                                                                                                                                                 | Passed for backend; scoped frontend `git diff --check -- docs/v1/api-contracts.md docs/v1/README.md docs/v1/tickets/README.md docs/v1/tickets/BE-V1-001-tracking-read-projection.md` also passed.                                         |
| Local Markdown link validation                                                                                                                                                                                     | Python checked relative links in the backend handoff/summary and four frontend planning files; all resolve.                                                                                                                               |
| Standards and specification review                                                                                                                                                                                 | Zero remaining findings after the run-schema/type duplication improvement; frontend planning recheck also found no issues.                                                                                                                |

The first HTTP regression (`pnpm exec vitest run --project e2e
test/e2e/shipments.spec.ts -t 'creates, reads, edits'`) failed on the missing null
fields, then passed. The PostgreSQL lifecycle regression initially failed on
missing stored tracking, then passed with the real joined projection.

Initial `pnpm check` passed format/lint/typecheck but had 225 unit passes and
three local-fixture listener failures (`listen EPERM 127.0.0.1`) under the sandbox.
The permitted-loopback unit run and final combined run pass; no test or production
behavior was weakened. The initial full `pnpm exec vitest run --project integration
--project e2e` had 192 passes and one stale five-migration assertion. The initial
container run exposed matching migration-count/rollback expectations. Updating
those fixtures to six migrations resolves both in the final runs above.

The pre-existing non-failing pg concurrent-query deprecation warning appears
during schema introspection. Combined coverage is whole-backend parent-process
coverage, not unit-only; compiled child-process/container execution has separate
behavioral assertions and is not measured by that V8 report. The report is in
`coverage/index.html` (ignored), and the final run log is outside the repository
at `/tmp/grd-be-v1-001-coverage.log`.

No frontend application tests/build, remote CI, production-domain checks,
production migrations, live Carrier calls or deployment were run. This is a
backend change plus frontend planning documentation; no development server was
left running. All verification services used disposable fixtures.

## Review Notes

- Standards review: no documented-rule violations. Its optional schema/type
  duplication finding was addressed by deriving `TrackingRunRecord` from Zod.
  Specification review: no actionable findings. Lead final diff review passed;
  all 23 backend files are accounted for in this handoff. Frontend planning
  review and relative-link checks also passed.
- No-snapshot and partial-data nulls, unchanged success, failed/not-found/skipped
  retention, pending runs, time/ID ties, pointer precedence and independently
  readable manual runs have direct real-PostgreSQL assertions.
- Representative query check projects 1,000 tracked Shipments in one statement;
  a ten-item duplicate batch performs one projection query. Existing per-pair
  insert/locking statements are retained for atomicity and deadlock avoidance.
  This is query-count evidence, not a production load benchmark.
- The UUID default rewrites populated snapshot storage under a table lock; apply
  the migration before API rollout with suitable operator migration time. It does
  not issue snapshot UPDATEs or disable the immutable trigger. Rollback discards
  public UUIDs; reapplication changes identities and needs client resync after
  public exposure. No existing data migration or production database was run here.
- Pre-existing backend `sample.txt` and frontend
  `docs/v1/tickets/FE-V1-002-quality-and-ci.md` remain untouched and excluded.

## Remaining Issues

None within BE-V1-001. BE-V1-002–005 remain separate, unimplemented tickets;
deployment and remote CI are not claimed.

## Suggested Review Order

1. Migration, entity mappings and populated migration/schema tests.
2. Tracking read schemas, Shipment reader/repository and HTTP/integration tests.
3. Backend handoff/schema notes, this summary and frontend planning updates.

## Committed History

1. `feat(database): BE-V1-001 add public snapshot identities`
   - Created as `72d552f`.
   - Files: the twelve backend schema/migration/documentation files listed above.
   - Purpose: additive snapshot UUIDs, completed-attempt index and database evidence.
2. `feat(shipments): BE-V1-001 expose current tracking and latest lookup`
   - This summary is included in the approved implementation commit; its final
     hash is reported in the interactive handoff.
   - Files: the eleven backend projection/contracts/documentation files listed above.
   - Purpose: consistent safe public tracking projection, tests and backend handoff.
3. `feat(docs): BE-V1-001 record implemented tracking projection`
   - Repository: `grd-dashboard-fe`; files: the four frontend planning files above.
   - Purpose: make the sibling frontend contract/status match the verified backend.
   - Created on `feature/dashboard-v1`; its final hash is reported in the
     interactive handoff.
