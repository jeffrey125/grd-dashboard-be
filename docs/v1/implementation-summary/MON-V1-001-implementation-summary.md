# MON-V1-001 implementation summary

## Summary

Implemented configurable shipment failure pauses and carrier session-failure disablement, with request-session reuse and authentication validation for every EchoShip/FFE monitoring run.

## Changes Made

- Persist independent carrier policies (enabled/2 defaults), shipment and carrier counters, automatic-disable reasons and per-run session accounting.
- Pause only a repeatedly failing shipment; stop carrier monitoring after repeated shared session/login failures. Preserve snapshots and existing not-found behavior.
- Reuse validated EchoShip/FFE request cookies, allow one login on confirmed expiration, and avoid login on inconclusive validation or explicit account lock. Keep UPS token caching and attribute token failures to the carrier.
- Support one-shot manual retry, admin reset/re-enable semantics, stale-generation protection, truthful notifications and updated public contracts.
- Update historical migration tests to account for the new migration and the existing provider-weight migration they previously omitted.

## Files Changed

Paths below are relative to the backend repository. Pre-existing unrelated edits are excluded. The frontend has a companion report with its complete file manifest.

| File                                                                           | Purpose                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `docs/v1/database-schema.md`                                                   | Document the changed schema, API contract or monitoring behavior.                                            |
| `docs/v1/frontend-handoff.md`                                                  | Document the changed schema, API contract or monitoring behavior.                                            |
| `docs/v1/monitoring-safeguards.md`                                             | Approved monitoring behavior and acceptance rules.                                                           |
| `docs/v1/tracking-behavior.md`                                                 | Document the changed schema, API contract or monitoring behavior.                                            |
| `src/infrastructure/database/migrations/1793318400000-MonitoringSafeguards.ts` | Persist policies, counters, run generation and failure pause reason; preserve pauses on rollback.            |
| `src/modules/carriers/adapters/carrier-adapter.registry.ts`                    | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/carrier-adapter.ts`                             | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/carrier-result.ts`                              | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/echoship/echoship.adapter.spec.ts`              | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `src/modules/carriers/adapters/echoship/echoship.adapter.ts`                   | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/echoship/echoship.mapping.ts`                   | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/echoship/echoship.request.ts`                   | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/ffe/ffe.adapter.ts`                             | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/ffe/ffe.request.ts`                             | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/adapters/ups/ups.adapter.spec.ts`                        | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `src/modules/carriers/adapters/ups/ups.adapter.ts`                             | Reuse and validate request sessions; classify shared authentication failures and invalidate cached sessions. |
| `src/modules/carriers/carrier.entity.ts`                                       | Expose and manage independent admin safeguards, thresholds and durable carrier state.                        |
| `src/modules/carriers/carriers.repository.ts`                                  | Expose and manage independent admin safeguards, thresholds and durable carrier state.                        |
| `src/modules/carriers/carriers.schemas.ts`                                     | Expose and manage independent admin safeguards, thresholds and durable carrier state.                        |
| `src/modules/carriers/carriers.service.spec.ts`                                | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `src/modules/carriers/typeorm-carriers.repository.ts`                          | Expose and manage independent admin safeguards, thresholds and durable carrier state.                        |
| `src/modules/dashboard/typeorm-dashboard.repository.ts`                        | Keep dashboard projections and labels consistent with failure pauses.                                        |
| `src/modules/notifications/notifications.service.ts`                           | Report stopped monitoring truthfully.                                                                        |
| `src/modules/notifications/tracking-notifications.ts`                          | Report stopped monitoring truthfully.                                                                        |
| `src/modules/shipments/shipment.entity.ts`                                     | Expose failure counters and pause/retry behavior in shipment contracts or UI.                                |
| `src/modules/shipments/shipments.schemas.ts`                                   | Expose failure counters and pause/retry behavior in shipment contracts or UI.                                |
| `src/modules/shipments/shipments.service.spec.ts`                              | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `src/modules/shipments/typeorm-shipment-read.ts`                               | Expose failure counters and pause/retry behavior in shipment contracts or UI.                                |
| `src/modules/shipments/typeorm-shipment-record.ts`                             | Expose failure counters and pause/retry behavior in shipment contracts or UI.                                |
| `src/modules/shipments/typeorm-shipment-search.ts`                             | Expose failure counters and pause/retry behavior in shipment contracts or UI.                                |
| `src/modules/tracking/tracking-executor.service.ts`                            | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `src/modules/tracking/tracking-run.entity.ts`                                  | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `src/modules/tracking/tracking-scheduler.service.spec.ts`                      | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `src/modules/tracking/tracking-scheduler.service.ts`                           | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `src/modules/tracking/tracking.repository.ts`                                  | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `src/modules/tracking/tracking.schemas.ts`                                     | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `src/modules/tracking/tracking.service.spec.ts`                                | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `src/modules/tracking/tracking.service.ts`                                     | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `src/modules/tracking/typeorm-tracking-http.repository.ts`                     | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `src/modules/tracking/typeorm-tracking.repository.ts`                          | Apply durable failure accounting, safe manual retry and shared-session run handling.                         |
| `test/e2e/carriers.spec.ts`                                                    | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/e2e/refresh.spec.ts`                                                     | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/e2e/shipments.spec.ts`                                                   | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/amazon-api-mode-migration.spec.ts`                           | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/database-tls.spec.ts`                                        | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/database.spec.ts`                                            | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/echoship-http.spec.ts`                                       | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/ffe-http.spec.ts`                                            | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/monitoring-safeguards.spec.ts`                               | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/quote-execution.spec.ts`                                     | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/quote-persistence.spec.ts`                                   | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/runtime.spec.ts`                                             | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/schema.spec.ts`                                              | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/integration/tracking-projection-migration.spec.ts`                       | Verify the changed behavior, contract or migration expectations with fixtures.                               |
| `test/support/shipment-database.ts`                                            | Provide current carrier/shipment fields and migration fixtures.                                              |
| `docs/v1/implementation-summary/MON-V1-001-implementation-summary.md`          | Review handoff, verification evidence and commit scope.                                                      |

## Verification

- `pnpm check` — stopped at the pre-existing formatting issue in `docs/v1/shipping-quotes.md`; unrelated content was preserved. Requested files pass Prettier.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` — passed on final implementation.
- `pnpm test` — final 348 passed, 38 files. An initial sandboxed run could not bind a local fixture port; the permitted rerun passed.
- `pnpm exec vitest run --project unit --project integration --project e2e` — 639 passed, 4 failed out of 643, across 84 files. All failures were obsolete migration count/rollback/schema assertions, corrected and verified in the following final rerun.
- `pnpm exec vitest run --project integration test/integration/database-tls.spec.ts test/integration/tracking-projection-migration.spec.ts test/integration/amazon-api-mode-migration.spec.ts test/integration/schema.spec.ts test/integration/quote-execution.spec.ts test/integration/quote-persistence.spec.ts test/integration/monitoring-safeguards.spec.ts` — final 51 passed, 7 files, including all four corrected failures, zero schema drift, historical up/down behavior, and the UPS lazy-authentication reset regression.
- `pnpm exec vitest run --project integration test/integration/tracking-worker.spec.ts` — final 13 passed.
- `pnpm exec vitest run --project unit src/modules/carriers/adapters/ups/ups.adapter.spec.ts` — 39 passed.
- Native EchoShip/FFE HTTP and database focused checks — 40 passed across 4 files before the final additional lazy-auth regression; these suites also passed in the broad run.
- Frontend `pnpm check` — passed all gates and 248 tests; production build passed. Selected carrier/shipment browser checks passed 60 tests, final shipment-detail rerun passed 24, and real-API carrier checks passed 2. See the companion frontend report for exact commands.
- Final `git diff --check` in both repositories — passed. Combined coverage, container lifecycle and live-provider checks were not run; no coverage claim is made.

