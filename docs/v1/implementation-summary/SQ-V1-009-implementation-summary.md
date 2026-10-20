# SQ-V1-009 implementation summary

## Summary

Added executable quote readiness evidence across backend and frontend. The 2026-10-21
follow-up replaces the myUnishippers full-form path with authenticated Quick Quote
capture/replay, requires explicit senders, permits dimensionless myUnishippers-only
comparisons, and verified a live browser-mode quantity-two quote with seven calculated
services.

## Changes Made

- Added a real worker SIGKILL/restart test using disposable PostgreSQL and natural
  120-second lease expiry. Both providers execute concurrently; later work stays
  queued per account; each interrupted attempt recovers once.
- Added raw-error privacy canaries through executor, persistence and authenticated
  history, strict SSE payload allowlisting, and synthetic contact fixtures.
- Expanded the opt-in production-adapter smoke to both providers and both modes,
  independently selectable by CLI, with bounded executor relogin and restricted output.
- Added real-backend browser acceptance for idempotency, partial progress, SSE
  reconnect/refetch, multi-group totals, international capability, native currency,
  original units, unknown costs and absence of purchase actions.
- Recorded the approved privacy exception for required business contact snapshots.
  Reused installed Vitest, Supertest, Testcontainers, PostgreSQL and Playwright;
  Node built-ins handle CLI/process control. No dependency or production schema change.
- Replaced both myUnishippers execution modes with one guarded Quick Quote flow:
  capture the current one-box `/svc/shopFlow` request, replay distinct package
  signatures, and multiply reconciled package charges with Decimal.js.
- Installed write protection before provider navigation. Reviewed read-style POSTs,
  validated `setAlertFlow` FETCH initialization, authentication and `/svc/shopFlow`
  are allowed; pickup scheduling and unknown writes are aborted.
- New submissions require explicit sender addresses. A myUnishippers-only comparison
  may leave all dimensions blank; partial dimensions and Amazon-inclusive comparisons
  remain invalid. Weight remains required. Historical snapshots remain readable;
  browser retries no longer apply obsolete full-form contact/company-name rules.
- Quick Quote accepts only today's `America/New_York` ship date because its request
  has no selectable shipment-date field. International lanes and requested options
  continue to fail closed.
- Corrected Amazon sign-in handling for verification URLs on `www.amazon.com`,
  allowlisted the observed verification POST in readiness, and detect incomplete
  Shipping pickup/contact onboarding before any rate request. Quote history now uses
  the safe `provider_setup_required` reason for that account state.

## Files Changed

| Backend file                                                | Purpose                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `test/integration/quote-readiness.spec.ts`                  | Actual worker crash, concurrency, natural lease recovery and safe log evidence.          |
| `test/integration/quote-live-smoke.spec.ts`                 | Missing-credential and selected-provider/mode CLI behavior.                              |
| `test/e2e/shipping-quotes.spec.ts`                          | Raw failure privacy, authorized contact retention, synthetic receiver and SSE allowlist. |
| `test/support/shipping-quotes/live-adapter-smoke.mts`       | Both live providers/modes and sanitized outcome reporting.                               |
| `README.md`                                                 | Smoke usage and readiness documentation link.                                            |
| `docs/v1/shipping-quotes-readiness.md`                      | Acceptance map, commands, operations, privacy and live blockers.                         |
| `docs/v1/tickets/shipping-quotes/SQ-V1-009-readiness.md`    | Approved privacy clarification.                                                          |
| `src/modules/shipping-quotes/unishippers-quote.adapter.ts`  | Guarded Quick Quote capture, replay and distinct-package execution.                      |
| `src/modules/shipping-quotes/unishippers-quote.contract.ts` | Request correlation, response normalization and exact quantity aggregation.              |
| `src/modules/shipping-quotes/quote.schemas.ts`              | Explicit-sender and provider-aware dimension submission contract.                        |
| `src/modules/shipping-quotes/quote-provider-eligibility.ts` | Domestic, option-free, today-only Quick Quote eligibility.                               |
| `src/modules/shipping-quotes/quote-retry-policy.ts`         | Retry rules aligned with Quick Quote inputs.                                             |
| `src/modules/shipping-quotes/typeorm-quote.repository.ts`   | Queue/provider capability enforcement and provider discovery flags.                      |
| `src/modules/shipping-quotes/amazon-quote.adapter.ts`       | Immediate verification handling and incomplete-account setup detection.                  |
| `src/modules/shipping-quotes/provider-readiness-guard.ts`   | Allows the observed Amazon verification POST while preserving rate/write blocking.       |
| Related unit/integration/e2e specs                          | Request units, write guard, quantities, submission and retry regressions.                |
| This summary                                                | Review and verification evidence.                                                        |

