# SQ-V1-007 implementation summary

## Summary

Implemented complete quote history and retry lifecycle across the backend and frontend.
Staff can inspect immutable comparison and attempt history, retry eligible technical
failures without overwriting prior results, and see stale/expired ranking behavior.
Admins can soft-delete completed or failed comparisons and restore them while all child
attempts and quotes remain retained.

## Changes Made

- Added lifecycle persistence for deleted, restored, and last-deleted timestamps, the
  restoring admin, notification events, immutable-attempt uniqueness, and one-active-
  attempt fencing. New foreign-key behavior explicitly uses `ON DELETE NO ACTION`.
- Added retry policy and service/repository/controller endpoints. Retry rechecks current
  provider configuration, ship date, sender/input validation, active attempts, and
  failure eligibility under row locks before appending a new immutable attempt.
- Preserved original input, sender, execution mode, conversion snapshot, partial quotes,
  and earlier failures across retries. Deleted comparisons remain retrievable only to
  admins and cannot be retried; restore never queues rates.
- Exposed sanitized attempt chronology, retry-block reasons, provider expiry, and stale
  timestamps in the API and documented the backend/frontend contract.
- Added frontend history toggles, admin delete/restore confirmation, retry controls and
  explanations, attempt/mode/origin/timestamp display, stale/expired indicators, and
  exact-equivalence ranking with currency/origin/options warnings and no winner for
  stale, expired, or unknown-freshness quotes. Ranking uses `dayjs` and `decimal.js`.
- Added backend migration, repository/worker/e2e/integration coverage, frontend ranking
  and component coverage, and a browser lifecycle fixture test. The sender-defaults
  `safeExtend` adjustment keeps the existing Zod schema compatible with the installed
  version while exercising the new migration/test paths.

## Files Changed

- Backend quote module: `quote.controller.ts`, `quote.service.ts`,
  `quote.repository.ts`, `quote.entity.ts`, `quote.schemas.ts`,
  `typeorm-quote.repository.ts`, `typeorm-quote-execution.repository.ts`,
  `quote-retry-policy.ts`, `quote-provider-eligibility.ts`, and
  `unishippers-quote.adapter.ts`.
- Backend persistence and verification: `1792972800000-QuoteHistoryRetry.ts`, database
  support/migration/schema/TLS/persistence/tracking tests, `quote-execution.spec.ts`,
  `shipping-quotes.spec.ts`, and container migration expectations.
- Frontend quote API, pages, progress display, schemas, polling, route search state,
  ranking utility/tests, progress tests, and `e2e-backend/quote-history.spec.ts`.
- `docs/v1/database-schema.md`, `docs/v1/shipping-quotes.md`, backend
  `docs/v1/frontend-handoff.md`, frontend `docs/v1/api-contracts.md`, README runtime
  notes, and this summary.

## Verification

- Backend `pnpm check` with loopback test permission: passed formatting, lint,
  typechecking, 32 files/309 unit tests, and build.
- Backend focused retry and HTTP lifecycle suites: 2 files, 29 tests passed.
- Backend migration/TLS/persistence/tracking/sender-default suites: 5 files, 21 tests
  passed.
- Backend full `pnpm build && vitest run --coverage` with an isolated coverage directory:
  70 files, 617 tests passed; 87.19% statements, 77.54% branches, 89.03% functions,
  and 89.46% lines.
- Frontend `pnpm check` with writable Vite cache: 33 files, 203 tests passed; format,
  lint, typecheck, Knip, and route generation passed.
- Frontend `VITE_API_ORIGIN=http://localhost:3014 pnpm build`: passed.
- Frontend backend lifecycle browser test with `FE_TEST_API_PORT=3014
FE_TEST_QUOTE_DEMO=true FE_TEST_QUOTE_RETRY=true`: 1 test passed.
- Backend `pnpm test:container`: all 6 portable image/Compose lifecycle checks passed,
  including migration rollback/reapply and production-only runtime checks.
- Refreshed local Compose API readiness: `GET http://localhost:3013/api/v1/health/ready`
  returned HTTP 200 with the documented frontend origin; Vite served
  `http://localhost:5173/` with HTTP 200.
- Both repository `git diff --check` checks passed.
- Live provider smoke tests were not run; fixtures were used and no provider credentials
  were loaded.

## Review Notes

- Retry is intentionally limited to technical failures (`timeout`, authentication
  failure, and generic failed attempts). Unsupported and validation failures explain
  that a new comparison is required.
- Stale and expired quotes remain readable history but are excluded from **Lowest price**;
  a comparison with no fresh eligible quote has no winner. Exact origin, currency,
  destination, ship date, packages, and requested options are required for comparison.
- One active attempt per provider/comparison is enforced both by a partial unique index
  and locked revalidation, so concurrent retry clicks produce one successor.
- The standards review found and fixed the initial `Date.parse` ranking use in favor of
  `dayjs`, and extracted shared myUnishippers input validation. The spec review found no
  confirmed acceptance-criteria defects.

## Remaining Issues

- No live provider credentials were used, so provider browser behavior remains fixture-
  verified only.
- The refreshed backend Compose API and Vite frontend are left running for manual testing
  at `http://localhost:3013/api/v1` and `http://localhost:5173/`.
- No commit, push, deployment, or semantic-version tag has been created.

## Suggested Review Order

1. Migration/entity/repository retry and lifecycle locking.
2. Service/controller schemas and worker claim-time eligibility.
3. Backend integration/e2e tests and API documentation.
4. Frontend ranking, progress/detail/history controls, and frontend/browser tests.
5. README, schema, and implementation-summary documentation.
