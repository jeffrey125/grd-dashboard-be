# SQ-V1-008 implementation summary

## Summary

Implemented provider administration across the backend and frontend. Admins can
change mode/availability/maintenance/stale policy, run readiness tests, explicitly
acknowledge failed tests, and refresh account defaults. Staff see effective settings
and may refresh enabled defaults. Implementation and fixture verification are complete; nothing staged or committed.

## Changes Made

- Added durable, worker-executed readiness tests without sample-rate requests.
  Tests bind provider, proposed mode, settings revision and testing admin; validity
  is fifteen minutes. Failed-test saves require explicit acknowledgment and retain
  an allowlisted failure summary, testing identity and timestamps.
- Settings updates use revision checks and provider locks. Quote claims take provider,
  account and comparison locks in that order; readiness/default claims share account
  exclusion and recheck after locking. Delayed claims renew execution deadlines.
  Queued work cannot call disabled providers; already-running requests may finish.
  Lease recovery preserves an attempt's actual mode and original sender.
- Stale policy defaults to one hour, accepts 1–168 whole hours, and applies to existing
  history without provider expiry. The migration changes old seeded 24-hour values
  to 1 and caps legacy values above 168. Provider expiry remains authoritative.
- Successful default refreshes expire after fifteen minutes. The last successful
  address/retrieval time survives a later failed refresh and is visibly cached/stale.
  Submission requires a current refresh or a comparison-only explicit sender.
- Reused approved installed NestJS, TypeORM/PostgreSQL, Zod, Bottleneck, Playwright,
  React, MUI, React Hook Form, TanStack Query and Day.js. No production dependency
  added. Custom code is confined to the approved provider policies, mappings and
  workflow; reusable validation, browser protocol, forms and persistence remain
  library-backed. Sample-rate testing is explicitly assigned to SQ-V1-009.

## Files Changed

Backend paths are repository-relative; frontend paths are relative to the sibling
`grd-dashboard-fe` repository. Both worktrees were clean when implementation began.

### Backend

