# SQ-V1-011 Amazon SP-API sandbox implementation

## Summary

Amazon Shipping quote execution now uses Shipping API v2 through Amazon's dynamic
sandbox. The browser login, session persistence, CAPTCHA bridge, verification API,
and operator CLI were removed. Amazon results remain explicitly simulated until a
separate production-access change is approved and implemented.

## Changes Made

- Added the approved `@sp-api-sdk/auth` and `@sp-api-sdk/shipping-api-v2`
  production dependencies.
- Added sandbox LWA authentication and typed `getRates` calls using
  `AmazonShipping_US` and the `EXTERNAL` channel.
- Sends one request per physical package, including package and item weight, then
  sums only services common to every package with Decimal.js.
- Added provider-aware execution modes: Amazon accepts only `api`, while
  myUnishippers retains `request` and `browser`.
- Added a migration that switches Amazon configuration to `api`, preserves
  historical attempt modes, fails in-flight Amazon readiness checks, and clears
  retired cached sender defaults.
- Removed the Amazon browser/session/verification runtime and made Amazon sender
  entry explicit. myUnishippers browser behavior is unchanged.
- Removed Amazon from the legacy request/browser contract fixtures and live smoke;
  the retained Playwright harness is myUnishippers-only.
- Added early Amazon API address limits and a 100-physical-package cap in both
  submission validation and the frontend contract.
- Applied those current Amazon API limits to historical retry eligibility so an
  obsolete browser/request attempt cannot queue a guaranteed API rejection.
- Updated tests, environment examples, operator documentation, database schema,
  frontend handoff, and the opt-in live smoke command.
- Deployed LAN release `20261022-03`, applied migration 16, and verified the live
  worker authenticates to the Amazon sandbox API without browser resources.

## Files Changed

- `package.json`, `pnpm-lock.yaml` — add the approved modular Amazon SDK packages.
- `src/modules/shipping-quotes/amazon-quote.adapter.ts` — implement the sandbox API
  adapter and multi-package aggregation.
- `src/modules/shipping-quotes/provider-execution-mode.ts` — centralize valid
  execution modes per provider.
- `src/infrastructure/database/migrations/1793145600000-AmazonApiMode.ts` — migrate
  current Amazon state without rewriting historical execution evidence.
- `src/modules/shipping-quotes/*` and `src/amazon-session-cli.ts` — remove Amazon
  browser verification/session components and update worker, repository, schema,
  and sender-default composition.
- `test/**` and colocated specs — cover API payloads, aggregation, readiness,
  provider administration, migration behavior, and the live sandbox path.
- `.env.example`, `README.md`, and `docs/v1/**` — document the sandbox-only
  credentials, warning, API mode, retired VM resources, and current contracts.

## Verification

- `pnpm lint` — passed with zero warnings.
- `pnpm typecheck` — passed.
- `pnpm test` — passed: 36 files, 327 tests.
- `pnpm build` — passed.
- Focused migration/contract integration run — passed: 5 files, 18 tests.
- `pnpm test:e2e` — passed: 9 files, 70 tests.
- Opt-in SDK sandbox smoke — passed: two physical packages, one common service,
  calculated total `35.060000 USD`, simulated result.
- `pnpm audit --prod` — no known vulnerabilities found.
- `git diff --check` — passed.
- Prettier check over every intended changed/new file — passed.
- Full `pnpm test:integration` — completed 34 files/204 tests successfully and
  found one stale expected migration count in `database-tls.spec.ts`; after the
  count was corrected, its targeted rerun passed all 6 tests.
- Full `pnpm check` — format stage is blocked by the unrelated pre-existing
  untracked `docs/v1/amazon-solution-provider-verification-client-guide.md`;
  the remaining lint, typecheck, unit, and build stages were run separately and
  passed.
- LAN deployment — archive checksum matched locally/remotely; mode-600 database
  and environment backups were created; API, frontend, database, and the single
  worker are healthy on release `20261022-03`; `/healthz` and
  `/api/v1/health/ready` passed; migration count is 16.
- Live Admin readiness — Amazon is enabled in `api` mode, all three sandbox
  credentials are present in the worker, and the readiness check passed.

## Review Notes

- Amazon sandbox responses are never eligible for a live-price claim. The adapter
  sets `simulated: true`; the frontend supplies the visible warning and excludes
  every simulated rate from Lowest price.
- Amazon currently supports one package per shipment, so GRD intentionally makes
  one API request per physical package. A quote is returned only when every package
  exposes the same carrier/service/currency key.
- The sandbox validates item weight even though package weight is also supplied.
  A regression assertion protects this live-discovered contract requirement.
- Amazon input validation rejects address fields outside the verified API limits
  and totals above 100 physical packages before authenticating or allocating the
  expanded package list.
- The migration changes only current provider configuration. Historical attempts
  continue accepting `request` and `browser` so audit evidence remains readable.
- No label purchase, shipment creation, pickup action, or production Amazon call is
  performed.

## Remaining Issues

- Production Amazon access, commercial rate-card validation, and production
  credentials remain external onboarding work.

## Suggested Review Order

1. `docs/v1/tickets/shipping-quotes/SQ-V1-011-amazon-sp-api-sandbox.md`
2. `src/modules/shipping-quotes/amazon-quote.adapter.ts` and its spec
3. `src/modules/shipping-quotes/provider-execution-mode.ts` and the migration
4. Worker/repository/sender-default removals and backend E2E changes
5. Dependency, environment, and documentation changes
