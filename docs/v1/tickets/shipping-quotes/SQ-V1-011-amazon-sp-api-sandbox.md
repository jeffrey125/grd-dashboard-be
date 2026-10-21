# SQ-V1-011: Replace Amazon browser quoting with SP-API sandbox

## Status

- Depends on: SQ-V1-009
- State: implemented locally; pending review and commit
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## Outcome

Amazon Shipping quotes use the official Shipping API v2 contract through the
dynamic sandbox. The application no longer signs in to Amazon Shipping with
Playwright, stores Amazon browser sessions, or exposes CAPTCHA controls.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [Amazon API rate feasibility](../../amazon-shipping-api-rate-feasibility.md)
- [Amazon SP-API library evaluation](../../amazon-sp-api-library-evaluation.md)
- [Frontend handoff](../../frontend-handoff.md)
- [Database schema](../../database-schema.md)

## Acceptance criteria

- Amazon supports only the explicit `api` execution mode. Historical attempts
  retain their recorded `request` or `browser` mode.
- The worker authenticates with the three environment-only sandbox LWA values and
  calls Shipping v2 `getRates` with `AmazonShipping_US` and `EXTERNAL` channel.
- Each physical package produces one sandbox request. A comparison returns only
  services common to every package and sums exact package totals with Decimal.js.
- Amazon results are persisted as simulated. The UI displays **Amazon sandbox
  mode — test data, not live commercial prices** and never awards these results
  a Lowest price badge.
- Amazon browser login, encrypted session storage, verification socket/controller,
  CAPTCHA UI, operator CLI, and Amazon sender-default refresh are removed. The
  myUnishippers browser/request paths remain unchanged.
- Readiness verifies sandbox authentication without requesting a sample rate.
- A migration switches Amazon provider configuration to `api`, preserves historical
  attempt evidence, fails in-flight Amazon readiness tests, and clears the retired
  Amazon cached/default-refresh state.
- No purchase, label, shipment, pickup, or provider-account mutation is performed.

## Verification

- Run focused Amazon adapter, mode, readiness, sender-default, frontend warning,
  ranking, and provider-settings tests.
- Run backend and frontend format, lint, typecheck, build, and applicable suites.
- Run migrations against disposable PostgreSQL when a container runtime is
  available.
- Run the opt-in sandbox `getRates` smoke with populated local credentials; report
  only safe outcome/rate summary fields.
- Review both diffs and provide separate commit plans. Do not commit or deploy
  until explicitly approved.
