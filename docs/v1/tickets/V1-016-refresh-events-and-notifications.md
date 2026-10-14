# V1-016: Add manual refresh, events, and notifications

## Status

Depends on V1-010, V1-011, and V1-012.

Implemented and locally verified. See the
[implementation summary](../implementation-summary/V1-016-implementation-summary.md)
for approved decisions, exact checks, limitations and proposed commits.

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
- Publish allowed change/error notifications through a notification interface using the existing Axios package, explicitly approved during the V1-016 interview in place of the original built-in `fetch` default. No new dependency.
- Notify the user when a Shipment transitions to completed/delivered or becomes
  automatically paused at the consecutive-not-found threshold. Apply this to UPS,
  EchoShip, and FFE; include the shipment reference and the reason monitoring
  stopped. This requirement was approved during the V1-015 interview; notification
  implementation remains in V1-016.

## Acceptance criteria

- Refresh-all is absent.
- Manual refresh bypasses due/minimum interval eligibility but respects request rate limiting and does not move an active Shipment's scheduled check.
- A successful result can reactivate a threshold-paused Shipment; delivered remains terminal.
- Duplicate/conflicting manual requests have one documented deterministic outcome and cannot produce concurrent same-Carrier execution.
- `requested_by_id` comes from the authenticated principal.
- Notification failure never rolls back tracking persistence and is visible through safe diagnostics.
- Emit one stop notification per completed/delivered or automatic-threshold-pause
  transition, not repeatedly while the Shipment remains in that state. A later
  reactivation and subsequent automatic pause is a new transition. Define and test
  delivery/retry deduplication during V1-016; this does not promise exactly-once
  external delivery. Ordinary tracking failures must not claim monitoring stopped.
- Reconnecting clients can recover current run/Shipment state from HTTP/PostgreSQL even if they missed SSE events.
- Tests cover authorization, queue handoff, outcome behavior, event ordering/reconnect, heartbeat cleanup, notification success/failure, and shutdown cancellation.

## Verification

Run manual-refresh unit/integration/e2e, SSE tests, notification tests, auth regression, typecheck, and build.
