# SQ-V1-011 production follow-up

## Summary

Use the existing Amazon SDK with production credentials and the North America
production endpoint. Authorization succeeded; live rates remain blocked by the
registered pickup address check. No commit or deployment performed.

## Changes Made

Read neutral AMAZON_SP_API credential keys. Mark new Amazon attempts as live,
including failures; retain historical simulated flags. Update frontend settings
copy while retaining conditional sandbox warnings for history. No new dependency,
schema change, label purchase, or booking operation.

## Files Changed

Backend:

- `.env.example`: neutral production credential names.
- `src/modules/shipping-quotes/amazon-quote.adapter.ts`: endpoint, credentials,
  and simulation flags.
- `src/modules/shipping-quotes/amazon-quote.adapter.spec.ts`: production result expectations.
- `src/modules/shipping-quotes/amazon-api-configuration.spec.ts`: isolated SDK
  configuration and missing-credential tests.
- `test/integration/provider-readiness.spec.ts`: remove obsolete sandbox wording.
- `test/support/shipping-quotes/live-adapter-smoke.mts`: neutral credential keys.
- `README.md`: production usage and smoke instructions.
- `docs/v1/amazon-session-recovery.md`: current credential configuration.
- `docs/v1/frontend-handoff.md`: new live attempts versus simulated history.
- `docs/v1/shipping-quotes-readiness.md`: production readiness configuration.
- `docs/v1/shipping-quotes.md`: current production execution contract.
- This summary: verification and rollout limitations.

Frontend sibling:

- `src/features/shipping-quotes/pages/provider-settings-page.tsx`: production
  quote-only notice and authentication help text.
- `src/features/shipping-quotes/pages/provider-settings-page.test.tsx`: updated
  notice expectation.

## Verification

- `pnpm check`: passed formatting, lint, types, 348 unit tests, and build.
  Initial restricted run failed three localhost server tests with EPERM;
  unrestricted rerun passed all 348 tests.
- `pnpm exec vitest run --project integration test/integration/provider-readiness.spec.ts`:
  passed 1 test.
- Frontend `pnpm exec vitest run src/features/shipping-quotes/pages/provider-settings-page.test.tsx src/features/shipping-quotes/quote-progress.test.tsx`:
  passed 17 tests.
- Frontend `pnpm exec biome check` on the two changed files: passed.
- `git diff --check` in both repositories: passed.
- Live LWA token exchange with local production credentials: passed. Secrets
  were not printed or added to tracked files.
- Quote-only smoke with synthetic origin: validation_failed. Amazon returned
  PICKUP_ADDRESS_NOT_REGISTERED_WITH_SYSTEM.
- Temporary quote-only smoke using previously observed onboarding pickup address:
  same error. No rates returned and no booking performed.
- Frontend started at http://localhost:5173 and returned HTTP 200.
- Backend startup attempted: invalid local auth configuration; no API reachable.
- Full integration, browser, container, coverage, and frontend build checks not
  run for this targeted change. No deployment checks run.

## Review Notes

Existing SDKs were reused under the user's approved approach. Old sandbox key
names no longer work. Deploy backend and frontend together to align settings copy.
Backend worktree started clean. Frontend's pre-existing
`e2e-backend/tracking-review.spec.ts` change was left untouched.

## Remaining Issues

Confirm the current registered pickup address and API eligibility with Amazon.
Production rate success and end-to-end dashboard operation remain unverified.
Local API requires valid auth configuration. Deployment remains a separate step.

## Suggested Review Order

Adapter and configuration test, result tests, environment/smoke configuration,
frontend copy/test, then documentation. Proposed separate commits:

- Backend: `feat(shipping-quotes): SQ-V1-011 enable Amazon production API rates`
- Frontend: `fix(shipping-quotes): SQ-V1-011 show Amazon production mode`

Commit approval is required before staging or committing.
