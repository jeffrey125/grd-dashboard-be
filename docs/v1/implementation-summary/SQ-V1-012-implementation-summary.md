# SQ-V1-012 implementation handoff

## Summary

Implemented admin-configurable actual per-box limits: Amazon 50 lb and
Unishippers 150 lb initially. Quote comparison skips overweight providers for the
whole shipment while continuing with eligible providers.

## Changes Made

- Persist positive decimal limits under the existing admin revision/actor controls.
  Warn above published defaults; no new dependency or readiness test for a weight-only edit.
- Convert limits with existing Math.js and compare actual box weight with Decimal.js.
  Equality qualifies; quantity and dimensional/billable weight do not change eligibility.
- Reject all-overweight requests before persistence. Preserve excluded providers as
  terminal unsupported attempts with the applied limit and offending group positions.
- Recheck queued first execution and retries against current limits. Store policy
  separately from immutable conversion data and prevent policy changes after start
  or completion. Running recovery retains the policy; history is not rewritten.
- Show limits, actionable box warnings, disabled Compare state and historical explanations.

## Files Changed

Backend paths below belong to `grd-dashboard-be`.

| File                                                                           | Purpose                                                                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/infrastructure/database/migrations/1793232000000-ProviderWeightLimits.ts` | Persist default provider limits and protect started/terminal attempt policies; reversible migration.     |
| `src/modules/shipping-quotes/provider-weight-policy.ts`                        | Zod setting validation, Math.js limit conversion, Decimal.js eligibility.                                |
| `src/modules/shipping-quotes/provider-weight-policy.spec.ts`                   | Inclusive lb/kg boundaries, quantities, changed limits and invalid settings.                             |
| `src/modules/shipping-quotes/provider-admin.repository.ts`                     | Optional compatible admin PATCH field.                                                                   |
| `src/modules/shipping-quotes/typeorm-provider-admin.repository.ts`             | Read/write limits under existing revision and provider locks.                                            |
| `src/modules/shipping-quotes/quote.entity.ts`                                  | Map provider numeric limit and nullable attempt policy.                                                  |
| `src/modules/shipping-quotes/quote.schemas.ts`                                 | Provider limit and attempt response types.                                                               |
| `src/modules/shipping-quotes/quote.service.ts`                                 | Expose configured lb and precisely converted kg limits.                                                  |
| `src/modules/shipping-quotes/quote-provider-eligibility.ts`                    | Prevent queueing an overweight provider.                                                                 |
| `src/modules/shipping-quotes/quote-retry-policy.ts`                            | Check current weight limit before retries.                                                               |
| `src/modules/shipping-quotes/quote-execution.repository.ts`                    | Expose recorded policy on leased jobs.                                                                   |
| `src/modules/shipping-quotes/typeorm-quote.repository.ts`                      | Atomic all-overweight rejection, partial exclusions and history projection.                              |
| `src/modules/shipping-quotes/typeorm-quote-execution.repository.ts`            | Recheck before initial execution; preserve started policy across recovery.                               |
| `test/integration/provider-weight-limits.spec.ts`                              | Settings, partial/all exclusions, queued changes, retry and immutable recovery tests.                    |
| `test/integration/database.spec.ts`                                            | Include the new migration in up/down coverage.                                                           |
| `test/integration/quote-persistence.spec.ts`                                   | Keep full quote migration rollback coverage aligned.                                                     |
| `test/support/shipment-database.ts`                                            | Apply the migration in disposable integration databases.                                                 |
| `docs/v1/database-schema.md`                                                   | Document storage and trigger guarantees.                                                                 |
| `docs/v1/frontend-handoff.md`                                                  | Document additive API fields, validation and historical messages; only new section belongs to this task. |
| `docs/v1/shipping-quotes.md`                                                   | Record approved behavior and published default sources; only new section belongs to this task.           |
| `docs/v1/tickets/shipping-quotes/SQ-V1-012-provider-weight-limits.md`          | Record approved scope and acceptance criteria.                                                           |
| `docs/v1/tickets/shipping-quotes/README.md`                                    | Index SQ-V1-012.                                                                                         |
| `docs/v1/implementation-summary/SQ-V1-012-implementation-summary.md`           | This review and verification record.                                                                     |

Frontend paths below belong to the sibling `grd-dashboard-fe`.

| File                                                                 | Purpose                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/features/shipping-quotes/provider-weight-policy.ts`             | Decimal comparisons using API-converted limits and recorded failure messages.                     |
| `src/features/shipping-quotes/provider-admin-schemas.ts`             | Read limits and validate editable positive decimal values.                                        |
| `src/features/shipping-quotes/pages/provider-settings-page.tsx`      | Admin input, default display and above-published-limit warning; preserve existing Amazon changes. |
| `src/features/shipping-quotes/pages/provider-settings-page.test.tsx` | Weight-only save and zero rejection tests; preserve existing Amazon tests.                        |
| `src/features/shipping-quotes/schemas.ts`                            | Read additive API fields and reject all-overweight submissions.                                   |
| `src/features/shipping-quotes/quote-form.tsx`                        | Visible provider limits, group warnings and disabled submission.                                  |
| `src/features/shipping-quotes/quote-form.test.tsx`                   | Partial eligibility, correction and kg UI coverage.                                               |
| `src/features/shipping-quotes/quote-progress.tsx`                    | Explain recorded skip and retry limitations.                                                      |
| `e2e-backend/provider-weight-limits.spec.ts`                         | Real API persistence, bypass rejection, partial exclusion and desktop/mobile checks.              |
| `docs/v1/implementation-summary/SQ-V1-012-implementation-summary.md` | Frontend review manifest and link to full verification.                                           |

