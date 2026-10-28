# MON-V1-004 — Manual Other carrier

## Summary

Implemented the approved manual Other carrier across backend and frontend. Staff
reuse Add shipment and edit manual dates/status on the shipment detail page.
Admins can enable or disable new Other entries. Due follow-ups appear in Needs
attention, including delivered shipments and records whose carrier is disabled.

## Changes Made

- Migration seeds enabled `other`; existing tables store manual snapshots and
  record/editor attribution. No new columns, foreign keys, adapters or packages.
- Optional `manualTracking` on creation/update accepts exactly Pending Pickup,
  Pickedup, Out for delivery or Delivered, plus nullable pickup and estimated
  delivery dates. Other defaults to Pending Pickup; automated carriers reject it.
- Manual changes append immutable snapshots transactionally. Delivered records
  today's New York date internally; further delivered edits preserve it and
  reopening clears it. Unchanged values do not append snapshots.
- Other appears in All and its own tab, outside Active/Delivered. Today/overdue
  reminders also appear in Needs attention and overview. Worker scheduling,
  adapter validation, Refresh, pause/resume and Monitor again exclude Other.
- Admin toggles only `isActive`. Disabled Other blocks creation but preserves edits,
  history and reminders. Existing duplicate/assignment/follow-up rules remain.

## Files Changed

Backend paths below are relative to `grd-dashboard-be`. Changes shared with the
prior FILTER-V1-001 work must be staged by hunk, with the filter commit first.

