# UPC-V1-001: Airtable Upcoming Shipments

## Summary

Implemented the approved read-only Upcoming Shipments feature in the API and
sibling frontend. The local application uses live Airtable data and an isolated
local PostgreSQL database. No production deployment or Airtable write occurred.
The separate prototype server on port 4175 was stopped at the user's request.

## Changes Made

- Airtable GRD SALES ORDERS queries include nonblank REQ SHIP from Chicago today,
  exclude Test, and ignore Actual Ship for eligibility. Week ends Sunday inclusive;
  calendar/admin dispatch stops at month end. Weekly reads may cross month end.
- Operational fields and linked rep/product/vendor/SO names are read without
  financial fields. Pagination is complete or fails explicitly; requests use
  Axios, retry handling and a shared Bottleneck limiter. PO 0 is retained.
- Five-minute cache coalesces loads. Explicit refresh and provider cooldowns avoid
  repeated requests; stale warnings remain until successful upstream refresh.
  Initial upstream failure is an error. Date rollover requires a fresh request.
- Account-to-Airtable-rep permissions use a new table with NO ACTION FK and
  transactionally replaced mappings. Own-rep email matches only suggest a link;
  Admin saves explicitly. Assistants can have multiple reps. Admin sees all and
  unassigned; unconfigured Staff are hidden. Reads recheck scope after loading.
  Existing access can be removed even when Airtable's directory is unavailable.
- Frontend adds the weekly overview, current-month FullCalendar, Admin dispatch,
  and account access editor. Mobile retains date navigation and inline orders with
  centered details modal. Desktop monthly dates open every order in a right drawer;
  details use that same drawer with animated Back, retained list position/focus,
  outside click, Close and Escape dismissal. Existing MUI 320 ms/reduced-motion
  settings apply. Rep filters update the displayed order count.
- Approved dependencies: backend Day.js 1.11.23; frontend matching FullCalendar
  core/react/daygrid/interaction 6.1.22. Other behavior reuses installed packages.

## Files Changed

Backend:

- `src/modules/upcoming-shipments/upcoming.contracts.ts`, `upcoming.dates.ts`:
  source/access boundaries, public operational records and Chicago date windows.
- `airtable-upcoming.source.ts`, `airtable-upcoming.source.spec.ts`: read-only,
  paginated provider mapping, throttling/retry, linked names and PO-zero coverage.
- `upcoming.service.ts`, `upcoming.service.spec.ts`: scope, cache, assignments,
  failure handling and date/permission regression tests.
- `upcoming-access.entity.ts`, `typeorm-upcoming-access.repository.ts`: persisted
  permission mappings and serialized replacement.
- `upcoming.controller.ts`, `upcoming.module.ts`, `src/app.module.ts`: authenticated
  API/admin routes and API-only composition.
- `src/infrastructure/database/migrations/1794873600000-UpcomingShipmentAccess.ts`:
  permissions-only table, primary/partial unique keys, NO ACTION FK.
- `src/config/configuration.ts`, `env.schema.ts`, `env.schema.spec.ts`,
  `.env.example`: optional server-only Airtable token; missing token disables access.
- `src/infrastructure/logging/{nest-logger.adapter,pino-logger.service}.spec.ts`:
  extend typed configuration fixtures without altering runtime logging.
- `test/e2e/upcoming-shipments.spec.ts`: real HTTP/auth/database scope and persistence.
- `test/support/shipment-database.ts`, `test/integration/schema.spec.ts`: include
  new production migration/entity and schema expectations.
- `test/integration/{amazon-api-mode-migration,quote-execution,quote-persistence,
sales-rep-emails,tracking-projection-migration}.spec.ts`: unwind the new latest
  migration before older migration regressions.
- `package.json`, `pnpm-lock.yaml`: approved Day.js dependency.
- `docs/v1/upcoming-shipments.md`, `database-schema.md`, `frontend-handoff.md`, this
  summary: agreed contract, schema and completion evidence.

