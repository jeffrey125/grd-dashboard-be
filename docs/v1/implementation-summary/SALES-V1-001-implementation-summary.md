# SALES-V1-001 — Required Sales Rep emails

## Summary

Prepared the full-stack non-null Sales Rep email change locally. Separately,
created and verified Brendan Laird's active Staff account on production at
`brendan@globalresourcesdirect.com`, with required password replacement.
The migration has not been run in production. No password is stored in this change.

## Changes Made

- TypeORM migration adds `sales_reps.email varchar(254) NOT NULL` and a
  normalized/nonempty check and `uq_sales_reps_email` UNIQUE constraint. It copies an account email only for a unique,
  case-insensitive full-name match, then uses the nine approved seed addresses
  for unmatched approved initial reps. It covers inactive rows as well.
- Unknown rows without an unambiguous match block the transaction. Fresh database
  seeds receive the approved addresses even before employee accounts exist.
- Backend create requires email; PATCH permits email-only or name-only updates.
  Existing Zod trims, lowercases and validates email, up to 254 characters.
- Frontend React Hook Form/Zod/MUI editor requires email; the desktop table and
  mobile cards display it. No dependency or lockfile changes.
- No foreign key, automatic synchronization, account
  changes or authorization behavior are introduced by the migration. The
  filter-options endpoint still omits email.

## Files Changed

Backend:

- `src/infrastructure/database/migrations/1793577600000-SalesRepEmails.ts`: column,
  guarded backfill, required/normalized constraint, reversible schema removal.
- `src/modules/sales-reps/sales-rep.entity.ts`: ORM column and matching check.
- `src/modules/sales-reps/sales-reps.repository.ts`: email in record/write contract.
- `src/modules/sales-reps/typeorm-sales-reps.repository.ts`: persist/project email and translate duplicate-email violations to HTTP 409.
- `src/modules/sales-reps/sales-reps.schemas.ts`: required create, optional update,
  response validation.
- `src/modules/sales-reps/sales-reps.service.spec.ts`: normalization, missing/invalid
  input, email-only updates and retained name-only update behavior.
- `test/integration/sales-rep-emails.spec.ts`: fresh backfill, constraints, rollback
  on unmatched inactive rows, full-name account matching and revert/reapply.
- `test/integration/schema.spec.ts`: exact column assertion.
- `test/integration/database.spec.ts`: migration fixture and historical reversal.
- `test/integration/runtime.spec.ts`: current-schema runtime fixture.
- `test/integration/amazon-api-mode-migration.spec.ts`: historical reversal offset.
- `test/integration/shipment-search.spec.ts`: required emails on test reps.
- `test/support/shipment-database.ts`: shared current-schema migration fixture.
- `test/e2e/carriers.spec.ts`: authenticated required-email create, normalization,
  update, deactivate/restore retention and current-schema fixture.
- `test/e2e/shipments.spec.ts`: email-bearing test rep creation.
- `docs/v1/database-schema.md`: column and backfill policy.
- `docs/v1/frontend-handoff.md`: updated request/response/rollout contract.
- This summary: verification, boundaries and proposed commits.

Frontend (`../grd-dashboard-fe`):

- `src/features/sales-reps/schemas.ts`: required input and admin response email.
- `src/features/sales-reps/sales-rep-editor.tsx`: editable required email input.
- `src/features/sales-reps/pages/sales-reps-page.tsx`: desktop/mobile email display.
- `e2e/sales-rep-email.spec.ts`: desktop/mobile validation, normalized submission,
  editor prefill/update, display and no horizontal page overflow.
- `docs/v1/api-contracts.md`: backend-aligned email contract and deployment order.

Pre-existing frontend `e2e-backend/tracking-review.spec.ts` changes are unrelated
and were not edited. Backend worktree was clean before implementation.

## Verification

Commands use installed binaries directly after pnpm's pre-script dependency check
attempted a store lock outside the writable sandbox. No dependency installation
or version changes were made.

Backend:

- `node_modules/.bin/tsc --noEmit`: PASS.
- `node_modules/.bin/oxlint --deny-warnings .`: PASS.
- `node_modules/.bin/nest build`: PASS.
- `node_modules/.bin/vitest run --project unit`: PASS, 42 files / 379 tests with
  loopback access. Initial sandbox run had 3 `listen EPERM` failures in existing
  notification tests; the permitted rerun passed all tests.
- `node_modules/.bin/vitest run --project integration test/integration/sales-rep-emails.spec.ts test/integration/schema.spec.ts test/integration/database.spec.ts test/integration/shipment-search.spec.ts test/integration/amazon-api-mode-migration.spec.ts`:
  PASS, 5 files / 39 tests on disposable PostgreSQL, including compiled CLI
  migration rollback/reapply and schema-drift checks.
