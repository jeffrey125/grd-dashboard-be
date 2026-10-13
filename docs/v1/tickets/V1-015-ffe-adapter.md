# V1-015: Implement the FFE adapter

## Status

Depends on V1-012; prerequisite worker and V1-014 mode infrastructure are present.
Request discovery and the behavior interview are complete. The user approved the
implementation plan and `cheerio@1.2.0`. Implemented and verified; see the
[implementation summary](../implementation-summary/V1-015-implementation-summary.md)
for test results, operational boundaries, and the pending commit handoff.

See [request exploration](V1-015-ffe-request-exploration.md) for live evidence.
The original FFE adapter, parser, tests, batch execution, and retained-value
behavior under /home/jeff/apps/shipment-monitoring/ were studied before grilling.
This specification supersedes the original browser/XML-only scope.

## Objective

Implement request and browser FFE tracking using per-reference JSON lookups,
with shared mapping, isolated per-run sessions, and per-Shipment failure handling.
Do not download an account XML export or introduce an XML parser.

## Required reading

- [Tracking behavior](../tracking-behavior.md), FFE, polling, and outcome sections.
- [Source-data policy](../tracking-source-data-policy.md), FFE allowlist.
- [Request exploration](V1-015-ffe-request-exploration.md).
- [V1-014](V1-014-echoship-adapter.md), shared mode/session conventions.

## User-approved interview decisions

### Lookup and archive coverage

- Support request and browser modes, following V1-014. Both map per-reference JSON;
  browser mode obtains responses through real Playwright login/search interactions.
- Search the one-year archive in both modes. Multiple references are sequential
  lookups in one session; native multi-reference requests were not established.
- A complete authenticated search without an exact reference counts toward the
  existing configured not-found pause threshold. Absence is scoped to one year;
  older Shipments may consequently pause as not found.
- Prefer the latest duplicate exact-match record only when reliable record-update
  ordering can be established. Otherwise use the first exact match in response
  order. No reliable update timestamp exists in the observed contract, so the
  initial implementation uses that fallback. Do not guess freshness from IDs,
  vehicle-location timestamps, appointment dates, or shipment progression.

### Mapping and source evidence

- Preserve case and leading zeros in references and compare exact normalized IDs.
  Keep GRD's existing generic creation/reference contract.
- Retain both actual pickupDate and appointment apptPickupDate in source_data.
  Set pickedUpOn from the first valid actual pickupDate, otherwise apptPickupDate.
  No additional snapshot columns are needed.
- Estimate precedence: apptDeliveryDate, schedDeliveryDate, requestedDeliveryDate;
  use the first valid date, including when an earlier candidate is invalid.
- Set deliveredOn only when the normalized status equals Delivered, ignoring case,
  and actual deliveryDate is valid. Delivered status without that date remains
  monitored. The existing shared worker completes a Shipment when deliveredOn
  becomes known.
- Invalid optional dates are ignored; continue with valid tracking fields and the
  approved fallbacks. When no valid value remains, the existing persistence merge
  retains the prior known value. Invalid delivery dates never complete monitoring.
- Preserve carrier calendar dates without timezone conversion. Source evidence
  retains raw values before normalization.

### Authentication and recovery

- Fresh isolated login once per run, reused for sequential lookups and closed at
  completion. Keep earlier successes if authentication fails during the run.
- No mid-run re-login or automatic switch between modes. Authentication rejection
  fails subsequent lookups without more I/O; recovery occurs on the next scheduled
  run or manual refresh.
- All-carrier completion/automatic-pause notifications are recorded in
  [V1-016](V1-016-refresh-events-and-notifications.md). Do not implement notification
  delivery inside this adapter.

## Approved implementation details

### Mode selection and lifecycle

- Reuse carriers.fetch_mode and the Carrier API. Set FFE to request by a new
  reversible migration; browser is an operator-selected backup. Preserve run
  start-time mode capture. No environment mode override or automatic fallback.
- Keep the five-minute adapter minimum and existing polling/RPM configuration.
  No additional scheduler, frontend, public refresh endpoint, or application
  database migration execution is included.
- Validate FFE_URL, FFE_USERNAME and FFE_PASSWORD locally when enabled. Pin all
  credential-bearing I/O to https://www.ffeinc.com. Use /Account/Login for login
  and /Customer/ShipmentTracking for the protected page; the configured URL
  remains the validated tracking-page URL. Allow an optional
  FFE_BROWSER_EXECUTABLE_PATH, following EchoShip's Chromium configuration.
