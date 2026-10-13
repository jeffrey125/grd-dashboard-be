# V1 tracking and Shipment behavior

## Shipment management

- A Shipment belongs to one Carrier and is addressed externally by UUID.
- `tracking_reference` is a trimmed Carrier-understood string up to 255 characters.
- Active uniqueness is scoped to `(carrier_id, tracking_reference)`; a soft-deleted pair may be added again.
- Notes are user-maintained and limited to 500 characters.
- Reference validation belongs to the Carrier policy interface, not the controller.
  V1-008 explicitly uses generic trimmed, nonempty strings up to 255 UTF-16 code
  units for every Carrier, preserving case and leading zeros and rejecting NUL
  and JSON numbers. Provider-specific format restrictions are not applied.
- Bulk creation accepts 1-10 explicit items, validates the complete input before writing, deduplicates normalized pairs, writes atomically, and reports inserted versus active duplicates.
- APIs never expose internal integer IDs.

V1-008 uses one `POST /shipments` endpoint with 1–10 `items`. The last occurrence
of an in-request normalized pair supplies its notes, including null for omitted
notes. Existing non-deleted pairs (even paused/completed) remain unchanged and
are reported as duplicates. At least one insertion returns 201; all duplicates
returns 200. Any invalid row, unavailable Carrier, or database failure inserts
nothing. Carrier eligibility is checked again under database locks.

New Shipments are active and immediately due, with `verification_url = NULL`.
The Carrier interface can build a URL without opening a tracking session; persist
it only after the first successful lookup and preserve it through later failures.

Manual pause changes only active Shipments to paused/manual and clears the next
check. Manual resume accepts only paused/manual, returns it to active, clears the
reason, and schedules it immediately. Neither operation resets the not-found
counter or tracking history. Invalid/repeated transitions return 409. Threshold
pause requires a successful manual refresh; delivered remains terminal. Carrier
disablement still prevents the future scheduler from selecting its Shipments.

## Polling

- The worker scans for due work every 60 seconds.
- Due means active, not soft-deleted, and `next_check_at <= now()`.
- Seed intervals: UPS 30 minutes, EchoShip 5 minutes, FFE 5 minutes.
- The effective scheduled interval is the greater of the database interval and the adapter hard minimum. UPS CIE therefore remains at least 60 minutes.
- Compute the next scheduled check from finalized attempt completion, not start time.
- A technical failure does not count as `not_found`; until a future retry-delay column is approved, it uses the normal effective interval.

## Rate limiting

- `carriers.rate_limit_per_minute` is nullable and must be positive when set.
- Seed UPS as 10; EchoShip and FFE are null initially.
- UPS CIE hard-caps the effective value at 5.
- Every physical Carrier request, including retries, consumes the limit.
- V1 has one worker. A later multi-worker version requires shared or partitioned quota enforcement.

## Adapter interface behavior

Each adapter validates configuration and references, builds a verification URL, opens a bounded session, and returns either normalized data, `not_found`, or a typed failure. The scheduler owns timing; adapters do not start their own polling timers.

### UPS

- Uses OAuth and the tracking HTTP API.
- Cache the access token in worker memory until provider expiry minus a safety margin.
- Deduplicate concurrent token refreshes.
- Use bounded timeouts and retries for network errors, 408, 429, and 5xx responses; honor valid `Retry-After` values.
- Apply the request limiter to retries as well as first attempts.
- Validate and map the response before persistence.

### EchoShip

- Uses Playwright in a headless browser.
- Configure `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, and `ECHOSHIP_PASSWORD`.
- Log in once per run/session, navigate back to a fresh Shipment search for every lookup, and read Shipments sequentially in v1.
- Only an absent search result is `not_found`; browser, navigation, login, or parsing failures are technical failures.
- Store allowlisted extracted source text, never authenticated HTML or cookies.

### FFE

- Uses Playwright to log in and download one account XML export for a Carrier run.
- Bound the in-memory export at 25 MiB and reject DTD/entity content.
- Validate XML before parsing and map only requested due Shipments.
- One export serves the whole FFE run; do not download once per Shipment.
- Store only the matching record as `source_data`, not the complete account export per attempt.

## Normalized tracking state

The normalized snapshot contains Carrier status, status detail, pickup date, estimated-delivery date, and delivered date. Calendar dates are stored as PostgreSQL `date`. Missing Carrier fields retain the previous known value before change comparison.

Insert a new immutable snapshot only when the complete normalized known state changes. A `found` attempt references the current snapshot whether it was newly inserted or unchanged.

## Outcome rules

| Outcome                       | Shipment effect                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `found`                       | Reset consecutive-not-found count; insert a snapshot only on change; complete if delivered; otherwise schedule the next check. |
| `not_found`                   | Preserve the current snapshot; increment the counter; schedule again until the threshold.                                      |
| Fifth consecutive `not_found` | Pause with reason `not_found_threshold` and clear `next_check_at`.                                                             |
| `failed`                      | Preserve snapshot and counter; persist retryability/reason; schedule by the normal interval.                                   |
| `skipped`                     | Persist why no lookup occurred; do not create or clear a snapshot.                                                             |

## Manual refresh

- V1 refreshes one selected Shipment; refresh-all is excluded.
- Return an asynchronous run resource rather than holding the HTTP request open.
- A queued manual run is durable in PostgreSQL; the single worker checks it before scheduled work.
- A manual refresh bypasses due-time/minimum-interval eligibility but still uses the rate limiter.
- It does not shift the existing schedule for an active Shipment.
- A successful result can reactivate a Shipment paused by not-found threshold; delivered remains terminal.

## Errors, events, and notifications

- Configuration/session startup errors expose a concise safe message and preserve the technical cause only in backend logs.
- Per-Shipment failures are isolated and stored on attempts; one failure does not discard successful results from the same run.
- SSE may announce run/Shipment changes, but PostgreSQL is the reconnect source of truth.
- Notification failure must not roll back tracking persistence.
- Use Node built-in `fetch` for ntfy unless a later requirement justifies another client.

## Legacy behavior explicitly excluded

- SQLite migration and Hono/Bun internal APIs.
- Internal numeric IDs in routes.
- Disabling a Shipment after one `not_found`.
- Refresh-all.
- A process-local Start/Stop API and global in-memory coordinator lock.
- Frontend work in this backend rebuild.
