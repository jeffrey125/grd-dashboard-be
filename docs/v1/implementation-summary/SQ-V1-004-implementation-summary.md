# SQ-V1-004 implementation summary

## Summary

Implemented the Amazon Shipping domestic quote path across the worker, persistence
projection, API contract, and frontend result view. The adapter uses the selected
request or browser mode, keeps Playwright session context in worker memory, refreshes
the protected entry page and bootstrap context for each quote action, supports one
executor-controlled relogin, deduplicates compatible package groups, and labels
multi-package totals as calculated estimates.

## Changes Made

- Added `AmazonShippingAdapter` with dynamic proposal/bootstrap resolution, in-page
  request mode, native browser mode, environment-only credentials, bounded login and
  rate operations, explicit authentication/validation/unsupported outcomes, and no
  cross-mode fallback.
- Added exact six-decimal money normalization for Amazon totals and charge lines.
  Known package, shipment, and pickup scopes are preserved; unknown scopes fail the
  estimate instead of being multiplied by assumption.
- Added signature deduplication, metric-to-imperial conversion, package-only
  multiplication, one-time shipment/pickup fees, group contribution totals, and the
  verified USD 13.81 / USD 27.62 fixture behavior.
- Persisted normalized charge rows through the existing `shipping_quote_items` table
  and added the reversible `1792713600000-AmazonQuoteBreakdown` migration for the
  immutable `shipping_quotes.group_contributions` JSON snapshot. The public response
  exposes platform, charges, and group contributions. The frontend renders the
  platform/carrier/service, single-package or calculated-estimate label, charge
  breakdown, group quantities, and **Not provided** fallbacks without adding purchase
  or booking actions.
- Preserved the approved decisions: selected ship date is retained without an
  additional warning, and Amazon options/routes outside the verified domestic
  contract return explicit unsupported outcomes.

## Files Changed

- `src/modules/shipping-quotes/amazon-quote.adapter.ts` — Playwright adapter,
  response normalization, exact aggregation, and safe provider outcomes.
- `src/modules/shipping-quotes/amazon-quote.adapter.spec.ts` — fixture normalization,
  scope, deduplication, and calculated-estimate regression tests.
- `src/modules/shipping-quotes/quote-worker.module.ts` — production Amazon adapter
  wiring while retaining the isolated fixture mode.
- `src/modules/shipping-quotes/quote-execution.repository.ts` and
  `src/modules/shipping-quotes/quote.schemas.ts` — charge, group contribution, and
  platform contracts.
- `src/modules/shipping-quotes/typeorm-quote-execution.repository.ts` and
  `src/modules/shipping-quotes/typeorm-quote.repository.ts` — charge persistence and
  public projection.
- `src/modules/shipping-quotes/quote.entity.ts`,
  `src/infrastructure/database/migrations/1792713600000-AmazonQuoteBreakdown.ts`,
  `test/support/shipment-database.ts`, and migration/schema checks — durable group
  contribution storage and schema verification.
- `test/integration/quote-execution.spec.ts` — PostgreSQL persistence regression for
  charge lines and group contributions.
- `src/features/shipping-quotes/schemas.ts`, `quote-progress.tsx`, and
  `quote-progress.test.tsx` in `grd-dashboard-fe` — response validation and result
  breakdown rendering.
- `README.md`, `docs/v1/shipping-quotes.md`, `docs/v1/database-schema.md`,
  `docs/v1/frontend-handoff.md`, and the SQ-V1-004 ticket — runtime, persistence,
  API, and ticket status documentation.

## Verification

- `pnpm typecheck` — passed.
- `pnpm build` — passed.
- `pnpm lint` — passed.
- `pnpm exec prettier --check` on changed backend files — passed.
- `pnpm exec vitest run --project unit src/modules/shipping-quotes/amazon-quote.adapter.spec.ts src/modules/shipping-quotes/quote-executor.spec.ts` — passed, 13 tests, including request-mode, browser-mode response matching, and per-action bootstrap refresh fixtures.
- Frontend `pnpm typecheck` — passed.
- Frontend `pnpm format:check` and `pnpm lint` — passed.
- `git diff --check` in both repositories — passed.
- Backend `pnpm check` reached the unit suite; three pre-existing notification tests
  fail because the sandbox rejects `listen` with `EPERM` on `127.0.0.1`. The other
  286 unit tests pass.
- Frontend `pnpm check` reached Vitest after format, lint, typecheck, and Knip passed;
  Vitest cannot bundle its config because the sandbox makes
  `grd-dashboard-fe/node_modules/.vite-temp` read-only (`EROFS`).
- PostgreSQL integration/e2e checks could not start because Testcontainers found no
  working container runtime. Live Amazon smoke tests were not run because no live
  credentials were supplied. Chromium-backed tests cannot launch in this sandbox
  (`sandbox_host_linux.cc` reports `Operation not permitted`); the adapter fixture
  tests use deterministic Playwright page/context doubles instead.
- The opt-in container lifecycle check was not run because Docker is unavailable in
  the environment.
- Backend `pnpm start:prod` and frontend `pnpm dev --host 127.0.0.1` could not stay
  running: the backend lacked usable runtime configuration/port availability and
  Vite could not write its read-only `.vite-temp` directory. No local URLs are
  available from this sandbox.

## Review Notes

The adapter records the execution mode selected by the provider row before the
external call, and a request failure never switches to browser mode. Each quote
action reloads the protected entry page and captures fresh merchant/proposal/XSRF
context while reusing only the worker-memory browser session. A worker restart creates
a fresh Playwright context and logs in again; the executor reserves at most one
relogin before replaying the same mode. Amazon's observed response does not provide
verified transit or expiry semantics, so those values remain null unless a
fully-qualified provider timestamp is returned. Unknown charge codes remain an
explicit unsupported outcome.

The existing myUnishippers production adapter remains deferred to SQ-V1-005; a
comparison selecting both providers therefore shows Amazon success independently of
the myUnishippers failure/unavailable attempt. The existing sender-default worker
continues to show refreshed Amazon address details and retrieval time before a default
sender can be saved.

## Remaining Issues

Container-backed PostgreSQL integration, frontend Vitest, full e2e/SSE verification,
and opt-in live Amazon request/browser smoke checks remain unverified for the
environmental reasons recorded above. No provider credential or raw response was
persisted.

## Suggested Review Order

1. `amazon-quote.adapter.ts` and its focused tests.
2. Execution result types, TypeORM charge persistence, and comparison projection.
3. Frontend response schema and `QuoteProgress` breakdown rendering.
4. Integration regression, documentation, and ticket status.
