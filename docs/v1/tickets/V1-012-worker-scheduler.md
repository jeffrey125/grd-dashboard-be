# V1-012: Implement the single tracking worker and scheduler

## Status

Depends on V1-003, V1-007, and V1-011.

## Objective

Implement the auto-starting v1 worker, due-work scheduling, Carrier grouping, adapter interface, and graceful run lifecycle without an external queue.

## Required reading

- [`../architecture.md`](../architecture.md), scheduled flow and recovery
- [`../tracking-behavior.md`](../tracking-behavior.md), polling and adapter interface
- [`../database-schema.md`](../database-schema.md), due indexes and run model

## Dependency gate

Evaluate current Nest scheduler capabilities and `@nestjs/schedule`. Obtain explicit approval before adding a production dependency.

## Scope

- Define the small Carrier adapter/session interface and registry with test adapters.
- Start scheduling automatically after worker/database readiness.
- Wake every 60 seconds, prevent overlap, select due Shipments, group by Carrier, and execute one run per Carrier.
- Apply effective polling intervals and persist all run/attempt lifecycle transitions through tracking services.
- Check queued manual runs before scheduled work without implementing a general-purpose message queue.
- Close sessions and finalize interrupted run state safely on shutdown/startup.

## Acceptance criteria

- The scheduler is absent from the API composition root.
- Starting multiple API processes cannot duplicate polling.
- One worker never overlaps its own scheduler ticks or two runs for the same Carrier.
- The adapter receives work but owns no timer.
- Due selection honors active/deleted status, Carrier active state, `next_check_at`, and adapter minimum.
- Use the Carrier repository's active-selection policy from V1-007: disabled and
  soft-deleted Carriers cannot receive new scheduled work. Keep existing Shipment relationships intact.
- Worker startup validates enabled adapter configuration and exposes safe readiness/failure state.
- Deterministic fake-clock tests cover due/not-due selection, long-running rounds, shutdown, startup recovery, and manual-work priority.

## Verification

Run scheduler/worker unit tests with fake time, tracking integration tests with fake adapters and PostgreSQL, start/stop the worker process manually, typecheck, and build.
