# MON-V1-004: delivered manual shipments tab correction

## Summary

Completed Other shipments now belong to Delivered rather than Other. Reopening
returns them to Other. Help is the last navigation menu for Staff and Admin.

## Changes Made

Reuse the existing TypeORM/PostgreSQL filtering, approved by the user. Share the
Other predicate between search results, tab counts and dashboard counts. Preserve
due follow-up visibility in Needs attention. Navigate to Delivered when an Other
shipment is created or found already completed. No migration or dependency added.
Use the existing approved MUI navigation components to move Help after Admin menus.

## Files Changed

Backend:

- `src/modules/shipments/shipment-read-predicates.ts`: classify completed manual records.
- `src/modules/shipments/typeorm-shipment-search.ts`: use the shared Other count rule.
- `src/modules/dashboard/typeorm-dashboard.repository.ts`: align overview counts.
- `test/e2e/manual-other.spec.ts`: delivery/reopening HTTP and count assertions.
- `docs/v1/manual-other-carrier.md`: update list and creation contract.
- `docs/v1/frontend-handoff.md`: update client-facing tab behavior.
- `docs/v1/implementation-summary/MON-V1-004-delivered-tab-fix.md`: this handoff.

Frontend:

- `src/features/shipments/pages/shipments-page.tsx`: completed Other creation destination.
- `e2e-backend/manual-other.spec.ts`: desktop/mobile delivery and reopening regression.
- `src/features/help/content.ts`: explain Other-to-Delivered behavior in pending Help work.
- `src/components/layout/app-shell.tsx`: move pending Help menu below administration.

## Verification

- `pnpm build` (backend): passed.
- `pnpm typecheck` (backend): passed.
- `pnpm lint` (backend): passed.
- `pnpm exec vitest run --project unit`: 383 passed after allowing local port access;
  sandbox-only run had three notification tests blocked by listen EPERM.
- `pnpm exec vitest run --project e2e test/e2e/manual-other.spec.ts -t 'lets Staff'`:
  passed, one unrelated migration rollback test excluded. The new delivery assertion
  failed before the filter fix and passed afterward.
- `FE_TEST_API_PORT=3013 pnpm exec playwright test --config playwright.backend.config.ts manual-other.spec.ts`
  (frontend): 2 passed, desktop and mobile against the real isolated backend.
- `pnpm exec tsc --noEmit` and `pnpm exec tsc --noEmit -p tsconfig.e2e.json`
  (frontend): passed.
- Scoped frontend `pnpm exec biome check --write` checks: passed.
- `pnpm exec playwright test e2e/help.spec.ts --workers=2`: 8 passed.
- Backend changed files formatted with Prettier; final diff whitespace checks passed.
- Updated manual servers: http://localhost:4176 and http://localhost:3013/api/v1;
  HTTP 200 and health status ok verified. Disposable database, workers disabled.
- Full integration/acceptance and frontend production build not run for this fix.

## Review Notes

No stored records need changing. Automated-carrier tab semantics remain unchanged.
Needs attention can overlap Delivered when follow-up is due. Existing Help work,
Help design decisions and `e2e-backend/tracking-review.spec.ts` were already pending;
keep them separate from the shipment fix when staging.

## Remaining Issues

The pre-existing migration rollback test assumes the manual-carrier migration is
last; newer migrations make its expected rejection fail. Left unchanged and
excluded from the focused workflow run. Not committed or deployed.

## Suggested Review Order

Shared predicates, count queries, HTTP/browser regression, frontend destination,
contract docs, pending Help navigation and wording.

Proposed commits, subject to explicit approval:

- Backend: `fix(shipments): MON-V1-004 move delivered Other shipments to Delivered`
  Includes the seven backend files above.
- Frontend: `fix(shipments): MON-V1-004 route completed Other shipments to Delivered`
  Includes shipment page and manual-other browser test only.
- Keep Help menu placement and wording with the separately pending
  `feat(help): HELP-V1-001 add categorized guides with annotated screenshots` commit;
  do not stage only fragments that depend on the uncommitted Help feature.