Frontend changes are listed in its matching summary: explicit Quick Quote inputs,
calculated readiness fixtures, shipment review navigation, and dark-theme branding.

## Verification

- `pnpm typecheck`: passed after the test input's US-country literal was corrected.
- `pnpm exec vitest run --project integration test/integration/quote-readiness.spec.ts`:
  initial recovery assertions passed, but log assertion failed because test logging
  defaults to silent. With explicit `LOG_LEVEL=info`, the recovery test passed.
- `pnpm exec vitest run --project e2e test/e2e/shipping-quotes.spec.ts --project integration test/integration/quote-live-smoke.spec.ts`:
  passed, 2 files / 15 tests. Initial SSE test expectation was corrected to the actual
  contract: `externalId` is the only data key; the event name carries its type.
- `pnpm exec tsc --ignoreConfig --noEmit --module nodenext --moduleResolution nodenext --target ES2023 --types node --strict --esModuleInterop --skipLibCheck test/support/shipping-quotes/live-adapter-smoke.mts`:
  passed.
- `pnpm format:check`: blocked by pre-existing untracked
  `work/quote-design-preview/staff-quote-options.html`; untouched.
- `pnpm exec prettier --check . '!work/**'`, `pnpm lint`, `pnpm typecheck`: passed.
- `pnpm test:cov:all`: passed, 77 files / 637 tests in 752.91 seconds. Combined
  coverage: 88.13% statements, 77.64% branches, 91.83% functions, 90.17% lines.
  Existing pg concurrent-query deprecation warnings were non-failing.
- `pnpm test:container`: passed, 6 tests, including fresh migrations, independent
  worker, non-root Chromium runtime, rollback and reapply.
- `pnpm test:shipping-quotes:adapter:live`: exit 1. Amazon request/browser and
  myUnishippers request stopped during sender/login resolution. myUnishippers browser
  returned `authentication_failed`, exactly one relogin, zero services. No raw live
  output or provider account mutation was retained.
- Frontend `pnpm run ci`: passed format/lint/Knip, 210 unit/component tests,
  typechecks/build, and 126 desktop/mobile browser tests.
- Frontend `FE_TEST_QUOTE_READINESS=true pnpm exec playwright test --config
playwright.backend.config.ts e2e-backend/quote-readiness.spec.ts`: final explicit-release
  gate passed, 2 tests. Admin browser scenario passed, 1 test. Isolated retry/history
  scenario passed, 1 test.
- Frontend container checks: HTTPS 4 passed; HTTP-only 3 passed. Initial HTTPS
  failure identified a stale eight-migration expectation, corrected to fifteen.
  Final default frontend/API browser gate: 22 passed / 5 opt-in skips. All five
  skipped cases were separately exercised successfully: readiness 2, admin 1,
  history 1 and partial-progress 1 (in the 3-test quote suite).
- `FE_TEST_QUOTE_DEMO=true pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/quotes.spec.ts`:
  final run passed, 3 tests. Earlier concurrent runs timed out with login/quotes
  still pending; unchanged tests passed after combined backend coverage finished.
- `pnpm exec playwright test --config playwright.backend.config.ts`: final full
  run passed, 22 tests, 5 explicit opt-in skips; initial port-override and transient
  Vite-proxy timeouts are documented in the frontend summary.
- Manual API `http://localhost:3017/api/v1/health/ready` and frontend
  `http://localhost:5173/` returned HTTP 200. Servers remain running with disposable
  synthetic data and no live provider I/O.
