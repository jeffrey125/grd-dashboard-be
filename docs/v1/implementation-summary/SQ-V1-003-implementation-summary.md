## Summary

SQ-V1-003 implements durable asynchronous quote attempts and comparison-specific SSE across the backend and frontend. New comparisons queue immediately; historical saved comparisons remain unchanged. Real provider rate adapters remain SQ-V1-004/005.

## Changes Made

- Added lease ownership, attempt number, execution timestamps/outcome, simulation marker, and sanitized diagnostics. Account locks plus the running-account unique index prevent overlapping claims; request locks preserve aggregate status during concurrent provider completion.
- The worker scans every second, permits two different accounts concurrently, and uses a 90-second execution deadline within a 120-second lease. Each recovery receives a fresh token; late completions are rejected. One recovery is allowed; the next expired lease fails visibly. Authentication replay is durably reserved once, including across recovery.
- Reused installed TypeORM/PostgreSQL, Nest/RxJS, Zod, TanStack Query, MUI, and browser EventSource. No dependency or lockfile changes. The existing PostgreSQL listener supplies transient comparison UUID hints; every SSE frame rechecks authentication and resource visibility.
- Added opt-in fixture scenarios for success, validation, unsupported, timeout, relogin/replay, and failure. Production rejects demo mode. Missing real adapters produce `adapter_unavailable`. Manual Retry remains SQ-V1-007.
- The UI renders queued/running/partial/failed/completed states, labels simulated results, refetches after connection/reconnection, serializes reads during event races, and polls active comparisons every 15 seconds as missed-event fallback.

## Files Changed

These manifests are the user-approved commit boundaries. All paths are relative to their respective repository. The baseline fixes are already committed separately as `f705c08`; the implementation commits below are being created after approval.

### Backend schema commit

`feat(shipping-quotes): SQ-V1-003 add durable attempt lease schema`

Migration and entity mapping add execution metadata and transactional notifications. Database test registration, rollback counts, TLS migration count, and schema documentation are updated together.

- `src/infrastructure/database/migrations/1792627200000-QuoteExecution.ts`
- `src/modules/shipping-quotes/quote.entity.ts`
- `test/support/shipment-database.ts`
- `test/integration/database.spec.ts`
- `test/integration/database-tls.spec.ts`
- `test/integration/schema.spec.ts`
- `test/integration/quote-persistence.spec.ts`
- `test/integration/tracking-projection-migration.spec.ts`
- `docs/v1/database-schema.md`

### Backend execution/API commit

`feat(shipping-quotes): SQ-V1-003 execute queued comparisons and stream progress`

Feature-owned repository/executor/worker code implements durable execution. API projections expose safe attempt/results data. The shared event-stream helper retains bounded delivery and fresh authorization. Configuration and logging fixtures account for demo controls. Tests and handoffs document and verify these behaviors.

- `README.md`
- `docs/v1/frontend-handoff.md`
- `src/config/configuration.ts`
- `src/config/env.schema.spec.ts`
- `src/config/env.schema.ts`
- `src/infrastructure/logging/nest-logger.adapter.spec.ts`
- `src/infrastructure/logging/pino-logger.service.spec.ts`
- `src/modules/events/events.controller.ts`
- `src/modules/events/events.module.ts`
- `src/modules/events/events.source.ts`
- `src/modules/shipping-quotes/quote.module.ts`
- `src/modules/shipping-quotes/quote.schemas.ts`
- `src/modules/shipping-quotes/typeorm-quote.repository.ts`
- `src/runtime/composition.spec.ts`
- `src/worker.module.ts`
- `test/e2e/shipping-quotes.spec.ts`
- `src/modules/events/event-stream.ts`
- `src/modules/shipping-quotes/fixture-quote.adapter.ts`
- `src/modules/shipping-quotes/quote-events.controller.ts`
- `src/modules/shipping-quotes/quote-execution.repository.ts`
- `src/modules/shipping-quotes/quote-executor.spec.ts`
- `src/modules/shipping-quotes/quote-executor.ts`
- `src/modules/shipping-quotes/quote-worker.module.ts`
- `src/modules/shipping-quotes/quote.worker.ts`
- `src/modules/shipping-quotes/typeorm-quote-execution.repository.ts`
- `test/integration/quote-execution.spec.ts`
- `docs/v1/implementation-summary/SQ-V1-003-implementation-summary.md`
- `docs/v1/tickets/shipping-quotes/SQ-V1-003-async-sse.md`

### Frontend commit

`feat(shipping-quotes): SQ-V1-003 render live comparison results`

Schemas mirror the API; the watcher/hook own active subscription and authoritative refresh. Progress/detail/history/form copy reflects async execution. Component/reconnect/browser tests and the isolated demo harness verify behavior without provider I/O. API documentation and this handoff mirror the final contract.

- `docs/v1/api-contracts.md`
- `e2e-backend/quotes.spec.ts`
- `scripts/auth-backend.mjs`
- `src/features/shipping-quotes/pages/quote-detail-page.tsx`
- `src/features/shipping-quotes/pages/quotes-page.tsx`
- `src/features/shipping-quotes/quote-form.test.tsx`
- `src/features/shipping-quotes/quote-form.tsx`
- `src/features/shipping-quotes/schemas.ts`
- `src/features/shipping-quotes/quote-live.test.ts`
- `src/features/shipping-quotes/quote-live.ts`
- `src/features/shipping-quotes/quote-progress.test.tsx`
- `src/features/shipping-quotes/quote-progress.tsx`
- `src/features/shipping-quotes/use-comparison.ts`
- `docs/v1/implementation-summary/SQ-V1-003-implementation-summary.md`

