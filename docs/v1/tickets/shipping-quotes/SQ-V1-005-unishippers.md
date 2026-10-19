# SQ-V1-005: Deliver myUnishippers quotes end to end

## Status

- Depends on: SQ-V1-001, SQ-V1-003
- State: ready-for-agent
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Implement the myUnishippers small-package adapter for admin-selected request or browser
execution. Send native multi-package shipments, preserve actionable provider validation,
and allow a comparison-only sender correction without changing the account address.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [SQ-V1-001](SQ-V1-001-provider-contracts.md) and verified myUnishippers fixtures
- [SQ-V1-003](SQ-V1-003-async-sse.md)
- [`unishippers-success-evidence.json`](../../../../artifacts/shipping-calculator-findings/unishippers-success-evidence.json)

## Acceptance criteria

- Playwright login resolves Auth0/session, organization, billing, and default-origin
  context dynamically and retains session material in worker memory only.
- Request mode calls the verified shop contract from inside the authenticated Playwright
  page; browser mode drives the small-package form and captures the matching response or
  validated visible services. The attempt records the selected mode and there is no
  automatic mode fallback.
- All package groups and quantities are submitted as one native shipment request. The
  adapter uses each offer's whole-shipment total and never multiplies it again.
- The refreshed account default and retrieval time are visible before submission. The
  actual origin sent is preserved on the attempt.
- The 35-character sender-company error maps to a specific actionable validation result.
  A user can supply a comparison-only correction; the application does not truncate or
  persist it to the provider account.
- Platform myUnishippers is distinct from delivering carrier UPS in stored and displayed
  results.
- The sanitized two-box fixture reproduces all seven normalized services, including UPS
  Ground at USD 24.16, with charge and transit metadata where returned.
- Option coverage, expiry ambiguity, unsupported routes, and missing values remain
  explicit. No raw payload, session token, or account identifier is persisted.
- The UI renders myUnishippers partial success independently of Amazon and exposes no
  purchase, label, booking, pickup, address-book Save, or **Use this rate** action.

## Verification

- Run adapter contract tests for request and browser fixtures, native quantities,
  whole-total handling, validation mapping, correction isolation, and relogin limits.
- Run backend integration/e2e tests through worker persistence and SSE.
- Run frontend tests for default origin, sender correction, multi-package disclosure,
  service list, and partial/error rendering.
- Run an opt-in live quote-only smoke test in each configured mode when credentials are
  available, then run both repositories' standard quality gates.
