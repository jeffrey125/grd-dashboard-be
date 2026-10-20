# Frontend handoff — backend v1

## Start here

Read [auth-api.md](auth-api.md), then this document. The frontend is a separate
project; no frontend framework, package choice or UI implementation is selected
by this ticket. The legacy UI is reference behavior, not this API's protocol.

Backend intended origin: `https://api.globalresourcesdirect.com`.
Frontend intended origin: `https://dashboard.globalresourcesdirect.com`.
Local defaults: API origin `http://localhost:3000`, API base path `/api/v1`,
frontend `http://localhost:5173`.
Use the [root README](../../README.md) to start/seed the backend and bootstrap an
Admin. All HTTP endpoints use the `/api/v1` prefix; unversioned routes return 404.
There is no public signup.

Hosting remains undecided. Caddy, production Compose, App Platform specifications,
deployment workflows and CI/CD are deferred. Do not infer same-Droplet routing,
copy the Tom application's proxy blindly, or build an Origin-stripping proxy.

## Tracking projection, search, history, overview and live changes

BE-V1-001 adds stored `currentTracking`, `latestLookup`, and `latestRun` to every
Shipment response, including created/existing creation outcomes and notes/pause/resume.
Apply migration `1792281600000-TrackingReadProjection` before running this API.
Carrier status is distinct from `monitoringStatus` and lookup outcome.

BE-V1-002 adds authenticated, paginated whole-dataset search at
`GET /api/v1/shipments/search`. BE-V1-003 adds normalized snapshot history at
`GET /api/v1/shipments/:externalId/history`. BE-V1-004 adds the operational overview at
`GET /api/v1/dashboard/overview`. BE-V1-005 adds precise committed tracking-change
events to the existing live stream. Source-data diagnostics, refresh-all and
scheduler controls remain unavailable. Manual refresh returns a run ID that
stays independently readable through
`GET /api/v1/tracking-runs/:externalId`.

## Browser session flow

1. `POST /api/v1/auth/sign-in` with `{ email, password }`. Successful JSON is the account
   profile, not a token. Every API fetch uses `credentials: 'include'`.
2. If `mustChangePassword` is true, show only password replacement and sign-out.
   `POST /api/v1/auth/change-password` accepts `{ currentPassword, newPassword }` and
   returns 204. All sessions are revoked: clear cached state and sign in again.
3. `GET /api/v1/auth/me` restores the session/profile on reload. A 401 means sign-in is
   required. On a business 403, refresh `/api/v1/auth/me` to distinguish restricted
   password replacement from role denial. Do not repeatedly retry auth failures.
4. `POST /api/v1/auth/sign-out` with `{}` returns 204; close SSE and clear cached data.
   Sessions expire absolutely after 24 hours without rolling renewal. Password,
   email, role and active-state changes can revoke sessions before then.

Cookies are API-host-only, HttpOnly, SameSite=Lax and Secure in production. Never
read/store a token in localStorage, supply actor IDs, or use Better Auth's generic
client endpoints: only the application facade in [auth-api.md](auth-api.md) exists.
The browser sets `Origin`; do not set it manually. All unsafe methods require an
exact trusted Origin, including login. CORS permits credentials and `Content-Type`,
not arbitrary custom headers. Use same-site HTTPS subdomains in production.

Minimal request example (handle non-2xx and 204 in the real client):

```ts
const response = await fetch(`${apiOrigin}/api/v1/auth/sign-in`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
```

Account management routes, exact account fields and validation are defined once
in [auth-api.md](auth-api.md). Staff can use all Shipment actions; only Admins can
manage accounts and change Carrier settings. Hide unauthorized controls, while
still treating server authorization as authoritative. No self-deactivation or
self-demotion; protected admin changes can return 409.

## Shipment contract

All route IDs are public UUIDv4 strings. Do not derive IDs from references or use
internal integer IDs. JSON timestamps are ISO strings or null. Public fields:

