# V1 tracking and Shipment behavior

**MON-V1-001:** [Monitoring safeguards](monitoring-safeguards.md) supersede the
original fresh-session and technical-retry rules below.

**MON-V1-002:** [Delivered follow-up monitoring](delivered-follow-up-monitoring.md)
supersedes terminal delivery when a future follow-up date is populated.

## Shipment management

- A Shipment belongs to one Carrier and is addressed externally by UUID.
- `tracking_reference` is a trimmed Carrier-understood string up to 255 characters.
- Active uniqueness is scoped to `(carrier_id, tracking_reference)`; a soft-deleted pair may be added again.
- Notes are user-maintained and limited to 500 characters.
- Reference validation belongs to the Carrier policy interface, not the controller.
  V1-008 explicitly uses generic trimmed, nonempty strings up to 255 UTF-16 code
  units for every Carrier, preserving case and leading zeros and rejecting NUL
  and JSON numbers. Provider-specific format restrictions are not applied.
- Public creation accepts one explicit item, validates it before writing, and reports created versus existing.
- APIs never expose internal integer IDs.

V1-008 uses one `POST /shipments` endpoint with one shipment object. Existing
non-deleted pairs (even paused/completed) remain unchanged and return with an
`existing` outcome and 200; a new insertion returns `created` and 201. Invalid
input, an unavailable Carrier, or a database failure inserts nothing. Carrier
eligibility is checked again under a database lock.

New Shipments are active and immediately due, with `verification_url = NULL`.
The Carrier interface can build a URL without opening a tracking session; persist
it only after the first successful lookup and preserve it through later failures.

Manual pause changes only active Shipments to paused/manual and clears the next
check. Manual resume accepts only paused/manual, returns it to active, clears the
reason, and schedules it immediately. Neither operation resets the not-found
counter or tracking history. Invalid/repeated transitions return 409. Threshold
pause requires a successful manual refresh; delivered completes monitoring unless its follow-up date is in the future. Carrier
disablement still prevents the future scheduler from selecting its Shipments.

## Polling

- The worker scans for due work every 60 seconds.
- Due means active, not soft-deleted, and `next_check_at <= now()`.
- Seed intervals: UPS 30 minutes, EchoShip 5 minutes, FFE 5 minutes.
- The effective scheduled interval is the greater of the database interval and the adapter hard minimum. UPS CIE therefore remains at least 60 minutes.
- Compute the next scheduled check from finalized attempt completion, not start time.
- A technical failure does not count as `not_found`. Individual lookup failures use the normal interval until the configured failure-pause threshold; session failures count only toward the Carrier auto-disable threshold.

V1-012 additionally checks the adapter hard minimum against finalized **scheduled**
attempt history. Manual attempts do not postpone automatic eligibility or change
an active Shipment's stored `next_check_at`. Startup/shutdown interruption records
and skipped attempts do not impose a new minimum wait. Database time controls due
selection and outcome completion; the worker clock only triggers scans.

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

V1-013 uses the approved `axios`, `axios-retry`, and `bottleneck` packages.
`UPS_ENVIRONMENT` defaults to `cie`; production requires the explicit value
`production`. Enabled UPS requires nonblank `UPS_CLIENT_ID` and
`UPS_CLIENT_SECRET`. Credentials are validated lazily by the worker's enabled
adapter check, so disabled UPS and the API do not require them.

- The database RPM is capped at 10 in production and 5 in CIE; null uses that
  environment's cap. These are conservative application caps inherited from the
  original implementation, not a claim about an account's UPS quota. Configure
  a lower database RPM when required by the account. All OAuth and tracking calls,
  including retries and the 401 replay, share one worker-lifetime limiter.
- Requests are spaced evenly, with at most one active HTTP request. A database
  rate change waits until the previous request is at least one minute old before
  sending under the new cap. Closing a session never resets quota or cooldown.
- Every physical request has a 15-second timeout and fresh transaction ID.
  OAuth permits one transient retry; tracking permits two, using 500 ms/1 second
  backoff and valid `Retry-After`. One 401 refresh/replay is allowed per lookup;
  that replay has the same bounded transient retry budget. Cancellation stops
  retries. Response bodies are limited to 1 MiB, must be JSON, and redirects are
  not followed.
