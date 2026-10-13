# V1-011: Implement tracking persistence and outcome transactions

## Status

Depends on V1-008.

Implemented in the working tree on 2026-10-13. Awaiting final review and commit.

## Objective

Implement repositories and application operations for tracking runs, attempts, immutable snapshots, and atomic Shipment outcome updates.

## Required reading

- [`../database-schema.md`](../database-schema.md), snapshot/run/attempt and transaction sections
- [`../tracking-behavior.md`](../tracking-behavior.md), normalized state and outcomes
- [`../tracking-source-data-policy.md`](../tracking-source-data-policy.md)

## Scope

- Implement tracking entity mappings, repository contracts, TypeORM implementations, and application service operations.
- Create/start/finalize runs and create/finalize exactly one logical attempt per Shipment per run.
- For `found`, merge missing Carrier fields with known state, compare the complete normalized snapshot, insert only on change, and update the pointer/attempt/Shipment atomically.
- Implement `not_found`, threshold pause at 5, `failed`, `skipped`, delivered completion, scheduling metadata, and optimistic concurrency behavior.
- Integrate V1-008's Carrier reference-policy URL builder: populate a null
  verification URL only after a successful lookup and retain it through failures.
  Respect Shipment version/deletion checks and manual pause/resume state so a
  concurrent management operation cannot be overwritten by stale tracking work.
- Store only sanitized allowlisted `source_data`; no raw artifact storage.

## Acceptance criteria

- Transaction behavior exactly matches `database-schema.md`.
- An unchanged `found` attempt references the existing snapshot and sets `snapshot_changed = false`.
- One through four consecutive not-found outcomes remain active; the fifth pauses and clears `next_check_at`; `found` resets the counter; failure leaves it unchanged.
- A Shipment can never reference another Shipment's snapshot.
- Partial run success is summarized correctly without rolling back other finalized attempts.
- Repository integration tests cover every outcome, rollback on injected failure, stale optimistic versions, ownership safety, and source-data object validation.

## Verification

Run tracking unit and PostgreSQL integration suites, migration regression, typecheck, and build.

## Approved implementation decisions

- Store optional adapter-sanitized, allowlisted `source_data` objects unchanged
  for `found`, `not_found`, and `failed`; `skipped` always stores null. Raw
  Carrier responses and artifacts remain prohibited.
- Treat `skipped` as neutral for run summaries. A run succeeds when no attempt
  failed, partially succeeds when failed and non-failed outcomes are mixed, and
  fails when every attempt failed.
- A stale Shipment version or deletion finalizes the pending attempt as
  `skipped` with `SHIPMENT_STATE_CHANGED` and leaves every Shipment field intact.
- Create all target attempts as `pending` atomically with the run. Ordinary run
  finalization rejects pending attempts; interruption recovery explicitly fails
  remaining attempts before closing the run.
- The scheduler supplies a positive effective interval. Persistence calculates
  `next_check_at` from the database completion time in the outcome transaction.
- Cancellation preserves finalized attempts, changes remaining pending attempts
  to `skipped / RUN_CANCELLED`, and marks the run `cancelled`.
- Reuse TypeORM, Zod, PostgreSQL, Vitest, and Testcontainers. No new dependency
  or migration is required for this ticket.