```ts
type Shipment = {
  externalId: string;
  carrier: {
    externalId: string;
    code: string;
    name: string;
    isActive: boolean;
  };
  trackingReference: string;
  notes: string | null;
  salesRep: SalesRepSummary | null;
  followUpOn: string | null; // YYYY-MM-DD in America/New_York
  createdBy: EmployeeSummary | null;
  updatedBy: EmployeeSummary | null;
  recordUpdatedAt: string | null;
  recordUpdatedBy: EmployeeSummary | null;
  verificationUrl: string | null;
  currentTracking: TrackingSnapshot | null;
  latestLookup: LatestLookup | null;
  latestRun: TrackingRun | null;
  monitoringStatus: 'active' | 'paused' | 'completed';
  monitoringReason: 'manual' | 'not_found_threshold' | 'delivered' | null;
  lastAttemptedAt: string | null;
  nextCheckAt: string | null;
  consecutiveNotFoundCount: number;
  createdAt: string;
  updatedAt: string;
};
type EmployeeSummary = {
  externalId: string;
  firstName: string;
  lastName: string;
};
type SalesRepSummary = EmployeeSummary & { active: boolean };
```

The added projection types are:

```ts
type TrackingSnapshot = {
  externalId: string; // Immutable public UUIDv4, including historical snapshots.
  carrierStatus: string | null;
  carrierStatusDetail: string | null;
  pickedUpOn: string | null;
  estimatedDeliveryOn: string | null;
  deliveredOn: string | null;
  observedAt: string;
};
type LatestLookup = {
  runExternalId: string;
  outcome: 'found' | 'not_found' | 'failed' | 'skipped';
  snapshotChanged: boolean;
  retryable: boolean | null;
  reasonCode: string | null;
  completedAt: string;
};
```

`currentTracking` follows the Shipment's current snapshot pointer. Carrier dates
are calendar strings (`YYYY-MM-DD`), never timezone-shift them. `observedAt` is an
ISO timestamp for the first observation of that normalized version, **not the
last successful lookup time**. Unchanged successful checks reuse its UUID and
observation time; failed, not-found and skipped checks preserve known tracking.
Partial Carrier data retains explicit nulls and the existing known-value merge.

`latestLookup` is the most recently completed attempt by `completed_at DESC,
id DESC`; pending attempts never replace it. `latestRun` is the newest run with
an attempt for this Shipment by `created_at DESC, id DESC`, including queued,
running or terminal runs. The tie-breaker IDs remain server-only. Its shape is
`TrackingRun` below, and `attemptCount` covers the entire run, not just this
Shipment. A newer associated run does not change an explicitly requested manual
run's identity or status endpoint.

A new Shipment has all three fields null. A Shipment with only pending work has
null tracking/lookup and a non-null run. Reads use one database statement snapshot;
responses remain `no-store`. Public projections omit internal IDs, actor IDs,
source data, credentials, lock versions and provider diagnostic messages; safe
employee summaries are included for shipment audit display.

The list frontend should use `GET /api/v1/shipments/search`; the legacy array endpoint
remains available for existing consumers. Its response is:

```ts
type ShipmentSearchResponse = {
  items: Shipment[];
  page: number;
  pageSize: 25 | 50 | 100;
  total: number;
  tabCounts: {
    all: number;
    active: number;
    paused: number;
    delivered: number;
    attention: number;
  };
};
```