## Verification

| Exact command / check                                                                                                                                                                                                             | Result                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `pnpm check`                                                                                                                                                                                                              | Passed format, lint, typecheck, 348 unit tests, production build.                                                                                                                |
| Backend `pnpm exec vitest run --project integration test/integration/provider-weight-limits.spec.ts test/integration/provider-schema.spec.ts test/integration/quote-persistence.spec.ts test/integration/quote-execution.spec.ts` | 26 passed; real disposable PostgreSQL, schema mapping and quote migration down/up.                                                                                               |
| Backend `pnpm typecheck && pnpm lint && pnpm exec vitest run --project integration test/integration/database.spec.ts test/integration/provider-weight-limits.spec.ts`                                                             | Passed; 17 tests including complete migration reversal and immutable policy protection. Seven weight tests overlap the preceding command: 36 distinct integration tests total.   |
| Frontend `pnpm lint && pnpm knip && pnpm test`                                                                                                                                                                                    | Passed; 243 tests.                                                                                                                                                               |
| Frontend `pnpm format:check && pnpm typecheck`                                                                                                                                                                                    | Passed all frontend, tooling and browser-test TypeScript configurations.                                                                                                         |
| Frontend `VITE_API_ORIGIN=http://localhost:3027 pnpm build`                                                                                                                                                                       | Passed; existing large-chunk and router tooling warnings remain.                                                                                                                 |
| Frontend `FE_TEST_API_PORT=3027 pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/provider-weight-limits.spec.ts`                                                                                       | Passed, one real-backend browser scenario; includes admin save/reload, all-overweight UI/API rejection, partial exclusion, historical explanation, mobile no-overflow assertion. |
| Desktop/mobile screenshots `/tmp/grd-weight-form.png`, `/tmp/grd-weight-mobile.png`                                                                                                                                               | Visually inspected; warning spans the box grid width, fields and Compare action remain readable.                                                                                 |
| `git diff --check` in both repositories                                                                                                                                                                                           | Passed.                                                                                                                                                                          |
| Local HTTP checks                                                                                                                                                                                                                 | Frontend HTTP 200; backend liveness HTTP 200 with status ok.                                                                                                                     |

Initial sandbox runs could not access Docker/bind local test sockets; reruns with
approved local access passed. Initial feature tests caught conversion snapshot
immutability and a migration rollback-count mismatch; both were corrected and
rerun. Browser test now waits for the form before entering manual addresses.

Not run: entire backend integration/e2e suite, combined coverage, container-release
checks, full frontend browser/acceptance suite, or live provider calls. No release
or container configuration changed. Fixture and local API results do not establish
live provider acceptance of raised limits.

## Review Notes

Approved libraries are reused; no production package or lockfile changes. The
approved custom logic is the provider eligibility rule and existing application
integration. The frontend receives the Math.js-converted kg limit rather than
introducing a second conversion implementation.

Admin input uses the existing measurement representation: positive decimal strings,
up to nine integer and six fractional digits. No provider-specific upper ceiling.
The new migration must run before the new API/worker. Older admin payloads omit the
limit safely; frontend reads tolerate absent additive fields. Old attempts retain
null policy. A weight skip is terminal: if conditions change, copy to a new comparison;
existing eligible transient failures can retry under current settings.

Pre-existing backend work was preserved in `.env.example`, `README.md`, Amazon
adapter/tests, Amazon configuration test, readiness docs/test, live smoke helper,
SQ-V1-011 follow-up, and existing sections of `frontend-handoff.md`/`shipping-quotes.md`.
Pre-existing frontend work was preserved in `e2e-backend/tracking-review.spec.ts`
and the Amazon-specific portions of both provider-settings page files. Commit only
SQ-V1-012 hunks in overlapping files. Final diff reviewed against the captured
pre-task baselines in `/tmp/weight-be-baseline.diff` and `/tmp/weight-fe-baseline.diff`.

Local review servers remain running:

- Frontend: http://localhost:5173/
- API: http://localhost:3028/api/v1/health/live

This is an isolated disposable fixture database; no live worker is running, so
accepted quote requests remain queued. The fixture admin login is
`frontend-admin@example.test` / `admin fixture password`; these are test-only
credentials from the existing harness, not a real account. Runtime sessions:
backend 53517, frontend 28383.

## Remaining Issues

No known feature defects in the checked scope. Production deployment/migration,
live provider verification and the broader suites listed above have not been run.
No staging or commits performed.

## Suggested Review Order

1. Approved SQ-V1-012 scope, weight policy and migration/entity mapping.
2. Repository creation, worker start/recovery and retry handling, then integration tests.
3. Frontend admin/form/result changes and real-backend browser test.

Proposed commits, pending explicit final approval:

1. Backend: `feat(shipping-quotes): SQ-V1-012 enforce configurable provider weight limits`
   — exactly the backend manifest above, restricted to this feature's hunks.
2. Frontend: `feat(shipping-quotes): SQ-V1-012 expose provider weight limits in comparisons`
   — exactly the frontend manifest above, restricted to this feature's hunks.