- **Approved cooldown decision:** `Retry-After` greater than 60 seconds ends the
  lookup immediately. All further UPS lookups during that cooldown become
  retryable `UPS_RATE_LIMITED` failures without HTTP requests. Other Carriers
  continue. The stored message is "UPS temporarily unavailable. Tracking will
  retry later." Actual request timeouts use `UPS_TIMEOUT`. UI status/SSE delivery
  remains in V1-016. Scheduled failures use the normal interval; cooldown expiry
  does not create a new job or timer to poll UPS.
- Shipment creation retains V1-008's generic reference policy. The worker rejects
  UPS lookup references outside 7–34 characters before making requests. Exact
  tracking-number matching is required; empty, mismatched, duplicate, or malformed
  package responses are technical failures. Only tracking HTTP 404 is not-found;
  OAuth HTTP 404 is an authentication failure.
- Prefer nonblank simplified status, falling back to description. Detail is the
  description when different from the status. RDD takes precedence over SDD for
  estimates; DEL supplies the delivered date; pickup remains null. Validate real
  calendar dates before converting YYYYMMDD to YYYY-MM-DD. For repeated date
  entries, retain the original last-RDD/last-DEL/first-SDD behavior.
- Cache tokens with a safety margin of the smaller of 60 seconds and 10% of
  provider lifetime, conservatively accounting for acquisition time. Concurrent
  callers share one refresh. Late rejection of an older token cannot evict a newer
  cached token. Cache loss/corruption causes another acquisition; a cache-operation
  error disables cache use for the process, preserving lookups at higher OAuth
  cost. One caller cancelling does not cancel a refresh needed by another;
  worker shutdown aborts shared HTTP work.

Quota, tokens, and cooldown are process-local and reset with the single worker.
They do not enforce limits shared with other applications using the same account.

### EchoShip

- V1-014 implements request and browser modes, selected by `carriers.fetch_mode`
  through the Carrier API (`fetchMode`). Request is the default; browser is a
  manually selected backup. No environment selector or automatic fallback.
- Capture the chosen mode on the run at execution start. Changes affect the next
  run. Queued/historical runs have null mode until started. Manual and scheduled
  work follow the same transport/session policy.
- Configure `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, `ECHOSHIP_PASSWORD`; optional
  `ECHOSHIP_BROWSER_EXECUTABLE_PATH` selects a system Chromium installation.
  The origin is restricted to `https://echoship.com`. Enabled-worker validation
  remains lazy; the API and disabled EchoShip do not require credentials.
- Request mode validates and reuses its worker-memory cookie session each run.
  Confirmed expiry permits one login; inconclusive validation does not. Browser
  sessions remain isolated per run. No mid-run re-login. Authentication rejection fails subsequent
  lookups without more requests; earlier successes survive. Recovery waits for
  the next automated run or manual refresh. Other Carriers continue.
- Only complete authenticated searches without an exact reference are not-found.
  Partial/malformed searches and detail/tracking failures are technical failures.
  Request searches are capped at ten 100-result pages; browser partial-page
  absence remains unconfirmed. HTTP 400/404 is not treated as proof of absence.
- Use the detail and tracking APIs as authoritative in both modes. Status/detail
  use descending modified date, then descending created date. Browser mode maps
  JSON responses naturally observed during navigation and does not issue separate
  Axios requests. DOM or location-history text cannot override API values.
- When `/tracking` returns a valid empty array, use the detail response's raw
  `status` as the status fallback (for example, `CheckedIn`). Do not translate it
  to a portal label or infer pickup/delivery dates. Later tracking events take
  priority again. Missing dates retain previously known values through the shared
  persistence merge; successful status-only lookups keep normal polling active.
  Malformed tracking responses still fail rather than using the fallback.
- Preserve source calendar dates: pickupDate, deliveryDate, and Delivery stop
  appointmentStart followed by deliveryByDate for an undelivered estimate. No
  timezone conversion, broad-list estimate fallback, or event timestamp columns.
- Store only the successful lookup allowlist; failed/not-found source data is null.
  Bounded I/O, privacy, pacing and cleanup details are in the
  [V1-014 ticket](tickets/V1-014-echoship-adapter.md).