## Verification

- Backend `pnpm typecheck`, `pnpm build`, `pnpm lint`, `pnpm format:check`: passed.
- Initial targeted backend execution/configuration/composition/SSE run: 35 passed in 6 files.
- Final focused backend command (below): 77 passed in 11 files, including schema drift, migration CLI up/down/up, verified TLS, concurrent leases/completions, historical saves, bounded recovery/relogin, SSE isolation/revocation, and composition/configuration checks.
- Initial `pnpm test:cov:all`: 551 passed and 11 failed across 65 files (500.25 seconds). Three task-related failures exposed the CLI rollback count, JSONB ORM default comparison, and expected schema-column list; all three were corrected. After the baseline fixes below, final `pnpm test:cov:all` passed: 563 tests in 65 files, zero failures (494.97 seconds). Combined V8 coverage: statements 89.36%, branches 80%, functions 88.75%, lines 91.21%; compiled process/CLI execution has separate passing assertions rather than V8 coverage.
- Untouched baseline `d72d43852cab859b6cebd0fd9a91f68cb9ee25b1` in `/tmp/grd-sq003-baseline.kUZU4a`: `pnpm build && pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts --project integration test/integration/runtime.spec.ts` reproduced the other eight failures (26 passed). Three shipment tests lag existing audit/sales-rep/filter behavior; local Console Ninja instrumentation caused four JSON-output failures and one SIGTERM mismatch. The approved follow-up corrected the shipment assertions and removed local instrumentation; all 34 affected tests now pass with strict JSON and original signal assertions intact. See [baseline fix evidence](SQ-V1-003-baseline-fixes.md).
- Frontend `pnpm check`: passed format, lint, TypeScript, Knip, and 186 tests in 32 files.
- Frontend `VITE_API_ORIGIN=http://localhost:3013 pnpm build`: passed; existing chunk-size and Router tooling warnings remain.
- Frontend `FE_TEST_QUOTE_DEMO=true FE_TEST_API_PORT=3013 pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/quotes.spec.ts`: 2 passed. Real PostgreSQL/API/worker/UI cover save, completion, copy, partial success/failure, and reload.
- Final `git diff --check`: passed in both repositories.
- Both review axes completed with no open material findings after fixes. Standards requested statement grouping/schema documentation; Spec requested the actual error/recheck/replacement-source test.
- Live rate calls, container/release checks, deployment, and the entire frontend browser suite were not run. This ticket does not change deployment or container delivery.

Final focused command:

```sh
pnpm exec vitest run --project integration test/integration/schema.spec.ts test/integration/quote-execution.spec.ts test/integration/quote-persistence.spec.ts test/integration/database.spec.ts test/integration/database-tls.spec.ts test/integration/tracking-projection-migration.spec.ts --project e2e test/e2e/shipping-quotes.spec.ts --project unit src/modules/shipping-quotes/quote-executor.spec.ts src/modules/events/events.controller.spec.ts src/runtime/composition.spec.ts src/config/env.schema.spec.ts
```

## Review Notes

Backend baseline: `d72d43852cab859b6cebd0fd9a91f68cb9ee25b1`; frontend baseline: `0c8777776832409ef399f93820e3f9a02626cf01`. Earlier planning edits had already been committed before implementation. The working tree also includes the subsequently approved baseline test/editor fixes recorded separately in [baseline fix evidence](SQ-V1-003-baseline-fixes.md).

`completed` comparison status means at least one provider succeeded after all attempts ended; consumers inspect attempts to identify partial results. `ratesRun` means execution started, not successful real rates. All employees share non-deleted quote history, so comparison isolation does not imply creator-only access.

Events are transient invalidations with no durable replay. The database snapshot is authoritative. Recovery may repeat external work after a crash; it does not promise exactly-once provider requests. Adapter I/O must honor cancellation; the executor still bounds uncooperative adapters and rejects late persistence.

Demo mode replaces rate execution only. Existing account-default refresh and tracking retain live behavior. The isolated frontend harness uses disposable PostgreSQL and only the fixture quote worker, so it avoids external provider I/O. The manual demo uses explicit senders.

Manual servers remain running:

- UI: http://localhost:5173/quotes
- API: http://localhost:3013/api/v1/health/live
- Fixture account: `frontend-staff@example.test` / `staff fixture password`.

Started with `FE_TEST_QUOTE_DEMO=true FE_TEST_API_PORT=3013 node scripts/auth-backend.mjs` and `VITE_API_ORIGIN=http://localhost:3013 pnpm exec vite --host localhost --port 5173 --strictPort` in the frontend repository. Both endpoints returned HTTP 200.

## Remaining Issues

The eight backend baseline failures are resolved; the final whole-backend gate is green. Real adapters and user Retry remain intentionally deferred to their later tickets. The existing pg concurrent-query deprecation warning remains non-failing. The user approved the implementation commits; no merge, push, deployment, or release tag is included.

## Suggested Review Order

1. Schema migration and execution repository invariants.
2. Executor/worker, authenticated SSE, and backend concurrency/recovery tests.
3. Frontend schema, watcher/hook, progress UI, and browser verification.