Local manual review: frontend `http://localhost:5173`; API `http://localhost:3302`, readiness `/api/v1/health/ready`. Both returned HTTP 200. Disposable fixture database, no live carrier worker. Login: `frontend-admin@example.test` / `admin fixture password`. Servers are left running. Desktop and 375px mobile screenshots were captured; mobile controls are readable and the browser check reported no horizontal overflow.

## Review Notes

Uses the approved installed Axios/cookie jar, TypeORM/PostgreSQL, Zod, MUI and TanStack Query capabilities; no production dependency was added. Business rules are limited to the approved monitoring scope. Shipping quotes are unchanged by this feature.

Defaults are enabled with thresholds of 2; each threshold accepts 1–10. Not-found keeps its existing separate threshold. Shared session failures count once per run and do not increase shipment technical-failure counts. Re-enabling a safeguard resets counters but does not resume paused shipments or disabled carriers. A successful explicit retry resumes monitoring; failed/not-found retains the pause. Carrier disablement blocks new work; an operation already running may finish.

Deploy the migration and backend before the matching frontend. New frontend response schemas require the new backend fields. Cookies remain worker-memory only and disappear on restart. Existing historical failures are not backfilled. The enum migration rewrites its column type transactionally and needs normal database DDL locking; rollback converts failure pauses to manual pauses.

## Remaining Issues

This report was prepared before commit and deployment. Live provider credentials were not exercised; fixture success does not establish that EchoShip has unlocked the account. Production rollout and provider recovery remain separate work. Full combined coverage and opt-in container lifecycle checks were not run for this feature; no container/release configuration changed. The backend whole-repository format gate still reports the pre-existing `docs/v1/shipping-quotes.md` formatting issue.

## Suggested Review Order

1. Approved behavior in `docs/v1/monitoring-safeguards.md`, migration and entity mappings.
2. Tracking transactions/executor and adapter session lifecycle, followed by regression tests.
3. Frontend carrier settings, shipment retry presentation and browser/API evidence.

Proposed commits (approval required before staging or committing):

- Backend: `feat(monitoring): MON-V1-001 add durable failure safeguards and session reuse` — the backend files listed above; only the MON-V1-001 addition in `docs/v1/frontend-handoff.md`.
- Frontend: `feat(carriers): MON-V1-001 expose monitoring safeguards and retry states` — the frontend files listed in its companion report.

All pre-existing Amazon/shipping-quote edits remain outside these commit scopes. The commit and deployment results are reported in the delivery message for this change.
