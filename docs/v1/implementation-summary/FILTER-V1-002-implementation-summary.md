# FILTER-V1-002 — Mine / Everyone monitoring scope

## Summary

Implemented a shared Mine/Everyone toggle on Overview and Shipments. Mine is the
default only when the signed-in account has no valid saved preference. The last
choice persists across navigation, reload, browser restart and sign-in via the
user-approved Zustand persist middleware and localStorage.

## Changes Made

- Filter by original creator, never last editor or assigned sales representative.
  Both staff and admins retain shared read/edit access. Null creators appear only
  in Everyone; duplicate creation retains original attribution.
- Search and overview accept optional `scope=mine|everyone`. Omission preserves
  Everyone for existing API clients. Mine uses the server session identity;
  caller-supplied creator IDs and invalid/repeated scope values are rejected.
- Filter before pagination, tab counts, overview totals and both panels. UI query
  keys include account and scope; old-scope rows are not shown as placeholders.
- Preserve other list filters when toggling; reset to page 1. Duplicate creation
  offers View existing monitoring, including when that row is outside Mine.
- Pin Zustand 5.0.16. Store only account UUID-to-scope preferences, validate with
  existing Zod, and fall back to shared in-memory state if storage is denied.
  No schema migration or new backend dependency is needed.

## Files Changed

Only this feature's additions relative to the saved starting worktree are listed.
Both repositories already contained unrelated manual-carrier, filter, tracking,
and documentation changes; those were preserved. Shared files must be staged by
reviewed hunks, not wholesale.

### Backend

| File                                                                     | Reason                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `docs/v1/frontend-handoff.md`                                            | Document scope semantics, API compatibility and browser preference behavior.                                                   |
| `src/modules/dashboard/dashboard.controller.ts`                          | Pass validated session identity and overview query to the service.                                                             |
| `src/modules/dashboard/dashboard.schemas.ts`                             | Validate optional mine/everyone scope and reject unsupported query fields.                                                     |
| `src/modules/dashboard/dashboard.service.ts`                             | Resolve Mine from the authenticated actor.                                                                                     |
| `src/modules/dashboard/dashboard.repository.ts`                          | Accept an optional creator filter in the repository contract.                                                                  |
| `src/modules/dashboard/typeorm-dashboard.repository.ts`                  | Filter the common base before counts and both panels.                                                                          |
| `src/modules/shipments/shipments.controller.ts`                          | Pass authenticated identity into search.                                                                                       |
| `src/modules/shipments/shipments.schemas.ts`                             | Accept optional mine/everyone search scope.                                                                                    |
| `src/modules/shipments/shipments.service.ts`                             | Resolve the creator filter from the authenticated actor.                                                                       |
| `src/modules/shipments/shipments.repository.ts`                          | Add the internal creator-filter argument.                                                                                      |
| `src/modules/shipments/typeorm-shipments.repository.ts`                  | Forward the creator filter to persistence.                                                                                     |
| `src/modules/shipments/typeorm-shipment-search.ts`                       | Apply a bound creator predicate before counts and pagination.                                                                  |
| `src/modules/shipments/shipments.service.spec.ts`                        | Update repository call assertions for the optional filter argument.                                                            |
| `test/e2e/dashboard.spec.ts`                                             | Verify two creators, null creators, counts, pagination, panels, shared edits, duplicates and invalid input against PostgreSQL. |
| `docs/v1/implementation-summary/FILTER-V1-002-implementation-summary.md` | This review and verification record.                                                                                           |

### Frontend

| File                                                                     | Reason                                                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                           | Pin user-approved Zustand 5.0.16.                                                                                            |
| `pnpm-lock.yaml`                                                         | Record the installed Zustand dependency.                                                                                     |
| `src/features/monitoring-scope/store.ts`                                 | Persist validated account-specific scope preferences with Zustand; tolerate unavailable storage.                             |
| `src/features/monitoring-scope/index.tsx`                                | Expose the shared scope hook and MUI toggle; rehydrate across views and storage events.                                      |
| `src/features/monitoring-scope/store.test.ts`                            | Verify account isolation, reload restoration, corruption and storage-denial handling.                                        |
| `src/features/shipments/api.ts`                                          | Send scope with search requests.                                                                                             |
| `src/features/shipments/pages/shipments-page.tsx`                        | Add toggle, isolate query caches, reset pagination, suppress cross-scope placeholders and open duplicate records directly.   |
| `src/features/overview/api.ts`                                           | Send scope with overview requests.                                                                                           |
| `src/features/overview/api.test.ts`                                      | Align the request assertion with the optional scope argument.                                                                |
| `src/features/overview/pages/overview-page.tsx`                          | Share the toggle and scope all overview data.                                                                                |
| `e2e/monitoring-scope.spec.ts`                                           | Desktop/mobile coverage for defaults, persisted preferences, account isolation, navigation, page reset and duplicate action. |
| `e2e-backend/monitoring-scope.spec.ts`                                   | Real auth/API/database browser coverage for creator filtering and account switching.                                         |
| `e2e-backend/overview.spec.ts`                                           | Explicitly select Everyone for the existing team-wide overview assertions.                                                   |
| `e2e/overview.spec.ts`                                                   | Match overview requests that now carry scope query parameters.                                                               |
| `e2e/live-fixture.ts`                                                    | Match scope-bearing overview requests in shared browser fixtures.                                                            |
| `e2e/frontend-telemetry.spec.ts`                                         | Match scope-bearing overview requests in telemetry fixtures.                                                                 |
| `docs/v1/api-contracts.md`                                               | Document scope request semantics and link the backend contract.                                                              |
| `docs/v1/architecture.md`                                                | Record Zustand preference ownership and cache isolation.                                                                     |
| `docs/v1/decisions.md`                                                   | Record the user-approved dependency, localStorage persistence and creator-based business rules.                              |
| `docs/v1/implementation-summary/FILTER-V1-002-implementation-summary.md` | Matching cross-repository review record.                                                                                     |