Search query fields are strict: unknown fields return 400. `tab` is `all`,
`active` (default), `paused`, `delivered`, or `attention`. `q` is a trimmed,
case-insensitive literal substring of reference or notes, up to 255 code units;
`%`, `_`, and `\\` have no wildcard meaning. `carrierExternalId` is one UUIDv4.
`salesRepExternalId` is one UUIDv4 or the literal `unassigned`. Sorting also
accepts `followUpOn`; null follow-up dates sort last. `followUpOn` is an optional
date-only value. New or changed dates cannot be before today in
`America/New_York`; an existing overdue date may remain unchanged until staff
clears or changes it.
Pagination defaults to page 1 and 25 rows; only 25/50/100 are accepted. Sorting
defaults to `createdAt desc`; `trackingReference` and `estimatedDeliveryOn` plus
`asc` or `desc` are also accepted. Null sortable values always appear last.
`estimatedDeliveryFrom` and `estimatedDeliveryTo` are optional inclusive ISO
calendar-date bounds on the current ETA; they reject invalid dates, year zero,
and reversed ranges. `undeliveredOnly=true` excludes completed Shipments;
`false` or omission adds no restriction. These filters support Upcoming deliveries
drill-down and apply before pagination/counting. Removed lookup-outcome,
created-date and last-attempted sort parameters remain rejected.

`total` includes the selected tab and all filters. `tabCounts` applies every
non-tab filter and ignores the selected tab. Attention means any paused Shipment,
a non-completed Shipment whose latest completed lookup failed, or a Shipment
whose follow-up date is today or earlier. Delivered rows may also appear in
Attention when their follow-up is due. Active excludes due follow-ups and failed
latest lookups; the compatibility-only Paused count is a subset of Attention.
Otherwise Active Shipments stay Active when their Carrier is disabled. Search items, total, and counts come from one PostgreSQL
statement snapshot. Separate page requests remain live offset reads rather than
a frozen result set.

Shipment detail history uses
`GET /api/v1/shipments/:externalId/history?page=1&pageSize=25` and returns:

```ts
type ShipmentHistoryResponse = {
  items: TrackingSnapshot[];
  page: number;
  pageSize: 25 | 50 | 100;
  total: number;
};
```

Pagination defaults to page 1 and 25 rows and accepts the same 25/50/100 sizes as
search. Unknown query fields, invalid values and unsafe offsets return 400.
Snapshots are ordered by `observedAt desc` with a stable server-only identity
tie-breaker. A known Shipment without snapshots returns an empty page. A missing
or soft-deleted Shipment returns 404.

History contains only immutable normalized snapshots recorded when known tracking
changes, including the initial observation. It does not expose lookup attempts,
unchanged checks, failures, source data, internal identities or diagnostics. A
failed, not-found or skipped lookup leaves existing history available. Items,
total and Shipment existence come from one PostgreSQL statement snapshot; separate
pages remain live offset reads.

## Dashboard overview contract

`GET /api/v1/dashboard/overview` is available to unrestricted Staff and Admin sessions,
uses `Cache-Control: no-store`, accepts no body, and returns:

```ts
type OverviewResponse = {
  asOf: string;
  timezone: 'America/New_York';
  counts: {
    all: number;
    active: number;
    paused: number;
    delivered: number;
    attention: number;
  };
  attention: { total: number; items: Shipment[] };
  upcomingWindow: { from: string; to: string };
  upcomingDeliveries: { total: number; items: Shipment[] };
};
```

All values come from one PostgreSQL statement snapshot identified by `asOf`.
Counts cover nondeleted Shipments and include Shipments whose Carrier is disabled.
They use the same monitoring and attention predicates as Shipment search.
Attention is any paused Shipment, a non-completed Shipment whose latest completed
lookup failed, or a Shipment whose follow-up date is due. A due follow-up may
overlap Delivered; the panel is newest-created first.

`attention.total` covers every matching Shipment while the panel returns at most
5 full safe Shipment projections. Counts are current monitoring state totals,
not delivered-today, on-time performance or analytics metrics.

Upcoming deliveries is restored by the 2026-10-17 frontend interview. Its window
is New York today through day +6 inclusive, derived from the same `asOf` instant.
It includes non-completed, nondeleted Shipments whose current ETA is within that
window, including disabled Carriers; null ETAs are excluded. The full total and
at most five rows share the statement snapshot. Order is ETA, creation time and
internal identity ascending. Recent tracking changes remains absent.

