# FILTER-V1-001 — Multiple Sales Rep filtering

## Summary

Implemented the approved multi-rep Shipment filter across backend and frontend.
FILTER-V1-001 identifies this conversation-approved change.

## Changes Made

- Search accepts `salesRepExternalIds`, a comma-separated string of UUIDv4 values
  and/or `unassigned`. Empty/omitted means any rep. Alternatives match with OR;
  other filters remain ANDed. Filtering precedes pagination and tab counts.
- The old singular search parameter is rejected. Assignment fields remain singular.
- Staff can read active/inactive filter options at `/api/v1/sales-reps/filter-options`;
  the response contains only externalId, firstName, lastName and active. Assignment
  options remain active-only, with inactive assignments rejected server-side.
- Frontend uses existing MUI Autocomplete, React Hook Form, Zod and TanStack Query;
  backend reuses Zod and the existing TypeORM/PostgreSQL query. No new dependencies,
  schema changes, migrations, or custom replacements for library functionality.
- Searchable checkbox options stay open during selection; chips can be removed.
  Apply filters preserves the selection in the URL and resets pagination. Active
  reps precede labeled inactive reps. Missing options retain selected IDs.

## Files Changed

Backend commit scope:

| File                                                                     | Purpose                                                                                       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/modules/shipments/shipments.schemas.ts`                             | Validate the plural search parameter and deduplicate selections.                              |
| `src/modules/shipments/typeorm-shipment-search.ts`                       | Parameterized UUID-array matching grouped with Unassigned.                                    |
| `src/modules/sales-reps/sales-reps.controller.ts`                        | Staff filter-options endpoint.                                                                |
| `src/modules/sales-reps/sales-reps.service.ts`                           | Active-first minimal filter projection.                                                       |
| `test/integration/shipment-search.spec.ts`                               | Real PostgreSQL matching, counts, pagination, inactive/unassigned/unknown/duplicate coverage. |
| `test/e2e/shipments.spec.ts`                                             | HTTP validation, staff access, restricted/anonymous rejection and unchanged assignment rules. |
| `docs/v1/frontend-handoff.md`                                            | Search and filter-options API contract.                                                       |
| `docs/v1/auth-api.md`                                                    | Staff access contract.                                                                        |
| `docs/v1/implementation-summary/FILTER-V1-001-implementation-summary.md` | Review and verification evidence.                                                             |

Frontend commit scope, relative to sibling `grd-dashboard-fe`:

| File                                                                     | Purpose                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/features/shipments/filters.tsx`                                     | Multi-select control, active/inactive labels, stable UUID option keys and retained drafts. |
| `src/features/shipments/search-state.ts`                                 | Plural URL validation; old singular query rejected.                                        |
| `src/features/shipments/api.ts`                                          | Fetch filter options separately from assignment options.                                   |
| `src/features/shipments/pages/shipments-page.tsx`                        | Query and render filter options with load-error feedback.                                  |
| `src/features/shipments/filters.test.tsx`                                | Draft/Apply/Clear, inactive selection and unavailable-option regressions.                  |
| `src/features/shipments/search-state.test.ts`                            | Valid/invalid plural values, old-key rejection and pagination reset.                       |
| `e2e/shipments.spec.ts`                                                  | Desktop/mobile selection, chip removal, URL reload, clear and width checks.                |
| `docs/v1/api-contracts.md`                                               | Frontend contract and behavior.                                                            |
| `docs/v1/implementation-summary/FILTER-V1-001-implementation-summary.md` | Frontend review handoff.                                                                   |

## Verification

Backend:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: passed.
- `pnpm test`: 371 passed. Initial sandbox run had three local-listener EPERM
  failures; the authorized rerun with listener access passed all tests.
- `pnpm build`: passed.
- `pnpm exec vitest run --project integration test/integration/shipment-search.spec.ts`:
  7 passed against disposable PostgreSQL.
- `pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts`:
  16 passed against disposable PostgreSQL, including independent staff fixture setup.

Frontend:

- `pnpm check`: formatting, lint, typecheck, Knip and all 262 tests passed.
- `pnpm build`: passed, including typechecking after the final UI change. Existing
  circular-dependency and bundle-size warnings remain non-blocking.
- `pnpm exec playwright test e2e/shipments.spec.ts --workers=1`: all 24 passed.
  The new test initially had an ambiguous Unassigned locator, corrected to scope
  it to the filter listbox. A concurrent run also hit an existing resize assertion;
  the full sequential rerun passed without changing that assertion.
- `node /tmp/verify-multi-rep.mjs`: real browser plus real local API/PostgreSQL
  acceptance passed at desktop/mobile widths, covering OR results, inactive reps,
  Unassigned, counts, reload and no horizontal page overflow. Fixture-only data.
  Screenshots `/tmp/multi-rep-desktop.png` and `/tmp/multi-rep-mobile.png` retained;
  mobile rendering visually inspected.
- `git diff --check` in both repositories: passed.

Full integration/e2e suites, combined coverage and container packaging checks were
not run; this change does not alter release/container configuration. No deployment.

## Review Notes

The query contract intentionally breaks old single-rep search links, as approved.
Frontend/backend releases need coordination. IDs are bound as PostgreSQL parameters;
rep OR conditions are parenthesized so they cannot bypass other filters. Unknown
valid UUIDs return no match rather than broadening the filter. UUID-based option
keys distinguish different reps with the same name.

The backend's pre-existing observability work was committed independently during
this task; it is not part of this change. The frontend's pre-existing
`e2e-backend/tracking-review.spec.ts` change was left untouched and is excluded
from the proposed commit.

## Remaining Issues

No feature blockers. An existing responsive-grid test showed a timing-sensitive
failure under concurrency; the sequential suite passed. Full suites and production
behavior remain unverified. No commits or deployments performed.

Isolated manual servers remain running (tracking worker disabled):

- Frontend: `http://localhost:4176/shipments?q=multi-rep-demo`
- Backend: `http://localhost:3019/api/v1/health/live`
- Fixture login: `frontend-admin@example.test` / `admin fixture password`.

## Suggested Review Order

Search schema/query → filter-options access → frontend URL/control wiring → tests
and API docs. Proposed separate commits, with only the scope listed above:

1. Backend: `feat(shipments)!: FILTER-V1-001 support multiple sales rep filters`
2. Frontend: `feat(shipments)!: FILTER-V1-001 add multi-select sales rep filter`

Explicit final approval is required before staging or committing.
