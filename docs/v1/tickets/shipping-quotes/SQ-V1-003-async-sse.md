# SQ-V1-003: Execute quote attempts asynchronously with SSE

## Status

- Depends on: SQ-V1-002
- State: ready-for-agent
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Turn saved provider attempts into durable worker jobs and stream comparison progress to
the frontend. Use a deterministic fixture adapter in this ticket so queue, lease,
recovery, retry, and SSE behavior are proven before live provider adapters land.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [Architecture](../../architecture.md)
- [Tracking behavior](../../tracking-behavior.md)
- [Refresh, events, and notifications ticket](../V1-016-refresh-events-and-notifications.md)
- [SQ-V1-002](SQ-V1-002-save-comparisons.md)

## Acceptance criteria

- Creating a comparison persists one queued attempt for each selected provider in the
  same transaction and returns without waiting for provider execution.
- The single worker leases attempts atomically, enforces one active attempt per provider
  account, and permits different provider accounts to execute in parallel.
- Lease owner, lease expiry, attempt number, actual execution mode, start/end timestamps,
  recovery count, normalized outcome, and sanitized diagnostics are persisted.
- A restart reclaims an expired lease once. A second recovery failure becomes a terminal
  visible failure rather than looping.
- The fixture adapter proves queued, running, partial success, validation failure,
  unsupported, timeout, authentication-relogin-and-replay, and terminal failure states.
- One authentication failure triggers at most one relogin and replay. Other technical
  failures do not retry automatically.
- An authenticated comparison-specific SSE endpoint emits state changes. Authorization
  is rechecked and subscribers cannot observe another unauthorized resource.
- The frontend subscribes while work is active, renders partial results and failures,
  and refetches the authoritative comparison snapshot after connect/reconnect.
- Events are hints; missed or duplicate events cannot corrupt frontend state.

## Verification

- Run real-PostgreSQL concurrency tests for atomic leasing, provider-account exclusion,
  cross-provider parallelism, restart recovery, and terminal recovery failure.
- Run backend e2e tests for SSE authentication, comparison isolation, event ordering
  tolerance, disconnect, and reconnect/refetch.
- Run frontend tests for queued/running/partial/failed/completed states and reconnect.
- Run both repositories' format, lint, typecheck, test, and build commands.
