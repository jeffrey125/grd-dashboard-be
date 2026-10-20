# SQ-V1-008: Add provider administration and connection tests

## Status

- Depends on: SQ-V1-004, SQ-V1-005
- State: implemented and fixture-verified; commit approval pending
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Give admins one settings surface for provider execution mode, availability, maintenance
message, stale-rate period, account-default refresh, and connection testing. Staff see
the effective settings but cannot change or override them.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [SQ-V1-004](SQ-V1-004-amazon.md)
- [SQ-V1-005](SQ-V1-005-unishippers.md)
- [Auth plan](../../auth-plan.md)

## Acceptance criteria

- Admins can choose `request` or `browser` independently for each provider. Staff cannot
  submit or retry with a different mode.
- Changing mode requires a connection test for the proposed mode. A passing test may be
  saved normally; after a failed test an admin may explicitly save with a visible warning
  and the sanitized failure summary is retained for review.
- Connection tests authenticate, resolve account/default context, and validate quote
  readiness without purchasing, booking, saving an address, or changing provider data.
- Admins can enable/disable a provider and set a maintenance message. Disabled providers
  are omitted from new comparisons, cannot be retried, and remain visible in history.
- Admins can configure the no-provider-expiry stale period; the default is 1 hour (approved SQ-V1-008 decision) and
  validation prevents non-positive or unreasonable values.
- The quote form refreshes selected providers' defaults on open and displays full details
  plus retrieval time. A last successful cached value is visibly stale and cannot be
  submitted as the default without a current refresh.
- Staff may initiate an allowed default refresh but cannot edit provider configuration
  or persist comparison-only sender corrections to the account.
- Settings and default metadata exclude credential values, cookies, tokens, and other
  browser storage. Admin audit identity/timestamps follow existing conventions.
- Existing comparisons and attempts retain their snapshotted mode/origin when settings
  change; only new attempts observe current settings.

## Verification

- Run backend authorization/e2e tests for every admin and staff operation, including the
  failed-test override, disable/retry race, and snapshot stability.
- Run adapter fixture tests proving connection tests are non-purchasing and sanitized.
- Run frontend tests for role visibility, warnings, maintenance state, default freshness,
  and 1-hour initial stale policy.
- Run both repositories' format, lint, typecheck, test, and build commands.

## Approved refinements

- Readiness only; sample-rate tests belong to SQ-V1-009.
- Test validity: 15 minutes, provider/mode/admin bound, explicit failed-test override.
- Stale hours: 1–168, default 1, current policy applies to historical quotes without expiry.
- Sender-default validity: 15 minutes; show stale cache and require refresh or explicit sender.
- Disable blocks queued/new work; already-running quotes may finish.

Implementation evidence: [SQ-V1-008 summary](../../implementation-summary/SQ-V1-008-implementation-summary.md).
