## Summary

SQ-V1-002 implements immutable saved quote comparisons, sender-default refresh,
and copy-to-new across the real API and frontend. Saving does not run rates or
create monitored shipments. Existing installed libraries were approved; no new
production dependency or lockfile change was needed.

## Changes Made

Eight quote tables separate providers/accounts, saved requests/package groups/customs,
attempts, and future quote results/items. Explicit NO ACTION foreign keys, immutable
snapshots, exact decimal conversion in PostgreSQL, and actor-scoped idempotency
protect persisted inputs. New attempts remain saved and never enter the tracking queue.

The authenticated API creates/lists/reads comparisons and queues sender refreshes.
Only the worker owns Playwright sessions. Provider login origins are exact allowlists;
responses are reduced to address fields. Refresh snapshots preserve the address and
timestamp reviewed by the user. The UI supports explicit/default senders, package
quantities, international customs/options, history, read-only detail, and copy-to-new.
Copies refresh defaults before Save becomes available; old ship dates need correction.
All business dates/timestamps use America/New_York. Unsupported provider capabilities
are labelled unverified, with no rates run.

## Files Changed

The file manifests below define the requested change and proposed commit boundaries.
Pre-existing backend planning edits and untracked SQ tickets/specs are excluded.

### Proposed commit: `feat(shipping-quotes): SQ-V1-002 add immutable comparison schema`

Schema foundation, mappings, migration regressions, and schema documentation.

- `src/infrastructure/database/migrations/1792540800000-QuoteComparisons.ts`
- `src/modules/shipping-quotes/quote.entity.ts`
- `src/modules/shipping-quotes/quote.entities.ts`
- `test/support/shipment-database.ts`
- `test/integration/schema.spec.ts`
- `test/integration/database.spec.ts`
- `test/integration/database-tls.spec.ts`
- `test/integration/tracking-projection-migration.spec.ts`
- `docs/v1/database-schema.md`

### Proposed commit: `feat(shipping-quotes): SQ-V1-002 save comparisons and refresh senders`

Authenticated persistence and worker-owned sender refresh with tests and handoff.

- `src/app.module.ts`
- `src/worker.module.ts`
- `src/runtime/composition.spec.ts`
- `src/modules/shipping-quotes/browser-sender-defaults.ts`
- `src/modules/shipping-quotes/quote.controller.ts`
- `src/modules/shipping-quotes/quote.module.ts`
- `src/modules/shipping-quotes/quote.repository.ts`
- `src/modules/shipping-quotes/quote.schemas.ts`
- `src/modules/shipping-quotes/quote.service.ts`
- `src/modules/shipping-quotes/sender-defaults-worker.module.ts`
- `src/modules/shipping-quotes/sender-defaults.repository.ts`
- `src/modules/shipping-quotes/sender-defaults.service.ts`
- `src/modules/shipping-quotes/sender-defaults.worker.ts`
- `src/modules/shipping-quotes/typeorm-quote.repository.ts`
- `src/modules/shipping-quotes/typeorm-sender-defaults.repository.ts`
- `test/e2e/shipping-quotes.spec.ts`
- `test/integration/quote-persistence.spec.ts`
- `test/integration/sender-defaults.spec.ts`
- `README.md`
- `docs/v1/frontend-handoff.md`
- `docs/v1/implementation-summary/SQ-V1-002-implementation-summary.md`

## Verification

- Backend `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm format:check`: passed.
- Backend `pnpm test:cov:all`: completed, 538 passed and 11 failed across 63 files.
  Four task-related fixture assumptions were corrected afterwards: worker timer count,
  TLS migration count, CLI rollback depth, and historical projection rollback depth.
- Backend `pnpm exec vitest run --project integration test/integration/database.spec.ts test/integration/database-tls.spec.ts test/integration/tracking-projection-migration.spec.ts`:
  passed, 17 tests in 3 files, including CLI run/revert/run and no schema drift.
- Backend `pnpm exec vitest run --project e2e test/e2e/shipping-quotes.spec.ts --project integration test/integration/schema.spec.ts test/integration/quote-persistence.spec.ts test/integration/sender-defaults.spec.ts --project unit src/runtime/composition.spec.ts`: passed, 31 tests in 5 files after all fixes.
- Untouched backend baseline `db71cf35bcbe7dd24fca0dddf55e2ddf2f5b165f`:
  `pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts --project integration test/integration/runtime.spec.ts`
  reproduced the remaining 7 failures (27 passed). Three shipment expectations lag
  existing audit/sales-rep/follow-up behavior; four runtime tests parse Console Ninja
  ANSI output as JSON. An isolated current retry additionally showed a SIGTERM timing
  flake. These unrelated tests were not changed. Whole-backend coverage is not certified.
- Frontend `pnpm check`: passed formatting, lint, typechecking, Knip, and 179 tests
  in 30 files. `pnpm build`: passed.
- Frontend `pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/quotes.spec.ts`:
  passed 1 real-backend browser test for save, reopen, and copy.
- `git diff --check`: passed in both repositories; final requested diff reviewed.
  Parallel standards/spec reviews closed all findings; standards also reviewed the
  final migration-test adjustments.
- Live myUnishippers sender read succeeded. Live Amazon reached human verification;
  its successful sender extraction is fixture-tested, not live-certified.
- Local API `http://localhost:3000/api/v1/health/live` and UI
  `http://localhost:5173/quotes`: HTTP 200. Started with frontend
  `node scripts/auth-backend.mjs` and
  `VITE_API_ORIGIN=http://localhost:3000 pnpm exec vite --host localhost --port 5173 --strictPort`.
  Both remain running against disposable PostgreSQL. Worker is disabled; use explicit
  sender entry for manual tests. Fixture login: `frontend-staff@example.test`,
  password `staff fixture password` (test account only).
- Deployment/container release checks and the entire frontend browser suite were not
  run: this change does not deploy or alter container delivery. No rate/purchase call
  was made. No merge, push, or release tag is included.

## Review Notes

The API keeps up to 2,000 actor-bound refresh snapshots in memory in the single API
process. Restart/eviction requires a new refresh or explicit sender entry; already
saved comparison snapshots remain durable. The worker handles default refreshes
serially, with bounded browser/API timeouts and no automatic cross-mode fallback.
Idempotent retry returns an existing comparison before rechecking the date or
refresh snapshot. A changed payload with the same key conflicts; deliberate copies
use fresh keys. Provider enablement is checked transactionally before creating rows.

## Remaining Issues

The full backend suite retains seven baseline failures described above. Live Amazon
refresh needs its human-verification challenge resolved. Manual testing currently
uses explicit senders because the isolated worker is disabled. Rate execution,
provider coverage certification, retry/SSE/admin controls remain later tickets.
Commits require final approval of the exact manifests/messages below.

## Suggested Review Order

1. Schema/migration and database invariants.
2. API validation, persistence/idempotency, sender worker and security tests.
3. Frontend save/copy workflow, real-backend browser test, and API documentation.
