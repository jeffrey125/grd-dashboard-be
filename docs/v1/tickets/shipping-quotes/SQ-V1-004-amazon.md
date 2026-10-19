# SQ-V1-004: Deliver Amazon Shipping quotes end to end

## Status

- Depends on: SQ-V1-001, SQ-V1-003
- State: ready-for-agent
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Implement the Amazon Shipping adapter for admin-selected request or browser execution.
Show account-default origin details, execute domestic quotes, normalize service/charges,
and calculate clearly labelled multi-package estimates from compatible single-package
rates.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [SQ-V1-001](SQ-V1-001-provider-contracts.md) and verified Amazon fixtures
- [SQ-V1-003](SQ-V1-003-async-sse.md)
- [`amazon-rate-evidence.json`](../../../../artifacts/shipping-calculator-findings/amazon-rate-evidence.json)

## Acceptance criteria

- Playwright login resolves the authenticated Amazon account/proposal context and keeps
  cookies/tokens in worker memory only. Restart and one controlled relogin work.
- Request mode calls the verified quote contract from inside the authenticated
  Playwright page; browser mode drives the estimator and captures the matching response
  or validated visible result. The attempt records the selected mode and there is no
  automatic mode fallback.
- The form displays Amazon's refreshed default origin details and retrieval time before
  using them, with an explicit-sender path when available under the verified contract.
- One provider call is made per distinct rating signature. Identical compatible boxes
  reuse the result and multiply only package-scoped transportation charges.
- Groups are summed without multiplying pickup/shipment-level fees. The result is marked
  **calculated estimate** and exposes how group quantities contributed.
- Platform, delivering carrier, service, total/currency, transit data, retrieval/expiry,
  and returned charge lines are normalized without invented values.
- Missing values display **Not provided**. Unsupported routes/options return explicit
  outcomes and do not masquerade as successful coverage.
- The known sanitized 10 x 8 x 6 inch, 5 lb fixture reproduces the normalized USD 13.81
  single-package result and USD 27.62 two-identical-package estimate.
- The UI renders Amazon partial success independently of myUnishippers and contains no
  purchase, accept-rate, label, booking, pickup, or **Use this rate** action.

## Verification

- Run adapter contract tests for request and browser fixtures, signature deduplication,
  grouping, charge scope, unsupported outcomes, and relogin limits.
- Run backend integration/e2e tests through worker persistence and SSE.
- Run frontend tests for default origin, calculated-estimate disclosure, breakdown, and
  partial/error rendering.
- Run an opt-in live quote-only smoke test in each configured mode when credentials are
  available, then run both repositories' standard quality gates.