## Verification

- Backend `pnpm check`: PASS — formatting, lint, typecheck, 372 unit tests and build.
  Initial sandbox run could not bind notification-test sockets; rerun with local
  networking permission passed all tests.
- Backend `pnpm exec vitest run --project e2e test/e2e/dashboard.spec.ts`: PASS,
  2 authenticated PostgreSQL tests. The new fixture initially lacked its current
  snapshot pointer; corrected the fixture, then both tests passed.
- Backend `pnpm exec vitest run --project integration
test/integration/dashboard-overview.spec.ts test/integration/shipment-search.spec.ts`:
  both suites PASS, 15 tests, including 10,000-row overview coverage. Executed in
  the combined targeted invocation with the HTTP tests. Initial sandbox execution
  could not access Docker; disposable-container execution passed these suites.
- Frontend `pnpm check`: PASS — format, lint, typecheck, Knip and 267 unit tests.
- Frontend `pnpm build`: PASS. Existing chunk-size and router CLI circular-dependency
  warnings remain; no new type/build errors.
- Frontend `pnpm exec playwright test e2e/monitoring-scope.spec.ts
e2e/overview.spec.ts e2e/shipments.spec.ts --workers=2`: 24 existing shipment
  checks passed; overview checks passed after one transient mobile Retry-button
  detachment passed on isolated rerun. After the final scope additions, all
  8 overview checks and both strengthened desktop/mobile scope checks passed.
  The strengthened test initially used the wrong Back to results accessible name;
  corrected the test locator, then both projects passed.
- Real backend browser flow: `FE_TEST_API_PORT=3013 pnpm exec playwright test
--config /tmp/monitoring-playwright.config.mts`: PASS, 1 test against running
  Vite and disposable PostgreSQL-backed API. Config selects the committed
  `e2e-backend/monitoring-scope.spec.ts` test with baseURL `http://localhost:5173`;
  the same test is included by the standard backend Playwright configuration.
- Reviewed the feature-only baseline diffs; `git diff --check` passes in both
  repositories. Desktop/mobile screenshots confirm the toggle fits the layout.
- Frontend HTTP 200 at `http://localhost:5173/`; API liveness and readiness HTTP 200
  at `http://localhost:3013/api/v1/health/live` and `/health/ready`. Both servers
  remain running. API uses a disposable fixture DB; tracking worker is disabled.
  Fixture login: `frontend-staff@example.test` / `staff fixture password`.
- Full backend combined coverage, full integration/e2e suites, the complete
  frontend real-backend suite and container/release acceptance were not run.
  No runtime/container/deployment files changed and no provider calls were made.

## Review Notes

No custom replacement for reusable state, persistence, validation or UI libraries:
Zustand persist, React, MUI, TanStack Query/Router, Zod and existing TypeORM queries
cover those needs. The small storage exception adapter preserves in-memory
usability when browser storage is denied. Creator predicates and account-keyed
preferences are the approved business rules.

Saved preferences are per browser origin and account, not synchronized between
devices. Logout retains the non-sensitive preference; a different account reads
its own entry. Mine is a view filter, not an authorization boundary. Deploy the
backend scope support before the frontend that sends scope. No deployment is
included here.

## Remaining Issues

None in the implemented scope. Broader release acceptance and production rollout
remain unverified and were not requested. Existing unrelated working-tree changes
must remain outside these commits. No commit, push, tag or deployment was made.

At final inspection, the pre-existing FILTER-V1-001 and MON-V1-004 changes had
been committed independently during this session (backend HEAD `8ab54be`, frontend
HEAD `c49ace9`). This task created no commits. Unrelated ingredient-sourcing
artifacts remain untracked in the backend, and the pre-existing frontend
`e2e-backend/tracking-review.spec.ts` edit remains outside this scope.

## Suggested Review Order

1. Backend service identity resolution and SQL predicates, then HTTP regression.
2. Zustand store, scope hook, both pages and duplicate-record navigation.
3. Browser regressions, API contracts, lockfile and verification record.

### Proposed commits — approval required

1. Backend: `feat(monitoring): FILTER-V1-002 filter monitoring reads by creator`
   — backend files/hunks listed above, including their tests and documentation.
2. Frontend: `feat(monitoring): FILTER-V1-002 persist Mine and Everyone scope`
   — frontend files/hunks listed above, including Zustand dependency, tests and docs.

The final implementation approval did not authorize commits. Stage only these
feature hunks after explicit final approval, preserving pre-existing edits.