View all uses `tab=all`, the response window as `estimatedDeliveryFrom`/`To`,
`undeliveredOnly=true`, and `sortBy=estimatedDeliveryOn&sortDirection=asc`.
Search uses identity for equal-ETA ties, so totals/membership match without
promising identical first-five ordering. No migration or dependency was added.

| Route                                        | Input → success                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/shipments`                      | No input → 200 unpaginated array, newest created first.                                                                                                                                                             |
| `GET /api/v1/shipments/search`               | Query described above → 200 ShipmentSearchResponse. Static route is registered before UUID detail.                                                                                                                  |
| `GET /api/v1/shipments/:externalId/history`  | Strict `page`/`pageSize` query → 200 ShipmentHistoryResponse; missing/deleted Shipment → 404.                                                                                                                       |
| `GET /api/v1/dashboard/overview`             | No input → 200 OverviewResponse with bounded Needs attention items and its full total.                                                                                                                              |
| `GET /api/v1/shipments/:externalId`          | No input → 200 Shipment.                                                                                                                                                                                            |
| `POST /api/v1/shipments`                     | `{ carrierExternalId, trackingReference, notes?, salesRepExternalId?, followUpOn? }` → `{ outcome: "created" \| "existing", shipment: Shipment }`; 201 when created, 200 when already existing.                     |
| `PATCH /api/v1/shipments/:externalId`        | Any nonempty subset of `{ notes, salesRepExternalId, followUpOn }` → 200 Shipment. Assignment/follow-up changes populate `recordUpdatedAt`/`recordUpdatedBy`; every DB write still updates the general `updatedAt`. |
| `DELETE /api/v1/shipments/:externalId`       | No body → 204. Soft deletion; a second delete returns 404.                                                                                                                                                          |
| `POST /api/v1/shipments/:externalId/pause`   | `{}` → 200 Shipment; only active to manual pause.                                                                                                                                                                   |
| `POST /api/v1/shipments/:externalId/resume`  | `{}` → 200 Shipment; only manual pause to active/due now.                                                                                                                                                           |
| `POST /api/v1/shipments/:externalId/refresh` | Empty or `{}` → 202 TrackingRun (below).                                                                                                                                                                            |

Creation accepts one strict object per request. References are trimmed, nonblank strings
up to 255 UTF-16 code units, with no NUL; preserve leading zeros and case. The
worker has additional provider-specific validation, so acceptance is not proof
the Carrier can find it. Notes are trimmed, 1–500 code units, no NUL; use null
to clear, not `""`. Unknown fields reject the input, including actor IDs.

An existing nondeleted Carrier/reference pair is returned with `outcome: "existing"`
without modifying its notes/state, even when paused or completed. Soft-deleted
pairs may be added again with `outcome: "created"` and a new UUID.
Do not show success for invalid input: an invalid request inserts nothing.
Creation errors use `{ message, code: 'shipment_validation_failed', details:
[{ field, message }] }`, where `field` is allowlisted and contains no submitted value.

`verificationUrl` remains null until a successful lookup populates it. Open
external links with `noopener noreferrer`. A disabled Carrier prevents creation
and refresh; existing Shipments remain visible. Delivered is terminal.
Manual pause and threshold pause are distinct: threshold-paused Shipments can
be refreshed and reactivate on found, but cannot use manual `resume`.

`GET /api/v1/sales-reps` returns active Sales Reps for Staff assignment. Admins
use `GET/POST /api/v1/admin/sales-reps`, `GET/PATCH/DELETE
/api/v1/admin/sales-reps/:externalId`, and `POST
/api/v1/admin/sales-reps/:externalId/restore` for CRUD and soft-delete
configuration. Delete is reversible soft deletion; existing Shipment references
remain valid and display the inactive rep.

## Carrier contract

`GET /api/v1/carriers` returns an array; `GET /api/v1/carriers/:externalId` returns one record.
Both include disabled nondeleted Carriers. Fields are `externalId`, immutable
`code`, `name`, `isActive`, `fetchMode`, `notFoundPauseThreshold`,
`pollIntervalMinutes`, `rateLimitPerMinute`, `createdAt`, `updatedAt`.

Admin `PATCH /api/v1/carriers/:externalId` accepts a nonempty subset of the mutable
fields. Name: trimmed 1–100 characters. Threshold: integer 2–32767; interval:
integer 1–32767 minutes; RPM: integer 1–32767 or null. Omitted fields retain their
values; explicit null clears RPM only. Fetch mode is `request` for UPS, `request`
or `browser` for EchoShip/FFE. Request is the current seed default for all three.
No Carrier creation, deletion or restoration route exists.

Polling is not exact wall-clock scheduling: one worker scans each minute and
executes Carriers sequentially. Adapter minimums can exceed the displayed setting
(UPS production 30 minutes/CIE 60; EchoShip/FFE five). Manual refresh bypasses due
time, not provider rate limits, and does not delay an active scheduled check.

## Run status and live updates

`POST /api/v1/shipments/:id/refresh` returns a TrackingRun. Duplicate queued/running
requests coalesce and keep the original requester. An idle worker discovers the
request on its next minute scan; 202 does not mean the Carrier has been queried.
The response can already be terminal if it races worker completion.

```ts
type TrackingRun = {
  externalId: string;
  trigger: 'scheduled' | 'manual';
  fetchMode: 'request' | 'browser' | null;
  status:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'partially_succeeded'
    | 'failed'
    | 'cancelled';
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};
type RunStatus = TrackingRun & {
  carrierExternalId: string;
  reasonCode: string | null;
  attempts: Array<{
    shipmentExternalId: string;
    outcome: 'pending' | 'found' | 'not_found' | 'failed' | 'skipped';
    snapshotChanged: boolean;
    retryable: boolean | null;
    reasonCode: string | null;
    completedAt: string | null;
  }>;
};
```

`GET /api/v1/tracking-runs/:externalId` returns RunStatus. Run success means processing
finished without technical failures, not that a Shipment was found or delivered.
Not-found is different from technical failure; failure preserves the known
snapshot and not-found count. A skipped lookup can safely produce a successful
run. Treat reason codes as diagnostics; unknown codes need a generic safe message.

Open `new EventSource(apiOrigin + '/api/v1/events', { withCredentials: true })` once
authenticated. Named events:

| Event              | Data                                             | Client action                                                                                      |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `resync`           | `{}`                                             | Reload authoritative Shipments and any displayed run. Sent on connection and DB listener recovery. |
| `shipment.changed` | `{ externalId }`                                 | Invalidate/refetch the affected Shipment/list; 404 means deleted.                                  |
| `run.changed`      | `{ externalId }`                                 | Refetch that displayed run.                                                                        |
| `tracking.changed` | `{ externalId, snapshotExternalId, observedAt }` | Record the new public snapshot revision, then refetch authoritative Shipment and overview data.    |
| `heartbeat`        | `{}`                                             | Liveness signal every 15 seconds; no data mutation.                                                |

`tracking.changed` is emitted after commit when a Shipment's current snapshot
pointer changes to a non-null snapshot, including its first successful tracking
observation. `externalId` and `snapshotExternalId` are public UUIDv4 values;
`observedAt` is a canonical UTC ISO timestamp such as
`2026-10-16T00:00:00.000Z`. Notes, scheduling, pause/resume, failed/not-found
lookups and successful unchanged lookups do not emit this precise event. The
same tracking update still emits the compatible generic `shipment.changed` event.

Subscribe before the initial HTTP fetch. Track invalidations arriving during
each fetch and perform a follow-up fetch so a stale in-flight response cannot
overwrite a newer event. Debounce bursts and clean up subscriptions on logout,
navigation and unmount. Events are invalidations, not a replayable state log:
`Last-Event-ID` has no replay semantics. Reconnect and refetch on every resync.
Use `snapshotExternalId` as the deduplication/revision key for alerts and
highlights; an event timestamp is observation data, not an ordering cursor.

On EventSource errors, check `/api/v1/auth/me` once with backoff; close the stream for
401/restricted sessions instead of an endless login loop. Slow consumers are
disconnected; heartbeat revalidates quiet sessions. SSE proxies must preserve
streaming without buffering and allow long-lived responses. Carrier-setting
changes do not emit a Carrier event; refresh the Carrier list after edits and on
page focus/reconnect if settings are displayed.

## Errors and frontend acceptance checklist

Use status codes, not raw library diagnostics: 400 invalid input; 401 session;
403 origin/role/replacement; 404 missing/deleted; 409 forbidden state transition;
429 rate limit; 5xx safe generic failure. Do not assume every error body shares
the field-validation shape or contains a machine code. Do not automatically retry
non-idempotent mutations. Display generic connectivity errors without inventing
successful tracking results.

Before frontend handoff, test these groups against the real local backend:

1. Login, restricted-password flow, logout, expired/revoked session, refresh
   restoration, Staff/Admin authorization and account protection conflicts.
2. Single add, field validation, duplicates, literal leading zeros, edit/clear notes,
   soft delete/re-add and disabled Carrier behavior.
3. Manual pause/resume, threshold-pause refresh, terminal delivery, duplicate
   refresh coalescing and run queued/running/terminal rendering.
4. SSE reconnect/resync, event-during-fetch reconciliation, deleted row, revoked
   session and complete subscription cleanup.
5. Credentialed browser CORS/cookies on the actual chosen production domains;
   snapshot UUID/null/date semantics across reads and mutation responses.

See backend test examples in `test/e2e/auth.spec.ts`, `shipments.spec.ts`,
`carriers.spec.ts` and `refresh.spec.ts`. Tests are evidence, not a reason to copy
their fixture credentials into frontend configuration.

## SQ-V1-003 asynchronous quote comparisons

Staff and Admin can create, list, and read all non-deleted comparisons. Existing
session, password-change, trusted-Origin and no-store policies apply.

| Method/path (under `/api/v1`)                             | Contract                                                                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/quote-comparisons/providers`                        | Array of `{code,name,enabled,executionMode}`; mode is `request` or `browser`, and codes are `amazon` and `unishippers`.                                                                  |
| POST `/quote-comparisons/providers/:code/default-refresh` | Empty body; waits up to 90 seconds for the worker. Returns `{refreshId,address,retrievedAt}`; failure is 503 and explicit sender entry remains available. Client timeout is 120 seconds. |
| POST `/quote-comparisons`                                 | Strict input below; returns `{outcome: created/existing,comparison}`, HTTP 201/200. Reused key with changed input is 409.                                                                |
| GET `/quote-comparisons?page=1`                           | `{items,total,page,pageSize:25}`, newest first with a stable ID tie-breaker.                                                                                                             |
| GET `/quote-comparisons/:externalId`                      | One immutable comparison, or 404.                                                                                                                                                        |

