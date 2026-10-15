# BE-V1-004 implementation summary

## Summary

Implemented the authenticated operational overview at `GET /dashboard/overview`.
The endpoint returns current Shipment state counts, bounded attention and upcoming
delivery panels with full totals, and recent normalized tracking changes. The
entire envelope comes from one PostgreSQL statement snapshot and uses a fixed
`asOf` instant for its `America/New_York` business-date window. Backend baseline:
`801e3466ab6dc64896e141037da0296942c99b2c`. No deployment, frontend feature, live
Carrier call, production dependency, or database migration was performed.

## Changes Made

- Added a dedicated Dashboard module with a Staff/Admin, no-store overview route,
  feature-owned repository contract, response schema, service, and TypeORM adapter.
- Added one parameterized PostgreSQL statement for counts, full panel totals,
  at-most-10 panel rows, and recent changes. A single statement prevents cards and
  panels from observing different worker commits.
- Extracted and reused the Shipment tab predicates and safe Shipment JSON/parser
  projection. Dashboard counts and attention now share the exact search semantics.
- Defined upcoming as non-completed Shipments with current ETA from New York today
  through day +6 inclusive. Results order by ETA, creation time, and a server-only
  identity. Null ETAs and completed Shipments are excluded.
- Defined recent changes as the 10 newest persisted normalized snapshots for
  nondeleted Shipments. First observations are included; unchanged and unsuccessful
  lookups do not create snapshot rows.
- Preserved disabled-Carrier Shipments in all relevant results and excluded
  soft-deleted Shipments. Public payloads reuse the safe Shipment and Tracking
  Snapshot projections and omit internal identities and provider diagnostics.
- Updated backend API/auth/database/release documentation and the frontend API
  contract, ticket status, prerequisite summary, and ticket index.

## Files Changed

### Backend implementation and tests

