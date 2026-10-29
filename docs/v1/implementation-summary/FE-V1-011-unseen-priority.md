# FE-V1-011: temporary priority for unseen tracking updates

## Summary

Monitoring temporarily puts shipments with unacknowledged tracking updates before
other results. Acknowledging them restores their normal position. The default
Created descending and any user-selected sort remain unchanged.

## Changes Made

Reuse existing account/browser review state, TanStack Query, Zod and TypeORM/SQL,
as approved. Search query keys include unseen shipment IDs. A read-only POST
search accepts a bounded review list in JSON; SQL applies priority before
pagination while retaining filters, scope, counts and normal sorting within both
groups. Acknowledgment changes the query key and refetches the appropriate page.
Help guidance is updated under the user's implementation approval.

## Files Changed

Backend:

- `src/modules/shipments/shipments.controller.ts`: authenticated POST search.
- `src/modules/shipments/shipments.schemas.ts`: bounded, validated priority IDs.
- `src/modules/shipments/typeorm-shipment-search.ts`: priority before normal sort.
- `src/runtime/api-routing.ts`: 512 KiB JSON parser bound for 10,000 review IDs.
- `test/e2e/shipments.spec.ts`: cross-page priority, restoration, filters, counts,
  direction, authorization and full-size/invalid review-list cases.
- `docs/v1/frontend-handoff.md`: request, ordering and pagination contract.
- `docs/v1/auth-api.md`: trusted-Origin and session requirements for POST search.
- `docs/v1/implementation-summary/FE-V1-011-unseen-priority.md`: this handoff.

Frontend:

- `src/features/shipments/api.ts`: POST body transport when review IDs are present;
  GET otherwise, preserving existing query value types.
- `src/features/shipments/pages/shipments-page.tsx`: review-aware query key and search.
- `src/features/help/content.ts`: explain temporary priority and acknowledgment.
- `e2e/tracking-review.spec.ts`: POST-aware fixtures, page-two promotion/reload/
  acknowledgment coverage and scrolling to the virtualized Actions test control.
- `docs/v1/ui-spec.md`: approved ordering and review behavior.

## Verification

- Backend `pnpm build`, `pnpm typecheck`, `pnpm lint`: passed.
- Backend `pnpm exec vitest run --project unit`: 383 passed.
- Backend `pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts`: 17 passed
  against disposable PostgreSQL, including a 10,000-entry JSON payload.
- Frontend `pnpm build`: passed including application, Node and e2e typechecks;
  existing large-chunk advisory remains.
- Frontend `pnpm exec vitest run`: 267 passed.
- Frontend `pnpm exec playwright test e2e/tracking-review.spec.ts e2e/help.spec.ts --workers=2`:
  29 passed, 3 failed due to test selectors (wrong acknowledgment label and
  unscrolled virtualized Actions column). Selectors corrected.
- Frontend `pnpm exec playwright test e2e/tracking-review.spec.ts --grep 'clicking anywhere|unseen off-page' --workers=2`:
  all 4 desktop/mobile cases passed after corrections. Unaffected passing tests
  were not repeated.
- Scoped Biome checks, backend Prettier and both diff whitespace checks passed.
- Help screenshot controls/markers are unchanged; existing images retained.
- Full acceptance/container suites and production verification not run.

## Review Notes

Review state stays per account/browser with existing cross-tab synchronization;
there is no shared or cross-device acknowledgment. Only tracking changes already
producing unseen markers gain priority. Offline/missed events retain the existing
no-replay limitation. Current page is retained, with priority records occupying
the earliest pages; the selected sort is used within each group. POST search is
read-only but retains trusted-Origin enforcement. JSON parsing uses a global
512 KiB limit; the priority array itself is limited to 10,000 UUIDs. No database
migration or new dependency is needed. Release backend before frontend.

The pre-existing frontend `e2e-backend/tracking-review.spec.ts` edit is unrelated
and remains untouched/uncommitted.

## Remaining Issues

Not committed or deployed. No known implementation blocker.

## Suggested Review Order

Schema and SQL ordering, API route/parser bound, frontend request/query state,
HTTP/browser tests, Help and contracts.

Proposed single-purpose commits (explicit final approval required):

- Backend files above: `feat(shipments): FE-V1-011 prioritize unseen tracking updates`
- Frontend files above: `feat(shipments): FE-V1-011 restore normal ordering after acknowledgment`