- Request mode uses fresh in-memory cookies, GET login form, URL-encoded form POST,
  explicitly validated same-origin login redirect, and protected-page verification.
  Browser mode uses an isolated Chromium context and actual UI search controls;
  map only naturally observed tracking JSON, with no Axios/APIRequestContext
  fallback, separate scripted fetch, XML export, or DOM-derived tracking fields.
- Follow V1-014's no-immediate-retry policy. Other lookup failures affect only that
  Shipment; authentication failure invalidates the remaining session.

### Authentication, identity and bounds

- HTTP 200 and an empty JSON envelope are insufficient proof of authentication:
  FFE returns that shape without cookies. Verify protected-page access at login
  and recheck after empty/suspicious results before reporting not_found.
  A redirect/login form, 401/403, or otherwise unverified session is a failure.
- Validate the DataTables envelope and request correlation, selected archive scope,
  pagination and counts. An exact match can return its approved first record;
  an absent match requires a complete bounded search. Do not copy EchoShip's
  rejection of duplicate IDs, because first-record handling is explicitly approved.
- Use up to ten pages of 100 results for request-mode absence checks. Browser mode
  may report absence only when complete coverage is proven; otherwise return an
  incomplete-search failure. Do not guess inaccessible pagination controls.
- Use 30-second physical I/O deadlines and 4 MiB response bounds, following V1-014.
  Request limits apply while reading; Chromium's buffered response limit protects
  parsing/persistence, not a hard browser-process memory ceiling.
- Pace physical auth/protected-page/tracking calls with one worker-lifetime limiter
  and the existing optional Carrier RPM; static browser assets are excluded.
  Cancellation closes contexts, cookies and pending work within worker shutdown.
- Changed/inconsistent counts, exhausted page caps, malformed structures, wrong
  response types, untrusted redirects, and all-null unusable mapped records are
  technical failures. They preserve snapshots/not-found counters.

### Minimal source-data allowlist

- Successful lookups retain only the chosen record's orderNumber, shipmentStatus,
  pickupDate, apptPickupDate, apptDeliveryDate, schedDeliveryDate,
  requestedDeliveryDate and deliveryDate. Bound strings before persistence.
- Carrier status is the normalized shipmentStatus; status detail remains null,
  matching the old FFE adapter. Null status is allowed when other usable tracking
  fields exist. Missing values use the shared previous-value merge.
- Failed/not-found outcomes store null source data. Do not retain addresses,
  account data, credentials, cookies, tokens, HTML, screenshots, full JSON or XML.

## Approved dependency approach

Reuse installed Axios 1.20.0, axios-cookiejar-support 7.0.0, tough-cookie 6.0.2,
Zod 4.6.6, Playwright 1.64.0, and Bottleneck 2.19.5.

Added exactly cheerio 1.2.0 with pnpm for login-form token extraction
and protected-page HTML checks. This avoids promoting the diagnostic regex into
production HTML parsing. Its published Node requirement is >=20.18.1, compatible
with this project's Node 24.21 runtime. Registry metadata was checked on 2026-10-14.
Cheerio parses markup without executing page JavaScript or launching a browser;
use its local parsing API only. Tradeoff: one direct dependency and its transitive
packages. Alternatives are a lower-level HTML parser requiring explicit tree
traversal, or a custom narrow parser with greater markup-maintenance burden.

Sources: [Cheerio documentation](https://cheerio.js.org/docs/intro/),
[published package metadata](https://registry.npmjs.org/cheerio/1.2.0).
The user separately approved this production dependency with the final plan.

## Acceptance and verification

- Carrier API accepts both FFE modes; migration initializes request mode and
  reverts predictably without modifying run history. Verify against PostgreSQL.
- Request fixtures cover form parsing, token/cookie pairing and rotation, verified
  authentication, unauthorized empty responses, exact/partial matching, archive
  scope, bounded pagination, first-duplicate choice, mapping and minimal evidence.
- Chromium fixtures cover UI-driven login, one-year selection/search, response
  correlation, authenticated absence versus partial results, no transport fallback,
  resource cleanup and the same mapping in both modes.
- Worker integration covers repeated unchanged results, failure isolation, retained
  values, completion only with status plus valid delivery date, and unchanged
  counters after technical errors. Use disposable PostgreSQL, not application data.
- Test meaningful behavior first at mapping/session/API seams. Verify cancellation,
  response/deadline limits, no retries/re-login, and safe failures. Ordinary CI uses
  fixtures and no live credentials. Authorized live smoke remains read-only and
  opt-in, with ignored sanitized diagnostic artifacts.
- Run focused tests while implementing, then pnpm check, pnpm test:integration,
  pnpm test:e2e, final diff/spec review and the structured implementation summary.
  Obtain separate final commit approval; no automatic commit, push or deployment.