Input contains `idempotencyKey` (UUID), `shipDate` (YYYY-MM-DD, current/future in
America/New_York), `destination`, `providers[]`, and `packageGroups[]`.
Addresses contain `name,street,city,division,postalCode,country` plus optional
`street2`; sender country is US. Country and currency values must be assigned ISO 3166-1
alpha-2 and ISO 4217 codes.
Provider entries contain `code`, `sender`, and `options`. Sender is
`{mode:explicit,address}` or `{mode:account_default,refreshId}`. Options contain
`signature` (`none`, `signature`, `adult_signature`) and nullable
`insurance:{amount,currency}`. Amounts and measurements are decimal strings.
Groups contain positive integer `quantity`, `units` (`imperial` or `metric`),
`length,width,height,weight`, and `customsItems`. International groups require
per-box items with `description,quantity,unitValue,currency,countryOfManufacture,
weight` and optional/blank `hsCode`. Unknown support never implies included coverage.
The three dimension strings may all be blank only when myUnishippers is the sole
selected provider and its current `executionMode` is `request`. Partial dimensions,
Amazon comparisons, mixed-provider comparisons, and browser mode require all three.
Weight remains required in every mode.

Comparison returns `externalId,createdAt,createdBy` (actor public UUID), `input`,
`senders`, `warnings`, `status`, `ratesRun`, and `attempts`. Resolved senders contain
`code,address,mode,retrievedAt`; explicit addresses have null retrieval time.
New comparisons start `queued`; historical `saved` records remain unchanged.
Status is `saved|queued|running|completed|failed`; completed means at least one
successful provider after all attempts finish, so inspect each attempt for partial
failure. `ratesRun` indicates an execution started, not a successful real quote.
Retry and soft-delete/restore are implemented by SQ-V1-007 below. Purchase and
provider-admin endpoints remain deferred.