| File/group                                          | Purpose                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/modules/dashboard/*`                           | Dashboard HTTP boundary, schema, service, repository contract, and one-statement PostgreSQL implementation.         |
| `src/app.module.ts`                                 | Registers the Dashboard module in the API application.                                                              |
| `src/modules/shipments/shipment-read-predicates.ts` | Shared state and attention predicates used by search and overview.                                                  |
| `src/modules/shipments/typeorm-shipment-record.ts`  | Shared safe Shipment JSON projection and runtime record parser.                                                     |
| `src/modules/shipments/typeorm-shipment-search.ts`  | Reuses the shared predicates and projection without changing the search contract.                                   |
| `src/modules/shipments/shipments.schemas.ts`        | Exposes the shared five-count response schema.                                                                      |
| `test/integration/dashboard-overview.spec.ts`       | Real PostgreSQL coverage for business dates, search parity, panels, consistency, and populated 10,000-row planning. |
| `test/e2e/dashboard.spec.ts`                        | Staff/Admin policy, anonymous denial, no-store, serialization, and safe projection coverage.                        |

### Documentation and frontend handoff

| File/group                                                           | Purpose                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `docs/v1/auth-api.md`                                                | Adds the overview to the unrestricted Staff/Admin surface.                               |
| `docs/v1/database-schema.md`                                         | Documents the one-statement read design, existing-index fit, and no-migration rationale. |
| `docs/v1/frontend-handoff.md`                                        | Defines the exact response, semantics, ordering, caps, drill-down, and cache behavior.   |
| `docs/v1/release-readiness.md`                                       | Reconciles overview availability with the remaining API gaps.                            |
| `docs/v1/implementation-summary/BE-V1-004-implementation-summary.md` | Records implementation, verification, and review handoff.                                |
| Frontend `docs/v1/api-contracts.md`                                  | Marks the verified overview contract implemented.                                        |
| Frontend `docs/v1/README.md` and `docs/v1/tickets/*`                 | Reconciles prerequisite and ticket status with backend reality.                          |

## Verification

| Exact command/check                                                                                                                                                                                                                | Result                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run --project integration test/integration/dashboard-overview.spec.ts --reporter=verbose`                                                                                                                        | Passed 8 tests against disposable PostgreSQL: spring/fall business-date boundaries, empty data, attention/upcoming search parity, disabled/deleted/null handling, panel order/caps, uncommitted writes, and a populated 10,000-row one-statement plan. |
| `pnpm exec vitest run --project e2e test/e2e/dashboard.spec.ts --reporter=verbose`                                                                                                                                                 | Passed the Staff/Admin, anonymous denial, no-store, response serialization, and safe-field HTTP test.                                                                                                                                                  |
| `pnpm check`                                                                                                                                                                                                                       | Passed Prettier, Oxlint with zero warnings, TypeScript, 256 unit tests in 25 files, and Nest build. The first sandboxed attempt reached 253 passes before three test-only localhost listeners received `EPERM`; the permitted rerun passed.            |
| `pnpm exec vitest run --project integration --maxWorkers=1 --reporter=verbose`                                                                                                                                                     | Passed 165 tests in 25 files against disposable PostgreSQL and local Carrier fixtures.                                                                                                                                                                 |
| `pnpm test:e2e`                                                                                                                                                                                                                    | Passed 49 tests in 7 files.                                                                                                                                                                                                                            |
| `pnpm test:cov:all`                                                                                                                                                                                                                | Passed 470 tests in 57 files. Combined V8 coverage: 91.01% statements, 82.51% branches, 91.75% functions, and 92.40% lines.                                                                                                                            |
| `pnpm exec prettier --check ../grd-dashboard-fe/docs/v1/api-contracts.md ../grd-dashboard-fe/docs/v1/README.md ../grd-dashboard-fe/docs/v1/tickets/BE-V1-004-overview-aggregates.md ../grd-dashboard-fe/docs/v1/tickets/README.md` | Passed changed frontend planning-document formatting.                                                                                                                                                                                                  |
| `git diff --check`                                                                                                                                                                                                                 | Passed before the final review.                                                                                                                                                                                                                        |
| Independent standards/specification reviews                                                                                                                                                                                        | Initial reviews found missing upcoming drill-down parity and an unpopulated scale fixture. Both were corrected with direct search comparison and 10,000 snapshots/completed attempts; focused re-review found no remaining findings.                   |

The pre-existing non-failing pg concurrent-query deprecation warning appeared
during schema introspection. Container/release checks were not run because this
ticket changes no migration, container, runtime composition, or release
configuration. No frontend application test/build, remote CI, production database,
live Carrier call, or deployment was run. All database verification used disposable
PostgreSQL.

An additional broad `pnpm exec prettier --check ../grd-dashboard-fe/docs/v1`
check reported the pre-existing
`docs/v1/implementation-summary/FE-V1-001-implementation-summary.md` formatting
issue. The focused check over all four frontend files changed by BE-V1-004 passes;
the unrelated FE-V1-001 summary was not modified.

## Review Notes

- The dashboard deliberately has no independent copy of state or attention rules;
  search and overview interpolate the same allowlisted SQL predicate constants.
- The materialized base set performs the latest completed lookup needed by
  attention once per nondeleted Shipment. Full latest-run expansion is deferred
  until after the two 10-row panel limits.
- `asOf` is captured once by the repository and passed into PostgreSQL. The
  response window and all rows use that value rather than independent wall-clock
  calls, including across daylight-saving transitions.
- The existing indexes support current-snapshot, completed-attempt, run-membership,
  and snapshot-history reads. The populated 10,000-row plan exercises all panels,
  including latest-run expansion and global recent-snapshot ordering. The required
  aggregate scan still covers the nondeleted set, so an additional index did not
  improve the accepted shape enough to justify migration and write cost.
- Attention and upcoming panel totals match their search drill-down predicates.
  The panels remain bounded previews; the search endpoint remains the complete
  paginated destination.
- Pre-existing backend `sample.txt` and frontend
  `docs/v1/tickets/FE-V1-002-quality-and-ci.md` remain untouched and excluded.

## Remaining Issues

None within BE-V1-004. BE-V1-005 and deployment remain separate work.

## Suggested Review Order

1. Shared Shipment predicates/projection and the Dashboard response schema.
2. Dashboard PostgreSQL statement and its integration coverage.
3. Controller/module wiring and HTTP policy test.
4. Backend handoffs, this summary, and frontend planning updates.