The account's dynamic `viewTrackingData` feature can switch the visible portal
panel to location-history records. That display may disagree with `/tracking`;
the approved rule is that provider API detail/tracking data remains authoritative.

### FFE

- V1-015 defaults to request mode; browser mode is an explicit Carrier API choice.
  Both use per-reference JSON from the one-year archive, never account XML.
- Request mode validates and reuses its worker-memory cookie session each run;
  confirmed expiry permits one login. Browser sessions remain isolated per run.
  Perform sequential lookups without mid-run login or automatic mode fallback.
- Request mode uses form-token/cookie login. Browser mode uses real login,
  archive-toggle and search interactions; observed JSON is authoritative, not DOM text.
- Compare exact references. No reliable record-update timestamp was observed;
  select the first exact record in response order rather than guessing freshness.
- Normalize pickup from valid `pickupDate`, then `apptPickupDate`; retain both
  raw fields. Estimate precedence is `apptDeliveryDate`, `schedDeliveryDate`,
  `requestedDeliveryDate`. Preserve calendar dates without timezone conversion.
- Set delivered date only for case-insensitive Delivered status plus valid
  `deliveryDate`. Delivered without a date stays monitored. Invalid optional dates
  become null and shared persistence retains previous known values.
- Verify authentication before accepting absence; unauthorized FFE requests can
  return an empty HTTP 200. Authentication failure invalidates the session;
  earlier successes persist. Technical failures do not advance not-found counters.
- Request absence requires complete search within ten 100-row pages. Browser
  absence requires complete observed results; partial results fail safely.
  Absence is limited to one year and can pause older shipments at the configured threshold.
- Enforce 30-second physical I/O and 4 MiB response limits; browser buffering is
  not a hard process-memory limit. Share worker-lifetime optional RPM pacing.