| File                                                                             | Review purpose                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `README.md`                                                                      | Align approved decisions, database/API contracts, runtime guidance and ticket handoff.                 |
| `docs/v1/database-schema.md`                                                     | Align approved decisions, database/API contracts, runtime guidance and ticket handoff.                 |
| `docs/v1/frontend-handoff.md`                                                    | Align approved decisions, database/API contracts, runtime guidance and ticket handoff.                 |
| `docs/v1/shipping-quotes.md`                                                     | Align approved decisions, database/API contracts, runtime guidance and ticket handoff.                 |
| `docs/v1/tickets/shipping-quotes/SQ-V1-008-admin-controls.md`                    | Align approved decisions, database/API contracts, runtime guidance and ticket handoff.                 |
| `docs/v1/tickets/shipping-quotes/SQ-V1-009-readiness.md`                         | Align approved decisions, database/API contracts, runtime guidance and ticket handoff.                 |
| `src/infrastructure/database/migrations/1793059200000-ProviderAdministration.ts` | Durable readiness records, settings audit/revision, stale bounds/default and successful-default cache. |
| `src/modules/shipping-quotes/amazon-quote.adapter.ts`                            | Add readiness using existing authenticated bootstrap and mode-specific controls.                       |
| `src/modules/shipping-quotes/browser-sender-defaults.ts`                         | Reuse the existing allowlisted default-address parser.                                                 |
| `src/modules/shipping-quotes/provider-admin.controller.ts`                       | Admin-only settings and readiness routes; strict input validation.                                     |
| `src/modules/shipping-quotes/provider-admin.repository.ts`                       | Feature-owned repository contract and Zod settings/test inputs.                                        |
| `src/modules/shipping-quotes/provider-readiness-guard.ts`                        | Block sample rates and provider mutations during readiness checks.                                     |
| `src/modules/shipping-quotes/provider-readiness.worker.spec.ts`                  | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `src/modules/shipping-quotes/provider-readiness.worker.ts`                       | Bounded worker-only readiness execution with sanitized failures.                                       |
| `src/modules/shipping-quotes/quote-worker.module.ts`                             | Keep HTTP controllers in API composition and readiness execution in worker composition.                |
| `src/modules/shipping-quotes/quote.entity.ts`                                    | Match the provider administration migration with explicit NO ACTION foreign keys.                      |
| `src/modules/shipping-quotes/quote.module.ts`                                    | Keep HTTP controllers in API composition and readiness execution in worker composition.                |
| `src/modules/shipping-quotes/sender-defaults.service.spec.ts`                    | Enforce fifteen-minute default freshness and return expiry.                                            |
| `src/modules/shipping-quotes/sender-defaults.service.ts`                         | Enforce fifteen-minute default freshness and return expiry.                                            |
| `src/modules/shipping-quotes/typeorm-provider-admin.repository.ts`               | Transactional settings saves, test validity/ownership, durable queue and account reservation.          |
| `src/modules/shipping-quotes/typeorm-quote-execution.repository.ts`              | Serialize disable/claim/retry and retain started modes on recovery.                                    |
| `src/modules/shipping-quotes/typeorm-quote.repository.ts`                        | Expose effective maintenance/stale policy and cached sender details.                                   |
| `src/modules/shipping-quotes/typeorm-sender-defaults.repository.ts`              | Preserve last successful default and coordinate worker account reservations.                           |
| `src/modules/shipping-quotes/unishippers-quote.adapter.integration.spec.ts`      | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `src/modules/shipping-quotes/unishippers-quote.adapter.ts`                       | Add readiness using existing authenticated bootstrap and mode-specific controls.                       |
| `src/runtime/composition.spec.ts`                                                | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/container/runtime.test.ts`                                                 | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/e2e/provider-admin.spec.ts`                                                | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/integration/database.spec.ts`                                              | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/integration/provider-readiness.spec.ts`                                    | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/integration/provider-schema.spec.ts`                                       | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/integration/quote-execution.spec.ts`                                       | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/integration/quote-persistence.spec.ts`                                     | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/integration/schema.spec.ts`                                                | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/integration/tracking-projection-migration.spec.ts`                         | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.      |
| `test/support/shipment-database.ts`                                              | Apply the fifteenth migration in disposable test databases.                                            |

This summary (`docs/v1/implementation-summary/SQ-V1-008-implementation-summary.md`) records approved decisions, file ownership, verification and commit boundaries.

Additional backend regression file: `test/integration/database-tls.spec.ts` updates
its compiled migration expectation from 14 to 15 while retaining verified TLS.

### Frontend

| File                                                                 | Review purpose                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `docs/v1/api-contracts.md`                                           | Align approved decisions, database/API contracts, runtime guidance and ticket handoff.             |
| `e2e-backend/provider-settings.spec.ts`                              | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.  |
| `scripts/auth-backend.mjs`                                           | Opt-in fixture-only readiness/default workers for end-to-end and manual verification.              |
| `src/app/route-tree.gen.ts`                                          | Generated registration of the new admin route.                                                     |
| `src/components/layout/app-shell.tsx`                                | Expose the admin route and role-restricted navigation.                                             |
| `src/features/shipping-quotes/api.ts`                                | Validated settings/readiness API requests.                                                         |
| `src/features/shipping-quotes/index.ts`                              | Expose the admin route and role-restricted navigation.                                             |
| `src/features/shipping-quotes/pages/provider-settings-page.test.tsx` | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.  |
| `src/features/shipping-quotes/pages/provider-settings-page.tsx`      | Admin settings, readiness/override, audit warning and default-refresh UI.                          |
| `src/features/shipping-quotes/provider-admin-schemas.ts`             | Frontend validation of settings and safe readiness results.                                        |
| `src/features/shipping-quotes/quote-form.test.tsx`                   | Regression coverage for the changed behavior; schema/migration fixtures updated where applicable.  |
| `src/features/shipping-quotes/quote-form.tsx`                        | Display effective settings/maintenance and cached freshness; explicit refresh and expiry handling. |
| `src/features/shipping-quotes/schemas.ts`                            | Mirror provider metadata and default-expiry response fields.                                       |
| `src/routes/admin.shipping-providers.tsx`                            | Expose the admin route and role-restricted navigation.                                             |

## Verification

- Backend `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`: passed.
- Frontend `pnpm check` and `pnpm build`: passed; 34 files / 209 tests. The final rerun after all frontend changes passed format, lint, typecheck, Knip, all 209 tests and the production build.
- Backend `pnpm exec vitest run --project unit src/modules/shipping-quotes/provider-readiness.worker.spec.ts src/modules/shipping-quotes/sender-defaults.service.spec.ts`: 3 passed.
- Backend `pnpm exec vitest run --project integration test/integration/quote-execution.spec.ts --project e2e test/e2e/provider-admin.spec.ts`: 25 passed after the final provider-claim locking correction. Covers concurrent claims, disable/retry, mode recovery, readiness validity and admin/staff authorization.
- Backend `pnpm exec vitest run --project integration test/integration/schema.spec.ts test/integration/runtime.spec.ts`: 37 passed after updating exact schema assertions.
- Backend `pnpm exec vitest run --project integration test/integration/database-tls.spec.ts`: 6 passed after updating migration count to 15.
- Frontend `VITE_API_ORIGIN=http://localhost:3014 pnpm build` followed by
  `FE_TEST_API_PORT=3014 FE_TEST_PROVIDER_ADMIN=true pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/provider-settings.spec.ts`: 1 passed. Real API/DB, fixture-only readiness/default workers; covers failed override, reload, default refresh, disable and staff permissions.