| File                                                                         | Reason                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/infrastructure/database/migrations/1793491200000-ManualOtherCarrier.ts` | Seed Other; referenced carrier rollback is blocked by existing foreign keys.                      |
| `src/modules/shipments/shipments.schemas.ts`                                 | Manual tracking validation, Other tab and count.                                                  |
| `src/modules/shipments/shipments.service.ts`                                 | Reject manual data for automated carriers.                                                        |
| `src/modules/shipments/typeorm-manual-tracking.ts`                           | Append snapshots and project manual state/date/editor atomically.                                 |
| `src/modules/shipments/typeorm-shipments.repository.ts`                      | Create/update manual shipments; reject pause/resume.                                              |
| `src/modules/shipments/typeorm-delivered-monitoring.ts`                      | Exclude manual records from delivered polling reconciliation.                                     |
| `src/modules/shipments/shipment-read-predicates.ts`                          | Other tab; exclude Other from Active/Delivered.                                                   |
| `src/modules/shipments/typeorm-shipment-search.ts`                           | Return Other tab count.                                                                           |
| `src/modules/dashboard/typeorm-dashboard.repository.ts`                      | Return Other overview count.                                                                      |
| `src/modules/carriers/carriers.service.ts`                                   | Restrict Other settings to enable/disable.                                                        |
| `src/modules/carriers/carriers.service.spec.ts`                              | Match carrier lookup before settings validation.                                                  |
| `src/modules/tracking/tracking-scheduler.service.ts`                         | Exclude Other from adapter validation and scheduled rounds.                                       |
| `src/modules/tracking/tracking-scheduler.service.spec.ts`                    | Only-Other worker starts without an adapter and performs no scan.                                 |
| `src/modules/tracking/typeorm-tracking-work.repository.ts`                   | Exclude Other from due work queries.                                                              |
| `src/modules/tracking/typeorm-tracking.repository.ts`                        | Reject Other run creation/Refresh.                                                                |
| `test/e2e/manual-other.spec.ts`                                              | Staff/admin HTTP workflow, snapshots, attention, worker exclusion, validation and rollback guard. |
| `test/e2e/carriers.spec.ts`                                                  | Include new migration and fourth seeded carrier.                                                  |
| `test/e2e/dashboard.spec.ts`                                                 | Expect additive Other count.                                                                      |
| `test/integration/dashboard-overview.spec.ts`                                | Expect additive Other count; preserve filter-specific changes.                                    |
| `test/integration/database.spec.ts`                                          | Migration list/count and rollback sequence.                                                       |
| `test/integration/database-tls.spec.ts`                                      | Updated applied migration count.                                                                  |
| `test/integration/schema.spec.ts`                                            | Expected Other seed and settings.                                                                 |
| `test/integration/tracking-projection-migration.spec.ts`                     | Undo new latest migration before older migration checks.                                          |
| `test/integration/amazon-api-mode-migration.spec.ts`                         | Same rollback ordering adjustment.                                                                |
| `test/integration/quote-execution.spec.ts`                                   | Same rollback ordering adjustment.                                                                |
| `test/integration/quote-persistence.spec.ts`                                 | Same rollback ordering adjustment.                                                                |
| `test/support/shipment-database.ts`                                          | Include manual carrier migration in disposable fixtures.                                          |
| `test/container/runtime.test.ts`                                             | Expected seeded carrier count in runtime container.                                               |
| `docs/v1/manual-other-carrier.md`                                            | Approved MON-V1-004 scope and acceptance contract.                                                |
| `docs/v1/README.md`                                                          | Link approved manual extension.                                                                   |
| `docs/v1/database-schema.md`                                                 | Explain migration and reuse of existing persistence.                                              |
| `docs/v1/frontend-handoff.md`                                                | Manual API/UI contract.                                                                           |
| `docs/v1/auth-api.md`                                                        | Staff/admin access and disabled-carrier behavior.                                                 |
| `docs/v1/implementation-summary/MON-V1-004-implementation-summary.md`        | Review and verification evidence.                                                                 |

Frontend file inventory and checks are in the sibling
`grd-dashboard-fe/docs/v1/implementation-summary/MON-V1-004-implementation-summary.md`.

## Verification

- `pnpm check`: passed formatting, lint, TypeScript, 372 unit tests and build.
- `pnpm exec vitest run --project e2e test/e2e/manual-other.spec.ts test/e2e/carriers.spec.ts`:
  24 passed against disposable PostgreSQL.
- `pnpm build` followed by `pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/other-backend-coverage-verified`:
  all 719 tests across 95 files passed, exit 0. Whole-backend coverage: statements
  89.34%, branches 79.58%, functions 92.63%, lines 90.91%. This is the complete
  configured unit/integration/HTTP suite, not unit-only coverage. An isolated report
  directory avoided a stale lock from a sandbox-restricted attempt.
- Earlier combined attempts exposed stale migration/carrier-count fixtures (fixed)
  and one UPS worker timing failure under forced file parallelism. The final run
  used the configured sequential integration/HTTP execution and passed unchanged
  UPS tests. Local socket/Chromium/PostgreSQL checks required authorized execution
  outside the restricted sandbox. Existing pg concurrent-query deprecation warnings
  remain; they did not fail verification.
- `pnpm test:container`: all 6 passed, including image build, health, non-root
  Chromium, worker startup/stop, full migration rollback/reapply. Disposable only.
- Frontend `pnpm check`: passed formatting, lint, TypeScript, Knip and 263 tests.
  `pnpm build`: passed; existing non-blocking bundle-size warning remains.
- Frontend `pnpm exec playwright test e2e/shipments.spec.ts e2e/create-shipments.spec.ts e2e/shipment-detail.spec.ts e2e/shipment-history.spec.ts e2e/carriers.spec.ts e2e/overview.spec.ts --workers=3`:
  all 86 desktop/mobile regressions passed.
- Frontend `pnpm exec playwright test --config /tmp/other-live.config.cjs --repeat-each=2`:
  all 4 real-API desktop/mobile cases passed. Temporary config reuses local
  fixture servers; retained test is `e2e-backend/manual-other.spec.ts` and also
  fits the repository's backend browser harness. A final run after the Add form
  reset correction passed both desktop/mobile cases (2/2). Verified creation, date/status
  persistence, cleared Add form dates/default status, delivered attention, no automated actions, admin disable,
  subsequent staff edits and no horizontal overflow. Screenshots inspected.
- Final diff review separates FILTER-V1-001 and unrelated files. No staging,
  commits, deployment, production writes or real carrier credentials used.

## Review Notes

The approved approach reuses installed MUI, React Hook Form, Zod, TypeORM,
PostgreSQL transactions and existing New York date handling. Status transitions,
manual-carrier exclusions and projections are scoped business rules; no custom
replacement for reusable library functionality or new dependency was introduced.

Apply the seed migration with coordinated backend/frontend releases. Other's
polling columns retain required legacy defaults but are unused and hidden from
settings. Do not roll the seed back after manual records exist: its rollback
intentionally fails rather than deleting shipment data. Disable Other instead.
Manual status changes update the existing snapshot/history model; history keeps
prior status/date values and shipment-level audit fields identify the latest editor.

The earlier multi-rep filter changes are separate approved work. Unrelated
frontend `e2e-backend/tracking-review.spec.ts` and ingredient-sourcing documents,
PDFs and assets are excluded. Baseline diffs captured in `/tmp/other-*-baseline.diff`
allow separating overlapping filter/manual hunks. No unrelated files were edited.

## Remaining Issues

No feature blockers. No deployment or live-provider verification was requested.
Existing non-blocking pg deprecation and frontend bundle-size warnings remain.
Local fixture API has the tracking worker disabled.

Manual testing servers remain available:

- Frontend: `http://localhost:4176/shipments?tab=other`
- Backend: `http://localhost:3019/api/v1/health/live`
- Staff: `frontend-staff@example.test` / `staff fixture password`.
- Admin: `frontend-admin@example.test` / `admin fixture password`.

These are disposable local fixture accounts, not production credentials.

## Suggested Review Order

Approved spec → migration/manual transaction and validation → scheduler exclusions
and tab/count predicates → frontend conditional forms/admin toggle → acceptance tests.

Proposed separate commit after FILTER-V1-001:
`feat(shipments): MON-V1-004 add manual Other carrier monitoring`.

Scope is exactly the backend files above and Other-specific hunks in shared files.
Explicit final approval is required before staging or committing.