- Store only the selected eight-field [source projection](tracking-source-data-policy.md#ffe-allowlist-example).
  Notifications when monitoring stops remain V1-016 scope, not adapter behavior.

## Normalized tracking state

The normalized snapshot contains Carrier status, status detail, pickup date, estimated-delivery date, and delivered date. Calendar dates are stored as PostgreSQL `date`. Missing Carrier fields retain the previous known value before change comparison.

**MON-V1-003: explicit delivery reversals.** A recognized current non-delivered
status overrides both an old retained delivery date and a contradictory delivery
date returned in the same successful response. Clear `deliveredOn` before snapshot
comparison and monitoring decisions. Match the mapped status exactly after
normalizing casing and whitespace; never infer from free-text notes or substrings:

| Carrier  | Recognized non-delivered statuses                                            |
| -------- | ---------------------------------------------------------------------------- |
| FFE      | Scheduled, In Route, Out for Delivery                                        |
| UPS      | In Transit, Moving, On the Way, Loaded on Delivery Vehicle, Out for Delivery |
| EchoShip | Shipment enroute, Moving, Out for Delivery, CheckedIn, PickedUp, Picked Up   |

The additional labels In Route, On the Way, Loaded on Delivery Vehicle and
Picked Up were verified in stored production observations. UPS also describes
[On the Way as movement before final delivery](https://www.ups.com/ca/en/support/tracking-support/where-is-my-package/understanding-tracking-status).

EchoShip retains its existing latest-tracking-event precedence, using detail status
only for a valid empty tracking array. Unknown or missing statuses, incomplete
delivery dates, lookup failures and not-found results do not revoke delivery.
Other known dates keep the existing preservation behavior. A reversal inserts a
new immutable snapshot and allows normal monitoring even when follow-up is due;
historical delivery observations remain intact. A later confirmed delivery can
complete monitoring again. This does not reopen completed shipments automatically:
they cannot discover changes without Monitor again or a separately approved,
evidence-based repair. See the [implementation summary](implementation-summary/MON-V1-003-implementation-summary.md).

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
- Carrier runs execute sequentially. The worker drains queued manual runs in
  creation order before each next scheduled Carrier, without interrupting the
  current run. Continuous manual work can delay scheduled work. An idle worker
  discovers manual work on its next minute scan.
- A manual refresh bypasses due-time/minimum-interval eligibility but still uses the rate limiter.
- It does not shift the existing schedule for an active Shipment.
- A successful result can reactivate a Shipment paused by not-found threshold; delivered completes monitoring unless its follow-up date is in the future.

By explicit V1-012 decision, refreshing one Shipment does not restart the minimum
waiting period for its automatic checks. A refresh immediately before a scheduled
check can therefore result in two nearby lookups, both subject to adapter request
rate limiting. Other Shipments are unaffected.

## Errors, events, and notifications

- Configuration/session startup errors expose a concise safe message and preserve the technical cause only in backend logs.
- Per-Shipment failures are isolated and stored on attempts; one failure does not discard successful results from the same run.
- SSE announces run/Shipment changes, while PostgreSQL remains the reconnect source of truth.
- Notification failure must not roll back tracking persistence.
- V1-016 explicitly approves the existing Axios package for ntfy. Publishing has
  a 15-second deadline, no redirects/retries, and shutdown cancellation. Optional
  `NTFY_URL` enables alerts; absent/blank disables them. Failed sends are safely
  logged and discarded; no delivery table or durable queue is introduced.

### V1-016 HTTP and notification contract

- Unrestricted Staff/Admin can `POST /shipments/:externalId/refresh` with no body
  or `{}`. Return 202 with the queued run's public UUID/status. Concurrent/repeated
  requests for the same Shipment reuse its queued/running manual run and retain
  its original requester. Once finished, another request creates a new run.
  Missing/deleted Shipments return 404; disabled Carriers, manual pauses and
  delivered Shipments return 409 when no reusable eligible request exists.
  A pending run can finish while a duplicate response is being prepared; its
  returned status may already be terminal. No second job is created in that race.
- `GET /tracking-runs/:externalId` exposes current run status, attempt outcomes,
  retryability, safe reason codes, timestamps and public Shipment/Carrier UUIDs.
  It never returns internal IDs or source data. Any unrestricted Staff/Admin can
  read runs in this shared dashboard; historical soft-deleted Shipment UUIDs may
  remain in run history. There is no refresh-all route.
- `GET /events` is a credentialed SSE stream. `shipment.changed` and `run.changed`
  contain `{ externalId }`, announcing changes rather than full records. Database
  triggers signal committed writes across API/worker processes. Attempt completion
  also signals run changes. Signals follow commit order; clients must tolerate
  coalescing and fetch current state, not assume every intermediate state appears.
- `tracking.changed` contains the Shipment `externalId`, `snapshotExternalId`,
  and canonical UTC `observedAt`. It is emitted transactionally only when the
  current snapshot pointer changes to a non-null owned snapshot, including first
  acquisition. Unchanged success, failed/not-found results, notes, scheduling,
  pause and resume do not emit it; generic Shipment invalidations remain intact.
  The public snapshot UUID is the deduplication identity.
- `resync` with `{}` occurs on every connection and database listener recovery.
  Refetch Shipments and any watched run URLs. Subscribe before the initial HTTP
  fetch and refetch again for changes arriving during it. `Last-Event-ID` does not
  replay history. `heartbeat` with `{}` occurs every 15 seconds. Session validity
  is checked before each frame; an idle revoked session closes by the next heartbeat.
  Slow consumers are disconnected to bound pending work and reconnect with resync.
- Notifications include first successful results, changed known values, and one
  combined alert when delivery stops monitoring. Threshold pauses generate one
  alert per transition, including the Shipment reference and stop reason. Repeated
  not-found while paused stays silent. Reactivation permits a new stop transition.
  Ordinary failures do not claim monitoring stopped. One failure alert per Carrier
  is sent until a confirmed found/not-found lookup resets suppression; this state
  is process-local and restarting may produce another failure alert. Unchanged
  results stay silent. A failed first alert is also suppressed until recovery.
  Messages are bounded by UTF-8 bytes and truncate optional details. A crash after
  commit but before publishing can lose an alert; no exactly-once delivery claim.

## Legacy behavior explicitly excluded

- SQLite migration and Hono/Bun internal APIs.
- Internal numeric IDs in routes.
- Disabling a Shipment after one `not_found`.
- Refresh-all.
- A process-local Start/Stop API and global in-memory coordinator lock.
- Frontend work in this backend rebuild.