Frontend files are detailed in the sibling
`docs/v1/implementation-summary/UPC-V1-001-implementation-summary.md`.

## Verification

- Backend `pnpm build`, `pnpm typecheck`: passed.
- Backend `pnpm test`: 393 tests passed in 45 files after final review fixes.
  An initial sandbox run could not bind three notification fixture servers;
  rerun with local network permission passed.
- `pnpm exec oxlint --deny-warnings src test`: passed. Root `pnpm lint` is blocked
  by two pre-existing unused variables in the untracked prototype files
  `output/ui-prototype/{final-layout,inspired-layouts}.js`; those files were preserved.
- Scoped Prettier check across all changed TypeScript files: passed.
- New source/service tests: 9 passed, including cold failure, stale recovery,
  concurrent loads, scope changes, offline revocation and month rollover.
- `pnpm exec vitest run --project e2e test/e2e/upcoming-shipments.spec.ts`: passed
  against disposable PostgreSQL, authenticated Admin/Staff, real routes and fixture
  Airtable provider. Anonymous/admin-only/foreign-rep checks and FK behavior passed.
- Six targeted integration suites: 42 tests passed after extending schema
  expectations. Five migration-regression suites passed together (24 tests);
  final `test/integration/schema.spec.ts` passed all 18 tests, including zero ORM
  schema drift and NO ACTION foreign keys.
- Frontend `pnpm check`: passed, including 267 unit/component tests.
- Full frontend Playwright suite: 184 passed, 2 intentionally skipped screenshot
  generation tests. Final targeted Upcoming Shipments tests rerun after the last
  rep-filter adjustment; see sibling summary for result.
- Live read-only adapter check: 24 orders, 17 reps, 27 product lines; all dates in
  the requested current window. No raw capture or secret committed.
- Local real-browser login/API/Airtable check: HTTP 200, 24 scoped Admin orders,
  desktop right drawer and mobile modal passed; no browser errors. Fixture
  screenshots were reviewed in light mode on desktop and mobile.
- Standards/spec review found stale-warning, offline-revocation, cooldown and
  rollover issues; all were corrected and both reviewers confirmed no remaining
  findings in the reviewed scope.
- Full backend integration/e2e/container/combined-coverage acceptance and production
  deployment were not run. This is not a release-readiness claim.

## Review Notes

The new source window is separate from tracked Shipment ETA-based Upcoming
deliveries and creator Personal/Team scope. The shared cache contains source data,
but authorization is applied on every response. Raw token/provider failures are
not returned. Rep IDs are Airtable IDs, not existing local Sales Rep UUIDs.
Permissions are the only new database data; there is no order migration/sync.

Pre-existing work was retained: backend/frontend AGENTS.md edits, output previews,
frontend motion implementation and `e2e-backend/tracking-review.spec.ts`. Feature commits were authorized separately; no push, merge, tag, or deployment was requested.

Local servers remain running:

- Frontend: http://localhost:5173/upcoming-shipments
- API readiness: http://localhost:3000/api/v1/health/ready
- Isolated PostgreSQL container `grd-upcoming-dev-db`, loopback port 55437.
- User services `grd-frontend-dev.service` and `grd-upcoming-api.service`.
  Local generated login is in `/tmp/grd-upcoming-login.json` (0600); local configuration
  and database credentials are separate 0600 files under `/tmp`, outside the repository
  and Docker build context. Production databases and existing accounts were untouched.

## Remaining Issues

- Help guide/screenshot changes are pending the user's separate approval. Proposed:
  Upcoming Shipments guide plus Admin-only account-to-rep assignment guide.
- Production activation requires the permissions migration and a suitable read-only
  AIRTABLE_TOKEN; no production activation was requested or performed.
- Repository-wide backend lint remains affected by the pre-existing prototype files.

## Suggested Review Order

Approved spec → source/date/scope service → migration/repository → HTTP tests →
frontend views/assignments → browser tests and handoff docs.

Approved backend commit:
`feat(upcoming-shipments): UPC-V1-001 add scoped Airtable shipment API`
