# SQ-V1-007: Complete quote history and retry lifecycle

## Status

- Depends on: SQ-V1-004, SQ-V1-005
- State: ready-for-agent
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Deliver the staff history experience and admin soft-delete lifecycle. Preserve partial
results and every attempt, allow eligible failed providers to retry from immutable
input, and apply expiry, stale, origin, currency, and ranking rules consistently.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [SQ-V1-004](SQ-V1-004-amazon.md)
- [SQ-V1-005](SQ-V1-005-unishippers.md)
- [Auth plan](../../auth-plan.md)

## Acceptance criteria

- Staff can list and view all comparisons, including input snapshots, actual provider
  origins, attempt chronology, execution modes, sanitized failures, and quote services.
- Partial success appears immediately and remains intact when another provider fails or
  is retried. Earlier failures and quotes are never overwritten.
- Retry creates a new attempt under the original comparison, uses the immutable original
  input, and uses the provider's mode current at retry start.
- Retry is unavailable for unsupported outcomes and rejected when the provider is
  disabled, the ship date has passed, or current validation rejects the input. The UI
  explains that a new comparison is required.
- Provider expiry is displayed when known. Otherwise the configured stale period is
  applied; stale and expired quotes remain readable history.
- Results sort and show **Lowest price** only when origin, native currency, destination,
  ship date, packages, and requested options are equivalent. Different origins or
  currencies show a warning and no overall winner.
- Admins can soft delete completed/failed comparisons and restore them. Staff cannot
  delete/restore, and queued/running comparisons cannot be deleted.
- Deleted history is excluded from normal staff lists but retained with all children.
  No permanent purge or attempt-cancellation behavior is introduced.
- Retrieval, attempt, result, expiry/stale, deletion, and restoration timestamps are
  rendered with clear labels.

## Verification

- Run backend integration/e2e tests for immutable retries, eligibility races, attempt
  preservation, stale/expiry calculation, authorization, soft delete, and restore.
- Run frontend tests for partial results, Retry states, ranking equivalence, warnings,
  timestamps, deleted-history administration, and refresh after SSE changes.
- Verify database children survive soft deletion and every FK remains no-action.
- Run both repositories' format, lint, typecheck, test, and build commands.
