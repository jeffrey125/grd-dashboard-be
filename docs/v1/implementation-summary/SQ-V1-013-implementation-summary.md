# SQ-V1-013: Runtime quote comparison feature flag

## Summary

Implemented the approved runtime switch for a tracking-only deployment. Set
`QUOTE_COMPARISON_ENABLED=false` on both API and worker, restart them, and refresh
the browser. There is no frontend build flag. The local ignored `.env` is set to
`false`; templates and runtime validation default to `false` for tracking-only
deployments.

## Changes Made

- Reused installed NestJS Config, Zod, and TanStack Query as approved. No new
  dependency, schema change, or migration.
- Added strict configuration and public, noncached `GET /api/v1/features`, which
  exposes only `quoteComparisonEnabled`.
- Added guards to quote, quote-event, and quote-provider administration APIs.
  Disabled authenticated requests return 404 before service execution.
- Prevented quote execution, provider readiness, and sender-default workers from
  scheduling or claiming work when disabled, including direct scan invocations.
- Hid quote navigation and blocked quote page contents in the frontend, including
  direct links. Metadata failures leave quote tools unavailable while tracking
  and unrelated administration remain accessible.
- Passed one shared flag through development/LAN Compose and the LAN environment
  generator. Existing quote data and queued work remain intact for re-enabling.

## Files Changed

Backend paths are relative to this repository:

- `.env.example`: documented native runtime switch.
- `.env.docker.example`: documented Compose runtime switch.
- `docker-compose.dev.yml`: passes the switch to API and worker.
- `README.md`: tracking-only and DigitalOcean environment instructions.
- `docs/v1/auth-api.md`: public metadata endpoint policy.
- `docs/v1/frontend-handoff.md`: metadata response and disabled API/UI contract.
- `docs/v1/shipping-quotes.md`: feature boundary and ticket reference.
- `docs/v1/tickets/shipping-quotes/SQ-V1-013-quote-feature-flag.md`: approved scope and acceptance criteria.
- This implementation summary: review and verification evidence.
- `src/app.module.ts`: registers HTTP feature metadata.
- `src/config/env.schema.ts`: strict boolean environment validation.
- `src/config/configuration.ts`: exposes the parsed runtime switch.
- `src/config/env.schema.spec.ts`: default, disabled, and invalid-value checks.
- `src/config/runtime-features.module.ts`: shared feature state and quote API guard.
- `src/runtime/runtime-features-http.module.ts`: public metadata controller.
- `src/modules/shipping-quotes/quote.module.ts`: guard dependency wiring.
- `src/modules/shipping-quotes/quote-worker.module.ts`: worker feature wiring.
- `src/modules/shipping-quotes/sender-defaults-worker.module.ts`: sender worker feature wiring.
- `src/modules/shipping-quotes/quote.controller.ts`: quote API guard.
- `src/modules/shipping-quotes/quote-events.controller.ts`: quote SSE guard.
- `src/modules/shipping-quotes/provider-admin.controller.ts`: provider admin guard.
- `src/modules/shipping-quotes/quote.worker.ts`: idle quote execution when disabled.
- `src/modules/shipping-quotes/provider-readiness.worker.ts`: idle readiness when disabled.
- `src/modules/shipping-quotes/sender-defaults.worker.ts`: idle default-address refresh when disabled.
- `src/modules/shipping-quotes/quote-feature-flag.spec.ts`: enabled/disabled scans and scheduler behavior without provider calls.
- `src/modules/shipping-quotes/provider-readiness.worker.spec.ts`: supplies explicit enabled feature state to existing worker tests.
- `src/infrastructure/logging/nest-logger.adapter.spec.ts`: updated typed configuration fixture.
- `src/infrastructure/logging/pino-logger.service.spec.ts`: updated typed configuration fixture.
- `test/e2e/quote-feature-flag.spec.ts`: real quote controller guards, public metadata, and unaffected health routes.
- `test/e2e/provider-admin.spec.ts`: supplies feature state to an existing direct worker fixture.
- `test/e2e/shipping-quotes.spec.ts`: supplies feature state to an existing direct worker fixture.

Frontend sibling paths:

