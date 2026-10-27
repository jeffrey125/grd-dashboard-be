# V1-014: Implement the EchoShip adapter

## Status

Depends on V1-012. Exploration and grilling complete; implementation approved
on 2026-10-14, including the three additional production dependencies below.
Verification and handoff are recorded in
[`../implementation-summary/V1-014-implementation-summary.md`](../implementation-summary/V1-014-implementation-summary.md).

## Objective

Implement both request-based and browser-based EchoShip monitoring. Request mode
is the default; browser mode is an operator-selected backup, not automatic
failover. The observed private portal endpoints are not a supported public API.

## Required reading

- [`../tracking-behavior.md`](../tracking-behavior.md), EchoShip and polling sections
- [`../tracking-source-data-policy.md`](../tracking-source-data-policy.md), EchoShip allowlist
- [`V1-014-echoship-request-exploration.md`](V1-014-echoship-request-exploration.md), live evidence and Git-ignored diagnostic artifacts

## Agreed behavior

### Configuration and execution

- `carriers.fetch_mode` is the only transport selector: `request` or `browser`.
  Expose it as `fetchMode` through the existing Carrier read/update API. No `.env`
  mode override. UPS supports request only; EchoShip supports both; FFE is reserved
  for browser. This ticket does not implement FFE.
- Seed existing UPS/EchoShip rows to request and FFE to browser. Capture the mode
  on `tracking_runs.fetch_mode` atomically at execution start, not queue creation.
  Queued and historical runs retain null until actually started; no fake backfill.
  Later edits affect the next run, never the active session.
- Scheduled and manual runs use the same setting and fresh authentication.
  Manual refresh remains a queued single-Shipment run; its HTTP endpoint is
  delivered by V1-016, not this ticket.
- Keep existing polling: EchoShip defaults to five minutes (adapter minimum five),
  UPS defaults/minima unchanged. The scheduler scans once per minute.
- Validate `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, `ECHOSHIP_PASSWORD` locally when
  EchoShip is enabled. Only `https://echoship.com` is accepted. Credentials stay
  in environment configuration. Optional `ECHOSHIP_BROWSER_EXECUTABLE_PATH`
  configures Chromium, not the mode.
  Preserve the configured login-page path; the working live URL is
  `https://echoship.com/login`.

### Authentication and failures

- One isolated in-memory session per run; fresh verified login before lookups,
  reused for sequential Shipments and closed afterward. Verify a protected read
  rather than trusting a successful login envelope alone.
- No immediate lookup retries, no mid-run re-login, no cross-mode fallback.
  Initial login failure fails affected attempts. Mid-run authentication rejection
  preserves earlier successes and fails remaining reads without further I/O.
  Other Carriers continue. Recovery waits for the next scheduled run or manual
  refresh. This explicitly supersedes the earlier one-re-login discussion.
- Failure of any required detail/tracking component makes the whole lookup a
  technical failure. Do not persist partial dates, change the prior snapshot, or
  increment the not-found counter. Confirmed missing optional fields retain
  existing known values through the shared persistence merge.
- Return `not_found` only for a successful authenticated, complete search with no
  exact reference. Request mode reads at most ten pages of 100 results, rejects
  repeated IDs/changing totals/empty incomplete pages, and fails on cap exhaustion.
  Browser mode may confirm absence only when the observed page covers the complete
  result count; an unmatched partial page is a technical failure, not absence.
  Unknown pagination controls are not guessed. HTTP 400/404 alone is not absence.

### Mapping and evidence

- Keep calendar dates in existing PostgreSQL `date` columns. Preserve the source
  date component; no timezone conversion and no new event timestamp columns.
- The detail and tracking APIs are authoritative in both modes. Status/detail come
  from the first valid tracking event ordered by `modifiedDate` descending, then
  `createdDate` descending. Never override API values with DOM or location-history
  text, even when the portal's feature-selected panel disagrees. Reject conflicting
  ties on both timestamps and mismatched IDs; require valid ordering timestamps.
- Approved follow-up on 2026-10-27: if `/tracking` is a valid empty array, use
  the detail `status` verbatim after whitespace normalization, with no invented
  status detail or dates. This supports status-only shipments such as `CheckedIn`
  and keeps scheduled monitoring active. Once events appear, event status/detail
  take priority. Preserve known dates through the existing persistence merge.
  Malformed events and failed tracking requests still fail the whole lookup.
  Include nullable raw `load.status` in successful source data; no new dependency,
  database migration, location-history request, or DOM mapping is required.
- Pickup is `pickupDate`; delivered is `deliveryDate`. For undelivered loads,
  estimate prefers the first Delivery stop's `appointmentStart`, then
  `deliveryByDate`, matching the inspected frontend. Treat year-one sentinels as
  absent. Never substitute the broad list estimate.
- Browser mode logs in/searches/navigates through Playwright and maps the detail and
  tracking JSON responses naturally received by that navigation. It does not read
  status or dates from DOM text and makes no Axios or APIRequestContext lookup.
  A failure of the portal's shared backend can break both modes.
- Persist only the successful lookup allowlist in the source-data policy. Failed
  and absent lookups store null. No passwords, cookies, tokens, addresses, prices,
  authenticated HTML, screenshots, or full response bodies in logs/persistence.
- Keep diagnostic scripts and captures under Git-ignored `artifacts/echoship/v1-014/`
  with restrictive permissions. Do not add automatic production artifact capture.

## Approved dependencies

Reuse existing Axios, Zod, TypeORM and Bottleneck. Add exactly
`playwright@1.64.0`, `tough-cookie@6.0.2`, `axios-cookiejar-support@7.0.0` using pnpm.
Public registry engine/peer requirements were checked against Node 24/Axios 1.20.
Do not use `axios-retry` for EchoShip. Do not copy the diagnostic minimal cookie
map or tom-automation's Bun-specific cookie parser into Node production code.

## Bounds and lifecycle

- Request transport: 30-second physical HTTP timeout, 4 MiB body cap, no redirects,
  strict JSON responses, in-memory cookie jar with rotations, no credential-bearing
  Basic header outside sign-in. Destroy cookie agents and clear cookies on close.
- Browser: 30-second launch/navigation/action/response/body waits, isolated context,
  service workers blocked, close browser on cancellation and every terminal path.
  Reject response bodies over 4 MiB; chunked bodies are checked after Chromium
  buffers them, so this is a parsing/persistence cap, not a browser-memory guarantee.
- One worker-lifetime limiter spaces request-mode HTTP calls and browser portal API
  requests using the optional Carrier RPM. Static browser assets do not consume the
  API quota. Session changes do not reset pacing; rate changes honor a one-minute
  boundary after the previous send. No limit is imposed when the DB value is null.

## Acceptance and verification

- Carrier API rejects unsupported modes, exposes selected mode, preserves other settings.
- Migration works forward/backward without schema drift; queued/history semantics
  and start-time capture are tested against PostgreSQL.
- Request tests cover fresh login, verified authentication, rotated cookies,
  sequential isolation, exact matching/pagination, malformed evidence, mapping,
  privacy, cancellation, no retries, and no browser launch.
- Real Chromium fixtures cover UI navigation, browser-observed dates, complete vs
  partial absence, auth rejection, no request-client fallback, and resource closure.
- Worker integration preserves snapshots/counters after failures and continues
  other work. Ordinary CI uses fixtures, never live carrier credentials.
- Run formatting, lint, typecheck, unit tests, integration/e2e, build, final diff
  review, and opt-in live smoke when authorized. Record limitations honestly.
