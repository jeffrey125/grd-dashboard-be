# V1-011: Implement tracking persistence and outcome transactions

## Status

Depends on V1-008.

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
