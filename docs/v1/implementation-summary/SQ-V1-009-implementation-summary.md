# SQ-V1-009 implementation summary

## Summary

Added executable quote readiness evidence across backend and frontend. Release
readiness remains incomplete: current live sample-rate checks returned no successful
rates. Offline acceptance and final review results are recorded below.

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

## Files Changed

| Backend file                                             | Purpose                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `test/integration/quote-readiness.spec.ts`               | Actual worker crash, concurrency, natural lease recovery and safe log evidence.          |
| `test/integration/quote-live-smoke.spec.ts`              | Missing-credential and selected-provider/mode CLI behavior.                              |
| `test/e2e/shipping-quotes.spec.ts`                       | Raw failure privacy, authorized contact retention, synthetic receiver and SSE allowlist. |
| `test/support/shipping-quotes/live-adapter-smoke.mts`    | Both live providers/modes and sanitized outcome reporting.                               |
| `README.md`                                              | Smoke usage and readiness documentation link.                                            |
| `docs/v1/shipping-quotes-readiness.md`                   | Acceptance map, commands, operations, privacy and live blockers.                         |
| `docs/v1/tickets/shipping-quotes/SQ-V1-009-readiness.md` | Approved privacy clarification.                                                          |
| This summary                                             | Review and verification evidence.                                                        |

Frontend changes are listed in its matching summary: readiness browser test,
fixture adapter/harness, migration count assertion and verification documentation.

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

No new foreign key, production dependency or production application change was
needed. Tests/documentation remain uncommitted pending final approval.

## Remaining Issues

- Live rates unverified for all four provider/mode combinations; safe summaries do
  not identify the root cause of sender/login resolution failures.
- Repository-wide formatting includes an unrelated pre-existing unformatted preview.
- Subsequently requested deployment to `debian-vm` is blocked: SSH to
  `192.168.100.83:22` returns `No route to host`; no remote mutation occurred.

## Suggested Review Order

1. Worker recovery and API/SSE privacy tests.
2. Live smoke command and CLI regression tests.
3. Frontend readiness fixture and real-backend browser tests.
4. Readiness matrix, ticket privacy decision and both summaries.

## Proposed commits — final approval required

1. `test(shipping-quotes): SQ-V1-009 cover both live provider modes`
   - Files: `test/support/shipping-quotes/live-adapter-smoke.mts`,
     `test/integration/quote-live-smoke.spec.ts`.
   - Purpose: independently selectable live checks, bounded relogin, sanitized
     output and explicit missing-credential behavior.
2. `test(shipping-quotes): SQ-V1-009 verify recovery and privacy readiness`
   - Files: `test/integration/quote-readiness.spec.ts`,
     `test/e2e/shipping-quotes.spec.ts`, `README.md`,
     `docs/v1/shipping-quotes-readiness.md`,
     `docs/v1/tickets/shipping-quotes/SQ-V1-009-readiness.md`, this summary.
   - Purpose: executable offline acceptance, privacy clarification, operational
     evidence and honest live release blockers.

Frontend commits and exact files are listed in its matching summary. Nothing is
staged or committed. The requested deployment does not imply commit approval.