- Both repository `git diff --check` checks passed. Independent standards and
  specification review reported no residual findings after fixture corrections.
- Follow-up backend quality gate passed with `work/**` excluded: Prettier, oxlint,
  typecheck, 34 files / 317 unit tests, and build. Repository-wide formatting remains
  blocked only by the unrelated untracked preview under `work/`.
- Focused myUnishippers adapter integration passed: 1 file / 7 tests, covering both
  configured modes, distinct and duplicate package groups, readiness, unsupported
  inputs, and writes attempted during initial page load.
- Shipping quote HTTP e2e passed: 1 file / 14 tests, including explicit sender,
  provider-aware dimensions and browser-mode retry without contact fields.
- Optional-dimension unit/contract regressions passed: 2 files / 21 tests. The
  browser-backed adapter fixture passed 1 file / 9 tests in both configured modes.
- Follow-up backend quality gate passed with `work/**` excluded: Prettier, oxlint,
  typecheck, 34 files / 317 unit tests, and the Nest production build.
- Sanitized live browser smoke passed: quantity 2, 7 USD services, all labelled
  `estimateMethod: calculated`; no raw provider request/response was retained.
- Amazon adapter unit regression passed: 1 file / 8 tests, including immediate
  verification failure and `provider_setup_required` without a rate request.
- Amazon readiness boundary passed outside the restricted sandbox: 1 file / 2 tests;
  the verification POST was allowed while rate and unknown write requests stayed blocked.

## Review Notes

The starting commits were backend `af0eedb4f9e415a3fc8021d0d9501fa759dd0c8c` and
frontend `69a83f73a9e5bb8e0bfc31df9c443bdd9145bb9f`. Both tracked trees were clean;
backend `work/` was already untracked and remains outside this change.

Independent standards/spec reviews found one timing-dependent browser fixture
assertion. The second domestic provider now waits for a test-only release after the
browser sees partial progress and reconnect. The release route is registered before
Nest initialization and exists only in the disposable acceptance harness.

Worker-process acceptance uses existing demo adapters; browser acceptance uses
synthetic fixed prices. Adapter contract fixtures separately test provider mappings.
These layers are explicitly distinct from live capability. Contact snapshots retain
the approved authenticated business behavior; no claim is made that all personal
business data is absent from the database.

Manual privacy review inspected adapter session handling, normalized persistence,
SSE mapping, generic frontend reason messages and tracked fixture sanitizers. The
review used disposable rows and synthetic contacts; production data and ignored
historical captures were not inspected. Gitleaks was not installed; the existing
fixture sanitization and logging/privacy tests supplied automated checks.

No new foreign key, migration or production dependency was needed. The Amazon account
setup reason uses the existing free-form reason column and terminal `failed` outcome,
so it remains eligible for an explicit retry after account setup. Independent
specification and standards reviews found no remaining issue in the optional-dimension follow-up.
The approved follow-up is committed locally in two focused commits. Deployment remains
pending.

## Remaining Issues

- Amazon rates remain blocked until the account owner completes Amazon Shipping's
  pickup/contact onboarding and resolves the worker sign-in verification challenge.
- Repository-wide formatting includes an unrelated pre-existing unformatted preview.
- Current commits are not deployed.

## Suggested Review Order

1. Submission schema and provider eligibility/retry policy.
2. myUnishippers adapter and request-contract handling.
3. Amazon adapter and readiness guard.
4. Unit, browser-fixture and HTTP regressions, then updated quote documentation.

## Commits

1. `feat(shipping-quotes): SQ-V1-009 allow dimensionless Quick Quotes`
   - Purpose: allow all dimensions blank for myUnishippers-only comparisons while
     retaining partial-dimension and Amazon-inclusive rejection.
2. `fix(shipping-quotes): SQ-V1-009 handle Amazon setup requirements`
   - Purpose: recognize Amazon verification immediately, expose incomplete onboarding
     safely, and preserve the readiness write guard.

The matching frontend commit and exact files are listed in its summary. Deployment
remains a separate task.
