# V1-016: Add manual refresh, events, and notifications

## Status

Depends on V1-010, V1-011, and V1-012.

## Objective

Expose authenticated single-Shipment manual refresh as a queued tracking-run resource, provide reconnect-safe status/events, and publish non-transactional ntfy notifications.

## Required reading

- [`../architecture.md`](../architecture.md), manual refresh flow
- [`../tracking-behavior.md`](../tracking-behavior.md), manual refresh and events
- Auth ADR from V1-009

## Scope

- Add an authorized command that queues one manual tracking run by Shipment external UUID and returns `202` with run external UUID/status.
- Add authorized run-status retrieval without exposing internal IDs or sensitive source data.
- Worker processes queued manual work before scheduled work.
- Add SSE events for Shipment/run changes with heartbeat and reconnect behavior that treats PostgreSQL as truth.
- Publish allowed change/error notifications to ntfy through a notification interface using Node built-in `fetch` unless a new client is explicitly approved.

## Acceptance criteria

- Refresh-all is absent.
- Manual refresh bypasses due/minimum interval eligibility but respects request rate limiting and does not move an active Shipment's scheduled check.
- A successful result can reactivate a threshold-paused Shipment; delivered remains terminal.
- Duplicate/conflicting manual requests have one documented deterministic outcome and cannot produce concurrent same-Carrier execution.
- `requested_by_id` comes from the authenticated principal.
- Notification failure never rolls back tracking persistence and is visible through safe diagnostics.
- Reconnecting clients can recover current run/Shipment state from HTTP/PostgreSQL even if they missed SSE events.
- Tests cover authorization, queue handoff, outcome behavior, event ordering/reconnect, heartbeat cleanup, notification success/failure, and shutdown cancellation.

## Verification

Run manual-refresh unit/integration/e2e, SSE tests, notification tests, auth regression, typecheck, and build.