- Backend `pnpm test:container`: final run 6 passed in 59.8 seconds. Initial
  migration-service startup failed; a diagnostic rerun and the unchanged original
  command both passed afterward. No unverified cause is assigned to that first failure.
- Final combined backend run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/sq-v1-008-final-coverage --reporter=dot`: all checks passed; **75 files / 633 tests passed**, 526.23 seconds. Coverage: **88.13% statements, 77.64% branches, 91.83% functions, 90.17% lines**. HTML/LCOV reports are under `/tmp/sq-v1-008-final-coverage`. The default coverage directory was locked by another Vitest process; its report/lock was left untouched.
- An earlier combined run exposed stale composition/migration assertions and concurrent claim starvation, all fixed before the final passing run. It also had a runtime startup failure that did not recur in isolated or final full verification; its cause was not established.
- Non-failing warnings: PostgreSQL client concurrent-query deprecation in the backend suite; frontend large bundle chunk and router CLI circular dependency warnings. These were not suppressed or treated as passing evidence for the affected behavior.
- Both repositories' `git diff --check`: passed.
- Manual servers: frontend `http://localhost:4175/` returns 200; API
  `http://localhost:3015/api/v1/health/ready` returns 200 with application/database up.
  Left running with disposable fixture data, simulated quote worker and an
  intentionally failing readiness fixture. Existing ports 5173/3013 remain untouched.
- No live provider readiness/sample-rate test was run. Sample rates belong to
  SQ-V1-009; no deployment or provider-account write was performed.

## Review Notes

- Standards and specification reviews ran independently. Findings about readiness
  deadline renewal, provider/account lock order and missing admin default refresh
  were fixed; both reviewers reported no residual blocking findings. A final
  concurrency regression exposed shared provider locks starving simultaneous claims;
  exclusive provider selection with `SKIP LOCKED` corrected it. Review confirmed
  consistent lock order and fresh statement snapshots after account locking.
- Readiness confirms login/account/default/mode readiness, not rate success.
  Failure summaries deliberately remain generic and cannot expose raw provider data.
- All new foreign keys explicitly use `ON DELETE NO ACTION` in DDL and ORM mappings.
  The migration is additive apart from the approved stale-policy default/bounds;
  rollback removes new metadata and restores the schema default without rewriting
  configured values back to 24 hours.
- The concurrent retry/disable/claim test verifies acceptable outcomes; it is not a
  deterministic recreation of every possible lock interleaving. The consistent lock
  order and shared account exclusion provide the concurrency guarantee.
- No unrelated pre-existing changes were present. No credentials, raw provider
  payloads, browser storage, live quotes, deployment, commit, push or tag were used.

### Proposed commits (final approval required)

1. Backend: `feat(shipping-quotes): SQ-V1-008 add provider administration and readiness tests`.
   Include the Backend file list above except `sender-defaults.service.ts` and
   `sender-defaults.service.spec.ts`; include this summary and admin/schema/runtime
   documentation hunks. This is the persistence, administration, readiness and
   account-exclusion slice.
2. Backend: `feat(shipping-quotes): SQ-V1-008 expire sender defaults after fifteen minutes`.
   Include `sender-defaults.service.ts`, `sender-defaults.service.spec.ts` and their
   default-freshness documentation hunks. This independently enforces submission
   freshness using the existing refresh identity boundary.
3. Frontend: `feat(shipping-quotes): SQ-V1-008 add provider settings and freshness controls`.
   Include the Frontend file list above. This provides the settings/default UI,
   matching API validation, navigation, fixture workers and browser regressions.

## Remaining Issues

No failing checks remain. Live provider readiness was not exercised; all
provider tests use fixtures. Sample-rate verification is deferred to SQ-V1-009 by
explicit decision. Commit approval remains pending.

## Suggested Review Order

1. Migration/entities, provider-admin repository and admin controller.
2. Readiness adapter guards, worker, shared account reservation and quote recovery.
3. Default freshness/cache and HTTP/fixture regressions.
4. Frontend admin settings/default controls, schemas, API and browser test.
5. Contract documentation and verification evidence in this summary.