- `src/features/runtime-features/api.ts`: validates feature metadata using Zod and the existing API client.
- `src/features/runtime-features/use-runtime-features.ts`: runtime query using TanStack Query.
- `src/features/runtime-features/index.ts`: feature-owned public export.
- `src/features/auth/session-boundary.tsx`: prevents disabled quote pages from mounting.
- `src/components/layout/app-shell.tsx`: filters quote navigation.
- `e2e/quote-feature-flag.spec.ts`: desktop/mobile disabled pages, no quote requests, and metadata-failure tracking access.
- `e2e/live-fixture.ts`: enabled metadata for existing isolated browser scenarios.
- `e2e/smoke.spec.ts`: recognizes the new public request in its strict request allowlist.
- `docker-compose.lan.yml`: shares the flag with API and worker.
- `scripts/prepare-lan-env.ts`: copies the flag into generated environments.
- `test/container/lan-config.test.ts`: asserts flag propagation to both processes.
- `test/container/http-runtime.test.ts`: proves the disabled flag in a real image.
- `test/container/runtime.test.ts`: proves the disabled default in a real image.
- `docs/v1/api-contracts.md`: frontend metadata and disabled-state contract.
- `docs/v1/lan-deployment.md`: tracking-only deployment instructions.

## Verification

- `pnpm check` (backend): passed formatting, lint, types, 351 unit tests, and build.
- Final backend `pnpm format:check && pnpm lint && pnpm typecheck && git diff --check`: passed.
- `pnpm exec vitest run --project e2e test/e2e/quote-feature-flag.spec.ts`: 2 passed.
- `pnpm check` (frontend): passed formatting, lint, types, unused-code checks, and 248 unit tests.
- Final frontend formatting, lint, types, unused-code, and diff checks: passed.
- Frontend build: passed; existing bundle-size and router tooling warnings remain.
- Focused Playwright feature flag, quote form, and shell tests: 10 passed across desktop/mobile.
- `pnpm test:acceptance` (frontend): passed, including 248 unit tests, 144 browser tests, 23 real-backend tests with 5 existing skips, 5 HTTPS/config checks, and 3 HTTP checks.
- `node --test test/container/lan-config.test.ts`: passed 1 fixture-only environment check.
- Backend container lifecycle: all 6 checks passed using a temporary copy of the existing test with its stale migration count changed from 15 to the actual 18. The tracked test remains unchanged; its original command still has that pre-existing failure.
- `pnpm test:cov:all`: passed 648 tests across 86 files; combined coverage is
  90.33% lines, 88.78% statements, 78.48% branches, and 91.84% functions.
- Isolated local API at `http://localhost:3001`: readiness HTTP 200; public features HTTP 200 with `quoteComparisonEnabled: false` and `no-store`.
- Frontend at `http://localhost:5173`: HTTP 200; proxied metadata reports false.
- One isolated review worker emitted `application.ready` without quote credentials. Only the disposable review database's three tracking carriers were disabled to prevent live I/O.

## Review Notes

One environment setting must match on both processes. Changes take effect after
restart; refresh existing browser sessions to read the current value. The default
is deliberately enabled. Feature metadata exposes no secrets and is not cached by
HTTP. The UI cannot override API guards. Existing auth/origin checks still apply
before quote guards; anonymous requests retain normal auth behavior.

No provider SDK, custom boolean parser, scheduler, or HTTP client was added. The
approved existing packages handle configuration, validation, HTTP, and querying.
The API and worker remain separate, with one review worker. Re-enabling resumes
retained queue work under the existing lease/recovery rules.

## Remaining Issues

- These feature-flag changes are not committed or deployed. The earlier approved
  Amazon production backend change is committed as `f6b747a`; its release image
  was prepared but never activated. DigitalOcean provisioning is not performed.
- Prior frontend Amazon production copy and deployment credential-name edits
  remain separate pending changes. The unrelated pre-existing
  `e2e-backend/tracking-review.spec.ts` diff remains untouched.
- The original backend container test hardcodes 15 migrations although there are
  18; the temporary corrected verification is explicitly distinguished above.
- If quotes are re-enabled, Amazon live rates still require registered pickup
  locations. Disabling quotes does not repair Amazon onboarding.
- Local review uses disposable data; it is not a deployed production environment.

## Suggested Review Order

Configuration and runtime feature module, controller guards, worker gates,
frontend query/session boundary/navigation, tests, then deployment/docs.

Proposed single-purpose commits, subject to final approval:

1. Backend: `feat(shipping-quotes): SQ-V1-013 add runtime quote comparison switch`
   — all backend feature-flag files listed above.
2. Frontend: `fix(shipping-quotes): SQ-V1-011 show Amazon production mode`
   — only the two existing provider-settings page/copy test files.
3. Frontend: `fix(deploy): SQ-V1-011 pass Amazon production credentials to worker`
   — only prior neutral-credential changes in Compose, environment generator,
   deployment documentation, and their container/config fixtures.
4. Frontend: `feat(shipping-quotes): SQ-V1-013 gate quote comparison with runtime flag`
   — frontend feature-flag files and flag-specific deployment/test/doc hunks.

No staging or commit for this new feature is performed without approval.
