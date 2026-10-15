# BE-V1-002 implementation summary

## Summary

Implemented authenticated whole-dataset Shipment search at
`GET /shipments/search` while preserving the legacy unpaginated
`GET /shipments` response. The endpoint provides strict filtering, stable offset
pagination, deterministic sorting, full-result totals and overlapping tab counts
from one PostgreSQL statement snapshot. All acceptance criteria and final checks
pass. Backend baseline: `b74ae0c1171ff59846c3ed8bc6c7c9863ed03fcd`.
No deployment, frontend feature or live Carrier call was performed.

## Changes Made

- Reused the installed NestJS, Zod, TypeORM, PostgreSQL, Vitest, Supertest and
  Testcontainers stack. No dependency, lockfile or database schema change was
  needed.
- Added a strict query contract for tabs, literal reference/note search, Carrier,
  latest completed lookup outcome, New York creation dates, date-only ETA,
  undelivered filtering, page size and allowlisted sorting. Invalid dates,
  reversed ranges, unknown fields, unsafe offsets and malformed values return 400.
- Added one parameterized PostgreSQL query with materialized filtered and selected
  sets. Items, selected-tab total and all tab counts share one statement snapshot;
  non-tab filters run before tab selection and pagination.
- Kept nullable sorts last in both directions and used the internal Shipment ID
  only as a deterministic tie-breaker. Public responses continue to expose only
  the established Shipment projection.
- Defined Attention as non-completed with either a failed latest completed lookup
  or threshold pause. Pending-only Shipments are `never_checked`, and disabled
  Carriers do not change Shipment tab membership.
- Registered the static search route before the UUID detail route, retained
  unrestricted Staff/Admin authorization and `Cache-Control: no-store`, and kept
  the legacy list behavior unchanged.
- Updated backend API/schema handoffs and frontend planning documentation to match
  the implemented response and mark only BE-V1-003 through BE-V1-005 as proposed.

## Files Changed

### Backend implementation and tests

| File                                                    | Purpose                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/modules/shipments/shipments.schemas.ts`            | Strict query and response schemas, defaults and cross-field checks.   |
| `src/modules/shipments/shipments.repository.ts`         | Feature-owned search contract and inferred response type.             |
| `src/modules/shipments/shipments.service.ts`            | Query parsing and repository delegation.                              |
| `src/modules/shipments/shipments.controller.ts`         | Authenticated static search route with no-store response handling.    |
| `src/modules/shipments/typeorm-shipment-search.ts`      | Parameterized single-statement search, counts, ordering and mapping.  |
| `src/modules/shipments/typeorm-shipments.repository.ts` | TypeORM adapter integration for the feature-owned contract.           |
| `src/modules/shipments/shipments.service.spec.ts`       | Query defaults and strict validation unit coverage.                   |
| `test/integration/shipment-search.spec.ts`              | Real PostgreSQL filtering, sorting, snapshot and 10,000-row evidence. |
| `test/e2e/shipments.spec.ts`                            | Authorization, routing, validation and legacy compatibility.          |

### Documentation and frontend handoff

| File                                                                 | Purpose                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `docs/v1/auth-api.md`                                                | Include search in the protected Shipment surface.                    |
| `docs/v1/database-schema.md`                                         | Record query design, measured plan and no-migration rationale.       |
| `docs/v1/frontend-handoff.md`                                        | Exact request, response, tabs, dates, sorting and consistency rules. |
| `docs/v1/implementation-summary/BE-V1-002-implementation-summary.md` | Implementation, verification and review handoff.                     |
| Frontend `docs/v1/api-contracts.md`                                  | Mark the verified search contract implemented.                       |
| Frontend `docs/v1/README.md`                                         | Reconcile the remaining backend prerequisite list.                   |
| Frontend `docs/v1/tickets/BE-V1-002-shipment-search.md`              | Record implemented status, dependency decision and evidence link.    |
| Frontend `docs/v1/tickets/README.md`                                 | Add BE-V1-002 to the locally verified ticket index.                  |

## Verification

| Exact command/check                                                                                      | Result                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                                             | Final pass: Prettier, Oxlint with zero warnings, TypeScript, 247 unit tests in 25 files and Nest build.                                                                                                                                      |
| `pnpm exec vitest run --project integration test/integration/shipment-search.spec.ts --reporter=verbose` | Final pass: 7 tests against disposable PostgreSQL, including all public sorts, DST boundaries, a concurrent uncommitted update and a 10,000-row fixture.                                                                                     |
| `pnpm exec vitest run --project integration --maxWorkers=1 --reporter=verbose`                           | Passed 154 tests in 23 files against disposable PostgreSQL before the final predicate deduplication; the focused final suite above reverified the changed search query.                                                                      |
| `pnpm test:e2e`                                                                                          | Passed 47 tests in 6 files, including the authenticated static search route and legacy list compatibility.                                                                                                                                   |
| `pnpm test:cov:all`                                                                                      | Passed 448 tests in 54 files. Combined V8 coverage: 90.87% statements, 82.51% branches, 91.53% functions and 92.29% lines. This preceded the predicate-only deduplication, which the final focused integration suite and `pnpm check` cover. |
| `git diff --check`                                                                                       | Passed for the backend and the four scoped frontend planning files.                                                                                                                                                                          |
| Independent standards/specification reviews                                                              | No correctness or documented-rule findings remain. Shared tab predicates and frontend implemented-surface wording were corrected, then reverified.                                                                                           |

The first final rerun was blocked by sandbox access to Docker and localhost
(`Could not find a working container runtime strategy` and `listen EPERM`). The
same commands passed with the required local Docker/socket access; no test or
production behavior was weakened. PostgreSQL schema introspection emits the
pre-existing non-failing pg concurrent-query deprecation warning.

The warm `EXPLAIN (ANALYZE, BUFFERS)` measurement on PostgreSQL 18.3 used 10,000
matching active Shipments and returned a 100-row last page in 25.312 ms with
10,275 shared buffer hits. The bounded page-to-latest-run work covered only the
100 returned rows. This is local query-plan evidence rather than a production
latency guarantee, and it did not justify a new index or migration.

Container/release checks were not run because this ticket changes no migration,
container, runtime composition or release configuration. No frontend application
test/build, remote CI, production database, live Carrier call or deployment was
run. All database verification used disposable PostgreSQL.

## Review Notes

- Offset pagination matches the approved API contract. The total order prevents
  duplicate or skipped ties within an unchanged dataset; separate page requests
  remain live reads and can shift when rows change.
- `tabCounts` deliberately ignores only the selected tab while retaining every
  other filter. Attention overlaps Active/Paused rather than partitioning the
  result set.
- `createdFrom` and `createdTo` use inclusive `America/New_York` calendar days,
  including DST transitions. ETA filters use inclusive date-only comparisons and
  exclude null values naturally.
- Literal case-insensitive search uses `strpos(lower(...), lower($n))`, so `%`,
  `_` and `\\` are ordinary characters without escape rules.
- Pre-existing backend `sample.txt` and frontend
  `docs/v1/tickets/FE-V1-002-quality-and-ci.md` remain untouched and excluded.

## Remaining Issues

None within BE-V1-002. BE-V1-003 through BE-V1-005 and deployment remain separate
work.

## Suggested Review Order

1. Search schemas and service/controller contract.
2. PostgreSQL search implementation and integration tests.
3. HTTP coverage, backend handoffs, this summary and frontend planning updates.
