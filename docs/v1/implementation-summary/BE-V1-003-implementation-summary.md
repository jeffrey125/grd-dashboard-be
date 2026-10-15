# BE-V1-003 implementation summary

## Summary

Implemented authenticated normalized Shipment tracking history at
`GET /shipments/:externalId/history`. The endpoint returns deterministic,
paginated public Tracking Snapshots for one nondeleted Shipment, with existence,
total and page data from one PostgreSQL statement snapshot. All acceptance
criteria and final checks pass. Backend baseline:
`ecb9e23dc554cc6387ad421b43a248a3f37974b4`. No deployment, frontend feature or
live Carrier call was performed.

## Changes Made

- Reused the installed NestJS, Zod, TypeORM, PostgreSQL, Vitest, Supertest and
  Testcontainers stack. No dependency, lockfile or database schema change was
  needed.
- Added strict `page`/`pageSize` validation with page 1 and 25-row defaults,
  25/50/100 allowed sizes, unknown-field rejection and safe-offset enforcement.
- Added a feature-owned repository contract and one parameterized PostgreSQL
  statement for nondeleted Shipment existence, total and page items. History is
  ownership-scoped and ordered by `observed_at DESC, id DESC`.
- Reused the shared public Tracking Snapshot schema. Responses expose immutable
  public UUIDs, normalized status/date fields and observation time while omitting
  internal IDs, attempts, source data and diagnostics.
- Added the authenticated no-store HTTP route. Missing or soft-deleted Shipments
  return 404; known Shipments without snapshots return an empty page.
- Verified real tracking behavior: the initial and changed normalized observations
  appear, while unchanged successes and later failed lookups neither fabricate nor
  erase history.
- Updated backend API/schema/release handoffs and frontend planning documentation
  to mark BE-V1-003 implemented and leave only BE-V1-004–005 proposed.

## Files Changed

### Backend implementation and tests

| File                                                    | Purpose                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/modules/shipments/shipments.schemas.ts`            | Strict history query and response schemas.                          |
| `src/modules/shipments/shipments.repository.ts`         | Feature-owned history contract and inferred response type.          |
| `src/modules/shipments/shipments.service.ts`            | UUID/query parsing and missing-Shipment mapping.                    |
| `src/modules/shipments/shipments.controller.ts`         | Authenticated no-store history route.                               |
| `src/modules/shipments/typeorm-shipment-history.ts`     | Ownership-scoped single-statement PostgreSQL history read.          |
| `src/modules/shipments/typeorm-shipments.repository.ts` | TypeORM adapter integration for the history contract.               |
| `src/modules/shipments/shipments.service.spec.ts`       | Defaults, strict validation and 404 unit coverage.                  |
| `test/integration/shipment-history.spec.ts`             | Real lifecycle, ownership, deletion and stable pagination evidence. |
| `test/e2e/shipments.spec.ts`                            | Authorization, serialization, validation and HTTP 404 behavior.     |

### Documentation and frontend handoff

| File                                                                 | Purpose                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `docs/v1/auth-api.md`                                                | Include history in the protected Shipment surface.                  |
| `docs/v1/database-schema.md`                                         | Record query design, existing-index fit and no-migration rationale. |
| `docs/v1/frontend-handoff.md`                                        | Exact history request, response and semantic boundaries.            |
| `docs/v1/release-readiness.md`                                       | Reconcile implemented search/history with remaining API gaps.       |
| `docs/v1/implementation-summary/BE-V1-003-implementation-summary.md` | Implementation, verification and review handoff.                    |
| Frontend `docs/v1/api-contracts.md`                                  | Mark the verified history contract implemented.                     |
| Frontend `docs/v1/README.md`                                         | Reconcile the remaining backend prerequisite list.                  |
| Frontend `docs/v1/tickets/BE-V1-003-tracking-history.md`             | Record implemented status, dependency choice and evidence link.     |
| Frontend `docs/v1/tickets/README.md`                                 | Add BE-V1-003 to the locally verified ticket index.                 |

## Verification

| Exact command/check                                                                                                   | Result                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit src/modules/shipments/shipments.service.spec.ts`                                 | TDD red confirmed the missing service method; final pass: 57 tests.                                                        |
| `pnpm exec vitest run --project integration test/integration/shipment-history.spec.ts --reporter=verbose`             | TDD red confirmed the missing repository method; final pass: 3 tests against disposable PostgreSQL.                        |
| `pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts -t 'serves authenticated normalized Shipment history'` | TDD red returned 404 before route registration; final pass after implementation.                                           |
| `pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts --reporter=verbose`                                    | Passed all 17 Shipment HTTP tests.                                                                                         |
| `pnpm check`                                                                                                          | Passed Prettier, Oxlint with zero warnings, TypeScript, 256 unit tests in 25 files and Nest build.                         |
| `pnpm exec vitest run --project integration --maxWorkers=1 --reporter=verbose`                                        | Passed 157 tests in 24 files against disposable PostgreSQL.                                                                |
| `pnpm test:e2e`                                                                                                       | Passed 48 tests in 6 files.                                                                                                |
| `pnpm test:cov:all`                                                                                                   | Passed 461 tests in 55 files. Combined V8 coverage: 90.92% statements, 82.50% branches, 91.61% functions and 92.33% lines. |
| Independent standards/specification reviews                                                                           | Zero actionable findings on both axes.                                                                                     |

The pre-existing non-failing pg concurrent-query deprecation warning appears
during schema introspection. Container/release checks were not run because this
ticket changes no migration, container, runtime composition or release
configuration. No frontend application test/build, remote CI, production database,
live Carrier call or deployment was run. All database verification used disposable
PostgreSQL.

## Review Notes

- Offset pagination matches the approved contract. The internal identity
  tie-breaker makes equal observation times deterministic for an unchanged data
  set; separate page requests remain live reads and can shift when history grows.
- The existing `ix_snapshots_history` index exactly matches Shipment ownership and
  the required ordering, so another index would only add write/storage cost.
- One SQL response envelope distinguishes missing/deleted Shipments from known
  Shipments with no snapshots and preserves consistent existence, total and items.
- The endpoint intentionally reads normalized snapshot rows directly. It does not
  join attempts because failed, not-found, skipped and unchanged lookups are not
  history entries.
- Pre-existing backend `sample.txt` and frontend
  `docs/v1/tickets/FE-V1-002-quality-and-ci.md` remain untouched and excluded.

## Remaining Issues

None within BE-V1-003. BE-V1-004–005 and deployment remain separate work.

## Suggested Review Order

1. History schemas and service/controller contract.
2. PostgreSQL history implementation and integration tests.
3. HTTP coverage, backend handoffs, this summary and frontend planning updates.
