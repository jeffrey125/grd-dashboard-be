# SQ-V1-006 implementation summary

## Summary

Implemented international quote inputs, exact customs totals, provider eligibility,
unit-conversion snapshots, signature, and insurance across the backend and frontend.
Amazon is unavailable for international destinations. myUnishippers international
and option requests are available only in the verified browser mode and currently
map USD customs and insurance values.

## Changes Made

- Added summary and detailed international customs contracts. Detailed mode records
  per-box items and verifies total value as item quantity multiplied by unit value and
  identical-box quantity with `decimal.js`.
- Added `used_internationally` provider capability data and shared pre-queue eligibility.
  Unsupported providers receive a durable `unsupported` attempt while eligible providers
  continue. Amazon is disabled in the form for international destinations.
- Preserved original imperial or metric values and added immutable per-attempt conversion
  snapshots with provider values, constants, six-decimal precision, and half-up rounding.
- Mapped the verified myUnishippers Canada browser fields: destination country/province,
  label contents, total customs value, signature, and insured value per box. Request mode,
  non-USD values, and unsupported routes fail closed.
- Exposed provider international, signature, and insurance capabilities. The form only
  renders supported controls, calculates aggregate insurance and detailed customs totals
  with `decimal.js`, and distinguishes customs value from insurance coverage.
- Exposed native currency and explicit option, duty, tax, and clearance status without
  estimating landed cost or converting currencies.
- Replaced duplicated queue-eligibility checks with one feature-owned domain policy.

## Files Changed

- `src/modules/shipping-quotes/quote.schemas.ts`, `quote.schemas.spec.ts`,
  `quote-decimal.ts`, and `quote-provider-eligibility.ts`: international contracts,
  exact totals, and shared provider policy.
- `src/modules/shipping-quotes/quote-conversions.ts`, provider adapters, contracts, and
  fixture tests: exact documented conversions and verified provider mappings.
- `src/modules/shipping-quotes/quote.service.ts`, repositories, executor, worker, entity,
  controllers, and API tests: capability discovery, durable unsupported attempts,
  conversion snapshots, and result status fields.
- `src/infrastructure/database/migrations/1792886400000-InternationalQuoteOptions.ts`,
  integration support, and schema tests: provider international capability and immutable
  attempt conversion snapshots.
- Frontend `schemas.ts`, `quote-decimal.ts`, `quote-form.tsx`, detail page, and tests:
  conditional international/customs UI, provider disabling, and exact displayed totals.
- `docs/v1/database-schema.md` and `docs/v1/shipping-quotes.md`: persistence,
  eligibility, precision, and verified-provider behavior.
- `package.json` and `pnpm-lock.yaml` in both repositories: approved `decimal.js` use.
- Previously approved audit changes in this working tree adopt Zod, Node timers, Nest
  CORS/SSE, RxJS, Bottleneck, TanStack Query, and `use-debounce` in their relevant areas.

## Verification

- Backend `pnpm format && pnpm check`: passed formatting, lint, typecheck, 306 unit tests
  in 32 files, and build after the final eligibility consolidation. The restricted
  sandbox initially blocked three loopback notification tests with `listen EPERM`; the
  unchanged gate passed with the required test-server permission.
- Backend targeted API/provider/schema verification: 3 files and 40 tests passed after
  the final eligibility consolidation.
- myUnishippers browser fixture: 11 tests passed, including international inputs and
  positive option mappings.
- Disposable PostgreSQL migration lifecycle: build plus 10 integration tests passed;
  all migrations applied, reverted, and reapplied without schema drift.
- Frontend `pnpm format && pnpm check && pnpm build`: passed formatting, lint, typecheck,
  Knip, 193 tests in 32 files, and production build. Vite retained its existing chunk-size
  warning.
- Local API `http://localhost:3013/api/v1`, frontend `http://localhost:5173/`, and the
  frontend API proxy all returned HTTP 200 and remain available for manual testing.
- Final frontend formatting, lint, typecheck, and both repository diff checks passed.

## Review Notes

- Later approved product decisions supersede the original ticket's narrower customs rule:
  users may choose a summary or enter detailed per-box items for every group.
- Currency values remain decimal strings. `decimal.js` owns arithmetic and rounding;
  JavaScript binary floating-point is not used for money or unit calculations.
- `used_internationally` records carrier eligibility. Availability also requires a verified
  execution mode and currency mapping, so myUnishippers request mode is shown as unavailable
  and Amazon is unavailable internationally.
- The provider screenshots expose no customs or insurance currency selector. The verified
  browser mapping therefore accepts USD only and persists other currencies as unsupported.
- No new foreign key was required. The migration extends existing tables and protects the
  new attempt snapshot with the existing immutability trigger.

## Remaining Issues

- The final browser mapping is fixture-verified, not re-run against live provider accounts;
  tests do not load local provider credentials.
- The full combined integration suite, whole-backend coverage, and opt-in container suite
  were not run for this change. The migration lifecycle and ticket-focused integration paths
  were run with disposable PostgreSQL.
- Additional codebase-wide library replacements are recommendations outside SQ-V1-006 and
  require separate production-dependency approval where applicable.
- No commit, deployment, or semantic-version tag has been created.

## Suggested Review Order

1. International schemas, exact decimal calculations, and shared eligibility policy.
2. Migration, repository persistence, and unsupported-attempt behavior.
3. myUnishippers/Amazon mappings and fixture tests.
4. Frontend form, detail display, and frontend tests.
5. Documentation and the previously approved library audit changes.