Each attempt contains `externalId,provider,status,attemptNumber,executionMode,
startedAt,completedAt,recoveryCount,outcome,reasonCode,simulated,quotes`.
Mode is null until execution; timestamps are nullable ISO UTC strings. Outcome is
null until terminal, then `success|validation_failed|unsupported|timeout|
authentication_failed|failed`. Diagnostics and lease ownership remain private.
Known reasons are `adapter_unavailable,provider_disabled,validation_failed,
sender_company_too_long,contact_details_required,
unsupported,timeout,authentication_failed,provider_failed,recovery_exhausted`.
Unknown reasons must use generic safe UI copy.

For myUnishippers, `platform` is `myUnishippers` and `carrier` is the delivering
carrier (normally UPS). Request mode submits all package groups to the provider's
native estimate contract, so the displayed total is the provider's whole-shipment
total and the frontend must not multiply it again. When all dimensions are blank,
request mode omits the native `billedDimension` field. Browser mode drives the provider's
full small-package form, including native quantities, package groups, converted
dimensions/weight, addresses, and ship date. It never substitutes Quick Quote.
Addresses accept optional `contactName` (100 characters) and `phone` (30 characters;
validated against the address country with libphonenumber metadata). Browser quotes require receiver
contacts and contacts for an explicit sender; missing values return
`contact_details_required`. Existing comparisons remain readable without these fields.
`sender_company_too_long` failure is actionable: Copy to new comparison, choose
Explicit sender, and correct the sender company name. That correction is comparison
specific and does not update the provider address book.