- `node_modules/.bin/vitest run --project e2e test/e2e/carriers.spec.ts test/e2e/shipments.spec.ts`:
  PASS, 2 files / 38 tests. After adding further missing-email/normalized update
  assertions, `node_modules/.bin/vitest run --project e2e test/e2e/carriers.spec.ts`
  passed all 22 tests.
- `node_modules/.bin/vitest run --project integration test/integration/runtime.spec.ts`:
  PASS, 19 runtime tests with disposable PostgreSQL.
- Focused Prettier checks for all changed TS/schema/handoff files: PASS.
- `git diff --check`: PASS.

Frontend:

- `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/tsc --noEmit -p tsconfig.node.json`,
  `node_modules/.bin/tsc --noEmit -p tsconfig.e2e.json`: PASS.
- `node_modules/.bin/biome check --formatter-enabled=false src/features/sales-reps e2e/sales-rep-email.spec.ts`:
  PASS. Changed frontend code formatted with Biome.
- `node_modules/.bin/vitest run`: PASS, 39 files / 267 tests.
- `node_modules/.bin/vite build`: PASS; existing large-chunk warnings remain.
- `node_modules/.bin/playwright test e2e/sales-rep-email.spec.ts --workers=1`:
  PASS, 2 tests (desktop/mobile). Initial failures exposed duplicate desktop email
  display plus an exact-label selector including the required marker; both fixed.
  These browser checks use fixture HTTP responses; real API persistence is covered
  by backend PostgreSQL HTTP tests.
- `git diff --check`: PASS.

Local manual servers left running:

- API: `http://localhost:3000/api/v1`, existing local-only
  `node scripts/auth-backend.mjs` harness with disposable PostgreSQL and tracking
  worker disabled. `GET /api/v1/health/live` returned `{"status":"ok"}`.
- Frontend: `http://localhost:5173`, Vite with API origin `http://localhost:3000`,
  HTTP 200 verified. Local-only fixture admin is `frontend-admin@example.test`,
  password `admin fixture password`; these are test harness credentials only.

Whole-backend combined coverage, the full integration/e2e suites and opt-in
container checks were not run; this is not a release/container change. No
production migration or deployment was run.

### Unique-email follow-up verification

After approval to make email unique, updated the pending migration and entity
with `uq_sales_reps_email`. Updated repository conflict handling, API/SQL duplicate
regressions and schema/API documentation. No additional production dependency.

- `node_modules/.bin/tsc --noEmit`: PASS.
- `node_modules/.bin/nest build`: PASS.
- `node_modules/.bin/oxlint --deny-warnings .`: PASS.
- `node_modules/.bin/vitest run --project integration test/integration/sales-rep-emails.spec.ts test/integration/schema.spec.ts test/integration/database.spec.ts`:
  PASS, 3 files / 32 tests, including unique constraint, direct insert/update
  rejection, inactive-email reservation, rollback/reapply and schema-drift checks.
- `node_modules/.bin/vitest run --project e2e test/e2e/carriers.spec.ts`:
  PASS, 22 tests, including normalized duplicate create/update returning 409,
  retained original email after rejected update and inactive email conflicts.
- Focused Prettier and `git diff --check`: PASS.
- Full unit/frontend suites and browser checks above predate this backend-only
  follow-up; they were not repeated. Production execution remains pending.
- Restarted the isolated local API against fresh disposable PostgreSQL to use the
  revised pending migration; frontend remains on port 5173.

## Review Notes

Email is unique across active and inactive reps. Duplicate create/update requests
return HTTP 409 (`Sales Rep email already exists`), including normalized uppercase
inputs; the database constraint protects concurrent writers. The pending,
unreleased email migration was updated in place.

Email is a copied contact address, not an account foreign key. Later account
email changes do not synchronize. No new foreign keys or custom reusable
validation/arithmetic/protocol implementations were added; installed libraries
cover these responsibilities.

The create API now rejects missing email, so coordinate migration/backend and
frontend rollout. Unknown or ambiguous non-seed full-name matches require verified
backfill decisions before production migration. Reverting drops the email column
and its contents; exercise down only on disposable databases or after a reviewed
production rollback decision.

## Remaining Issues

Production migration/deployment and commit approval are pending. No implementation
blocker remains. Five non-sales-rep account surnames still use their earlier
placeholder and are outside this email change.

## Suggested Review Order

1. Migration and entity/schema documentation.
2. Backend contracts, persistence and validation tests.
3. Frontend schemas/editor/list plus desktop/mobile regression.
4. Integration evidence and rollout compatibility notes.

Proposed single-purpose commits (approval required before staging):

- Backend, all files listed above: `feat(sales-reps)!: SALES-V1-001 require and backfill sales rep emails`
- Frontend, the five listed frontend files only: `feat(sales-reps): SALES-V1-001 add required email editor`
