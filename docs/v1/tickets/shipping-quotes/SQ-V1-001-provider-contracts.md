# SQ-V1-001: Verify provider quote contracts

## Status

- Depends on: none
- State: harness implemented; domestic modes live verified; capability and reliability limits documented
- Repositories: `grd-dashboard-be`; documentation evidence only in `grd-dashboard-fe`

## What to build

Turn the existing browser observations into reproducible, sanitized provider-contract
fixtures and a capability matrix for Amazon Shipping and myUnishippers. Verify the
minimum login/bootstrap/default-sender/rate contract for request mode and a reliable
Playwright form path for browser mode. Keep all activity quote-only.

This ticket is the research gate for implementation. It may add test harnesses and
fixtures, but it must not add production quote endpoints or database tables.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [`artifacts/shipping-calculator-findings/`](../../../../artifacts/shipping-calculator-findings/)
- [Architecture](../../architecture.md)
- [Tracking source-data policy](../../tracking-source-data-policy.md)

## Acceptance criteria

- A deterministic Playwright login harness verifies both providers with the four named
  environment variables, detects authentication challenges, and never logs secrets.
- Sanitized fixtures cover successful domestic quotes, provider validation errors,
  authentication expiry/relogin, and unsupported route/capability outcomes.
- Request mode performs the quote HTTP call from inside the authenticated Playwright
  page. Its minimum cookies, tokens, headers, identifiers, refresh/expiry behavior, and
  bootstrap calls are documented without secret values. A standalone HTTP client is
  outside the required design.
- Browser mode reaches and reads a successful quote for each provider using stable
  semantic locators or documents a concrete provider blocker with reproducible evidence.
- The capability matrix records domestic/international lane support, account-default
  retrieval, units, package quantity behavior, signature, insurance/declared value,
  duty/tax status, charge scopes, transit data, and quote expiry.
- International and positive-option behavior is verified with sanitized fixtures where
  live verification is safe; unverified fields remain explicitly unverified and block
  dependent provider mapping rather than being guessed.
- Amazon identifiers and myUnishippers organization/billing identifiers are resolved
  dynamically. No observed account identifier is hardcoded.
- Captures exclude credentials, cookies, authorization/session tokens, personal contact
  data, and raw full provider payloads. No provider account/address change is saved.

## Verification

- Run the contract-fixture tests and login/browser harness in mocked mode.
- Run opt-in live quote-only smoke checks for both modes when local credentials and an
  approved test route are available; report each mode separately.
- Run backend format, lint, typecheck, unit tests, and build for any code added.
- Inspect tracked and untracked artifacts for authentication or personal data before
  handoff.

## Evidence

- [Implementation issues and follow ups](SQ-V1-001-issues.md)
- [SQ-V1-001 contract matrix](SQ-V1-001-contract-matrix.md)
- [Implementation summary](../../implementation-summary/SQ-V1-001-implementation-summary.md)
- Deterministic Playwright and fixture verification:
  `pnpm exec vitest run --project integration test/integration/shipping-quotes-contracts.spec.ts`
- Optional live quote-only verification:
  `pnpm test:shipping-quotes:live -- --provider unishippers` or
  `pnpm test:shipping-quotes:live -- --provider amazon --interactive`
