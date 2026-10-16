# BE-V1-004 Upcoming deliveries restoration

## Summary

Restored the Upcoming deliveries read model and matching search filters following
the explicit frontend interview approval on 2026-10-17. The existing Carrier API
was verified for FE-V1-013 without changing its behavior. No production package,
schema migration, worker change, hosting action or deployment was added.

## Changes Made

- Overview returns `upcomingWindow` and `upcomingDeliveries` alongside its existing
  counts and attention panel, using one PostgreSQL statement snapshot.
- The fixed `asOf` instant supplies New York today through day +6 inclusive.
  Qualifying records are nondeleted/non-completed Shipments with a current ETA
  inside that range, including disabled Carriers. Null ETAs are excluded.
- Full totals accompany five preview rows ordered by ETA, creation and internal
  identity ascending. Both panels share the bounded public projection expansion.
- Search accepts inclusive `estimatedDeliveryFrom`/`estimatedDeliveryTo` dates and
  `undeliveredOnly=true|false`, before pagination/counts. Invalid dates, year zero,
  reversed bounds, malformed booleans and unknown fields are rejected.

## Files Changed

| File                                                               | Purpose                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/modules/dashboard/dashboard.schemas.ts`                       | Public upcoming window/panel response validation.                                               |
| `src/modules/dashboard/typeorm-dashboard.repository.ts`            | Fixed New York date window, full upcoming total, five-row preview and shared projection.        |
| `src/modules/shipments/shipments.schemas.ts`                       | Strict restored search query fields.                                                            |
| `src/modules/shipments/typeorm-shipment-search.ts`                 | Parameterized ETA and undelivered predicates.                                                   |
| `src/modules/shipments/shipments.service.spec.ts`                  | Invalid date/range/boolean cases replacing old removed-field assertions.                        |
| `test/integration/dashboard-overview.spec.ts`                      | Upcoming membership/search parity, DST dates, caps, totals and populated query-plan assertions. |
| `test/e2e/dashboard.spec.ts`                                       | Updated authenticated HTTP response contract.                                                   |
| `docs/v1/frontend-handoff.md`                                      | Exact restored payload/filter semantics and navigation mapping.                                 |
| `docs/v1/database-schema.md`                                       | Current two-panel, five-row read-query documentation; no schema migration.                      |
| `docs/v1/implementation-summary/BE-V1-004-upcoming-restoration.md` | This implementation/verification handoff.                                                       |

The initial backend worktree contained only unrelated untracked `sample.txt`.
It remains untouched. Changes are uncommitted on the existing `master` branch;
no branch, history, merge or tag operation was performed.

## Verification

| Exact command / check                                                                                                                                                                                | Result                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                                                                                                                                         | Passed Prettier, Oxlint, TypeScript, 264 unit tests and Nest build.                                                                                                                                                                     |
| `pnpm exec vitest run --project integration test/integration/dashboard-overview.spec.ts test/integration/shipment-search.spec.ts --project e2e test/e2e/dashboard.spec.ts test/e2e/carriers.spec.ts` | Passed 35 tests across four files, using disposable PostgreSQL and real HTTP policy checks.                                                                                                                                             |
| Frontend: `pnpm run ci`                                                                                                                                                                              | Passed format/lint/Knip, coverage, types/build, 174 unit tests and 126 Chromium desktop/mobile cases.                                                                                                                                   |
| Frontend: `pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/carriers.spec.ts e2e-backend/overview.spec.ts`                                                                | Passed four real API/cookie/PostgreSQL cases, through preview/direct API and mobile development proxy. Includes carrier field/mode/range/null validation, Staff restrictions, disabled creation/refresh and Upcoming drill-down parity. |
| `git diff --check`                                                                                                                                                                                   | Passed; final diff reviewed against the current source and contracts.                                                                                                                                                                   |
| Local reachability                                                                                                                                                                                   | `http://localhost:3000/api/v1/health/ready` reports application/database up. Frontend `http://localhost:5173` returns 200 and its `/api/v1/health/live` proxy returns ok.                                                               |

PostgreSQL cases cover both DST boundary dates, inclusive ETA bounds,
disabled/deleted/completed/null records, full totals and five-row caps. The populated
10,000-shipment plan remains one statement and meets its existing two-second test bound.
The broader all-backend integration/container/release suites were not run: this change
does not modify migrations, runtime packaging or carrier execution. Hosted CI,
production origins and live carrier services remain unverified/deferred.

## Review Notes

The backend addition should precede deployment of the new frontend, which requires
these fields. Search's equal-ETA tie-breaker uses identity; the Overview uses creation
and identity, so matching totals/membership does not promise the same first five ties.
The selected window is a calendar range, not an exact delivery/scheduling promise.
Recent tracking changes remains absent.

The frontend's isolated harness (`node scripts/auth-backend.mjs`) is left running
on port 3000 with a disposable PostgreSQL database and no worker. The existing
frontend remains on port 5173. Stopping the harness removes its test database;
no developer or production database was reset.

## Remaining Issues

No functional acceptance blocker. Explicit commit approval is pending; hosting,
production rollout, live provider checks and remote CI remain deferred.

## Suggested Review Order

1. Dashboard/search schemas and query implementations.
2. PostgreSQL membership/date/cap tests and HTTP contract assertions.
3. Frontend handoff and database read-query documentation.

Proposed commit: `feat(dashboard): BE-V1-004 restore upcoming delivery aggregates`.
Include exactly the ten files in this manifest; exclude `sample.txt`. The frontend
Overview restoration and carrier administration are separate proposed commits.
Nothing has been staged or committed.
