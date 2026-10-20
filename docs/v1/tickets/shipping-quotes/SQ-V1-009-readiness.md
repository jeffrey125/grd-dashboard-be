# SQ-V1-009: Verify shipment quote release readiness

## Status

- Depends on: SQ-V1-006, SQ-V1-007, SQ-V1-008
- State: offline verification implemented; live sample-rate release gate blocked
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Close the calculator release gate with full-stack acceptance coverage, operational
recovery evidence, privacy review, and executable documentation. Fix defects found by
the gate within this feature; do not expand into purchase or shipment creation.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- Every SQ-V1 implementation ticket and handoff
- [Release readiness](../../release-readiness.md)
- [Frontend handoff](../../frontend-handoff.md)
- [Tracking source-data policy](../../tracking-source-data-policy.md)

## Acceptance criteria

- A fresh PostgreSQL database migrates successfully and the API, worker, and frontend
  start independently using documented commands.
- An authenticated staff user can create domestic and international comparisons, observe
  live partial progress over SSE, inspect results, revisit history, and retry an eligible
  provider failure.
- An admin can test/change provider mode, disable/enable a provider with maintenance
  messaging, change stale policy, refresh defaults, soft delete, and restore history.
- Request and browser modes pass fixture-backed acceptance for both providers. Opt-in live
  quote-only smoke results are recorded separately and never become mandatory offline CI.
- Worker restart during an attempt proves lease recovery; provider-account serialization
  and cross-provider parallelism pass under concurrency.
- Duplicate submissions prove idempotency. SSE reconnect proves snapshot refetch. Provider
  auth expiry proves one relogin/replay and no unbounded retry.
- Amazon and myUnishippers calculated estimates remain visibly identified across
  multiple package groups; myUnishippers uses captured Quick Quote requests.
- International capability, units, native currency, requested options, and duty/tax
  status never imply unsupported coverage or automatic conversion/landed cost.
- Automated and manual privacy review finds no credentials, cookies, tokens, external
  provider-account identifiers, or raw provider payloads in logs, database rows, tracked
  fixtures, SSE events, or frontend error output. Required sender/recipient addresses and
  contacts remain in authenticated business snapshots for history and retry. Personal
  contact data is excluded from logs, SSE, diagnostics, error output, and live captures;
  tracked fixtures use synthetic contacts. This SQ-V1-009 decision preserves the
  previously approved SQ-V1-005 contact snapshots.
- Documentation lists environment variable names, startup/migration commands, test
  commands, provider operational limits, troubleshooting, and all deferred scope.
- The UI contains no purchase, label, booking, pickup, provider-address Save, shipment
  creation, or **Use this rate** action.

## Verification

- Run both repositories' complete format, lint, typecheck, unit, integration/e2e, and
  production build gates and record exact results.
- Run migrations against an empty real PostgreSQL database and exercise API/worker
  startup plus the frontend/backend reachability checks required by repository policy.
- Run the full acceptance matrix for roles, modes, providers, package counts, partial
  failure, restart, SSE reconnect, retry, international, options, history, and admin.
- Review the final diffs for unrelated changes and complete each repository's structured
  implementation and commit handoff without committing until the user approves.

## SQ-V1-008 handoff

Connection tests in provider administration check readiness only. Run the opt-in
sample-rate tests in this ticket, including each provider's selected request/browser
mode; a readiness pass alone is not evidence of a successful rate response.

Implementation evidence: [SQ-V1-009 summary](../../implementation-summary/SQ-V1-009-implementation-summary.md) and [readiness matrix](../../shipping-quotes-readiness.md).