Each quote contains `platform,carrier,service,transportationTotal,currency,estimateMethod,
transitDescription,retrievedAt,expiresAt,optionCoverage,dutyStatus,taxStatus,
clearanceStatus,charges,groupContributions`. Each charge contains its description,
exact amount, scope (`package|shipment|pickup`), and optional package-group position.
Each group contribution contains its group position, quantity, and exact subtotal.
Money is an exact decimal string; missing carrier, service, transit, or expiry displays
**Not provided** in the UI.
Demo results are always `simulated:true` on the attempt and must be visibly labelled
**Simulated rates — not provider quotes**. Requested option coverage remains unverified.

`GET /quote-comparisons/:externalId/events` is credentialed SSE. It emits
`quote.changed` with only `{externalId}`, `resync` with `{}` on connect/listener
recovery, and 15-second `heartbeat` with `{}`. Every frame rechecks the session
and comparison visibility. All unrestricted employees share non-deleted history;
streams filter to the requested comparison and close if access is lost.
Events are transient hints, without replay or sequence guarantees. Subscribe while
viewing nondeleted detail; fetch authoritative detail after open/resync/change. Serialize reads
and reread if another hint arrives during a request. The frontend also refreshes
visible comparisons every 15 seconds to recover missed signals, closes streams on
session loss/unmount/deletion, and retries failed connections after session recheck.

The UI lives at `/quotes`, `/quotes/new`, and `/quotes/:comparisonId`. Saved details
are read-only. Copy uses `/quotes/new?copy=<uuid>`, creates a fresh save key, refreshes
account defaults, omits now-disabled providers, and retains other original inputs.
An old ship date must be corrected before saving the copy. Failed save retries keep
the same key while input is unchanged; edited input receives a new key.

### SQ-V1-007 history and retry

- `POST /quote-comparisons/:externalId/attempts/:attemptId/retry` returns the updated
  comparison (201). The attempt UUID identifies the failure being retried; a stale,
  nonlatest, successful, validation-failed, unsupported, queued, or running attempt
  returns 409. A missing/deleted comparison returns 404. Staff and Admin may retry.
- Retry preserves the original input, resolved sender, conversions, earlier attempts,
  and quotes. It uses the current provider mode when execution starts. Eligibility
  is checked under database locks and again at worker claim: disabled providers,
  past ship dates (America/New_York), and currently invalid inputs cannot execute.
  Correcting input requires Copy to new comparison. One provider can retry while
  the other runs; duplicate clicks cannot enqueue a second active attempt.
- `DELETE /quote-comparisons/:externalId` (Admin, 200) soft deletes only completed or
  failed comparisons without active attempts. `POST /quote-comparisons/:externalId/restore`
  (Admin, 201) restores visibility without running rates. Repeating either operation
  retains its timestamp. Children are retained; there is no purge or cancellation.
- `GET /quote-comparisons?deleted=true&page=1` lists deleted records for Admin only
  (Staff receives 403). Normal lists exclude deleted records. Admin can open deleted
  detail; Staff receives 404, including on the SSE endpoint.
- Comparison adds nullable `deletedAt,lastDeletedAt,restoredAt`. The last two retain
  the latest lifecycle timestamps after restore. Attempts add `createdAt,sender`
  and nullable `retryBlockedReason` (null means eligible). Reasons are
  `comparison_deleted,newer_attempt,attempt_active,outcome_not_retryable,
provider_disabled,ship_date_passed,input_invalid`. Unknown reasons fail closed.
- Results add nullable `staleAt`: null when provider expiry is known, otherwise
  retrieval time plus the provider's currently configured stale hours (default 24).
  Provider expiry is authoritative; changing stale policy changes its derived
  deadline without rewriting quote history.
- Frontend price sorting and Lowest price require equivalent actual origin,
  currency, shared immutable shipment details, and requested options. Requested
  options with unverified/unsupported coverage and mixed simulated/real rates also
  suppress an overall winner. Ties share the badge. Stale/expired/unknown-freshness
  rates never receive it; all rates remain readable. Exact comparison uses decimal.js.
- Visible details refresh every 15 seconds, including terminal comparisons. SSE
  stays subscribed to nondeleted detail so another user's retry is observed.
  A confirmed 401/403/404 hides cached detail. Deleted Admin views use polling;
  retry/delete/restore invalidate the detail and all history query variants.
  The UI updates freshness locally as deadlines pass, with timestamps labelled ET.

### Sender refresh operational boundary

The API queues a bounded refresh in the provider account row and the worker reads
it through a feature-owned repository. Only the worker launches Playwright and
holds browser credentials/cookies. Each operation uses a fresh isolated browser,
with a 75-second browser deadline. Missing configuration, authentication challenges,
incomplete addresses, and ambiguous Amazon pickup addresses fail closed. There is
no quote request or provider-account mutation. Concurrent API refreshes for one
provider share work. The worker handles one default lookup at a time; no rates run.

After success the API keeps an actor-bound immutable refresh snapshot (up to 2,000
across the single API process). Later refreshes cannot overwrite it. API restart or
capacity eviction requires refreshing again before saving; explicit input is the
fallback. Completed comparisons persist their resolved sender permanently.
Provider disablement is rechecked in the save transaction. Credentials are read only
from `AMAZON_SHIPPING_EMAIL/PASSWORD` and `MYUNISHIPPERS_EMAIL/PASSWORD` environment
variables; raw provider responses, tokens, and cookies are never persisted.
