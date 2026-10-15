# Frontend handoff — backend v1

## Start here

Read [auth-api.md](auth-api.md), then this document. The frontend is a separate
project; no frontend framework, package choice or UI implementation is selected
by this ticket. The legacy UI is reference behavior, not this API's protocol.

Backend intended origin: `https://api.globalresourcesdirect.com`.
Frontend intended origin: `https://dashboard.globalresourcesdirect.com`.
Local defaults: API `http://localhost:3000`, frontend `http://localhost:5173`.
Use the [root README](../../README.md) to start/seed the backend and bootstrap an
Admin. There is **no `/api` prefix** and no public signup.

Hosting remains undecided. Caddy, production Compose, App Platform specifications,
deployment workflows and CI/CD are deferred. Do not infer same-Droplet routing,
copy the Tom application's proxy blindly, or build an Origin-stripping proxy.

## Tracking projection, search, history, overview and live changes

BE-V1-001 adds stored `currentTracking`, `latestLookup`, and `latestRun` to every
Shipment response, including inserted/duplicate batches and notes/pause/resume.
Apply migration `1792281600000-TrackingReadProjection` before running this API.
Carrier status is distinct from `monitoringStatus` and lookup outcome.

BE-V1-002 adds authenticated, paginated whole-dataset search at
`GET /shipments/search`. BE-V1-003 adds normalized snapshot history at
`GET /shipments/:externalId/history`. BE-V1-004 adds the operational overview at
`GET /dashboard/overview`. BE-V1-005 adds precise committed tracking-change
events to the existing live stream. Source-data diagnostics, refresh-all and
scheduler controls remain unavailable. Manual refresh returns a run ID that
stays independently readable through
`GET /tracking-runs/:externalId`.

## Browser session flow

1. `POST /auth/sign-in` with `{ email, password }`. Successful JSON is the account
   profile, not a token. Every API fetch uses `credentials: 'include'`.
2. If `mustChangePassword` is true, show only password replacement and sign-out.
   `POST /auth/change-password` accepts `{ currentPassword, newPassword }` and
   returns 204. All sessions are revoked: clear cached state and sign in again.
3. `GET /auth/me` restores the session/profile on reload. A 401 means sign-in is
   required. On a business 403, refresh `/auth/me` to distinguish restricted
   password replacement from role denial. Do not repeatedly retry auth failures.
4. `POST /auth/sign-out` with `{}` returns 204; close SSE and clear cached data.
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
const response = await fetch(`${apiOrigin}/auth/sign-in`, {
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
responses remain `no-store`. Public projections omit internal IDs, actors,
source data, credentials, lock versions and provider diagnostic messages.

The list frontend should use `GET /shipments/search`; the legacy array endpoint
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
`lookupOutcome` is `never_checked`, `found`, `not_found`, `failed`, or `skipped`;
pending-only Shipments are `never_checked`.

`createdFrom`/`createdTo` are inclusive `YYYY-MM-DD` dates in
`America/New_York`. `estimatedDeliveryFrom`/`estimatedDeliveryTo` are inclusive
calendar dates and exclude null ETAs. `undeliveredOnly=true` excludes completed
Shipments. Reversed or invalid ranges return 400. Pagination defaults to page 1
and 25 rows; only 25/50/100 are accepted. Sorting defaults to `createdAt desc`;
`trackingReference`, `estimatedDeliveryOn`, and `lastAttemptedAt` plus `asc` or
`desc` are also accepted. Null sortable values always appear last.

`total` includes the selected tab and all filters. `tabCounts` applies every
non-tab filter and ignores the selected tab. Attention is intentionally
overlapping: it means a non-completed Shipment whose latest completed lookup
failed, or a threshold-paused Shipment. Active Shipments stay Active when their
Carrier is disabled. Search items, total, and counts come from one PostgreSQL
statement snapshot. Separate page requests remain live offset reads rather than
a frozen result set.

Shipment detail history uses
`GET /shipments/:externalId/history?page=1&pageSize=25` and returns:

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

`GET /dashboard/overview` is available to unrestricted Staff and Admin sessions,
uses `Cache-Control: no-store`, accepts no body, and returns:

```ts
type OverviewResponse = {
  asOf: string;
  timezone: 'America/New_York';
  upcomingWindow: { from: string; to: string };
  counts: {
    all: number;
    active: number;
    paused: number;
    delivered: number;
    attention: number;
  };
  attention: { total: number; items: Shipment[] };
  upcomingDeliveries: { total: number; items: Shipment[] };
  recentChanges: Array<{
    shipmentExternalId: string;
    trackingReference: string;
    carrier: { externalId: string; code: string; name: string };
    snapshot: TrackingSnapshot;
  }>;
};
```

All values come from one PostgreSQL statement snapshot identified by `asOf`.
Counts cover nondeleted Shipments and include Shipments whose Carrier is disabled.
They use the same monitoring and attention predicates as Shipment search.
Attention is a non-completed Shipment whose latest completed lookup failed, or a
threshold-paused Shipment; the panel is newest-created first and is unrelated to
delivery lateness.

`upcomingWindow` is the inclusive New York business-date range from today through
day +6. Upcoming deliveries are non-completed Shipments whose current normalized
snapshot has a non-null ETA in that range. The panel sorts ETA ascending, then
creation time and a server-only identity ascending. Drill down with
`GET /shipments/search?tab=all&undeliveredOnly=true&estimatedDeliveryFrom=<from>&estimatedDeliveryTo=<to>&sortBy=estimatedDeliveryOn&sortDirection=asc`.

`attention.total` and `upcomingDeliveries.total` cover every matching Shipment,
while each panel returns at most 10 full safe Shipment projections. Recent changes
returns at most the 10 newest persisted normalized snapshots for nondeleted
Shipments, ordered by `observedAt desc` and a server-only identity tie-breaker.
It includes first observations and changed observations; unchanged, failed,
not-found and skipped polls do not create entries. Counts are current monitoring
state totals, not delivered-today, on-time performance or analytics metrics.

| Route                                 | Input → success                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /shipments`                      | No input → 200 unpaginated array, newest created first.                                                                                                   |
| `GET /shipments/search`               | Query described above → 200 ShipmentSearchResponse. Static route is registered before UUID detail.                                                        |
| `GET /shipments/:externalId/history`  | Strict `page`/`pageSize` query → 200 ShipmentHistoryResponse; missing/deleted Shipment → 404.                                                             |
| `GET /dashboard/overview`             | No input → 200 OverviewResponse with bounded operational panels and full attention/upcoming totals.                                                       |
| `GET /shipments/:externalId`          | No input → 200 Shipment.                                                                                                                                  |
| `POST /shipments`                     | `{ items: [{ carrierExternalId, trackingReference, notes? }] }` → `{ inserted: Shipment[], duplicates: Shipment[] }`; 201 if any inserted, otherwise 200. |
| `PATCH /shipments/:externalId`        | `{ notes: string \| null }` only → 200 Shipment.                                                                                                          |
| `DELETE /shipments/:externalId`       | No body → 204. Soft deletion; a second delete returns 404.                                                                                                |
| `POST /shipments/:externalId/pause`   | `{}` → 200 Shipment; only active to manual pause.                                                                                                         |
| `POST /shipments/:externalId/resume`  | `{}` → 200 Shipment; only manual pause to active/due now.                                                                                                 |
| `POST /shipments/:externalId/refresh` | Empty or `{}` → 202 TrackingRun (below).                                                                                                                  |

Creation accepts 1–10 rows atomically. References are trimmed, nonblank strings
up to 255 UTF-16 code units, with no NUL; preserve leading zeros and case. The
worker has additional provider-specific validation, so acceptance is not proof
the Carrier can find it. Notes are trimmed, 1–500 code units, no NUL; use null
to clear, not `""`. Unknown fields reject the input, including actor IDs.

In-batch duplicate Carrier/reference pairs collapse with the last row's notes.
An existing nondeleted pair is returned as a duplicate without modifying its
notes/state, even when paused or completed. Soft-deleted pairs may be added again.
Do not show success for a partially valid batch: invalid rows insert nothing.
Row errors use `{ message, code: 'shipment_validation_failed', details:
[{ row, field, message }] }`, where row numbers are **1-based**.

`verificationUrl` remains null until a successful lookup populates it. Open
external links with `noopener noreferrer`. A disabled Carrier prevents creation
and refresh; existing Shipments remain visible. Delivered is terminal.
Manual pause and threshold pause are distinct: threshold-paused Shipments can
be refreshed and reactivate on found, but cannot use manual `resume`.

## Carrier contract

`GET /carriers` returns an array; `GET /carriers/:externalId` returns one record.
Both include disabled nondeleted Carriers. Fields are `externalId`, immutable
`code`, `name`, `isActive`, `fetchMode`, `notFoundPauseThreshold`,
`pollIntervalMinutes`, `rateLimitPerMinute`, `createdAt`, `updatedAt`.

Admin `PATCH /carriers/:externalId` accepts a nonempty subset of the mutable
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

`POST /shipments/:id/refresh` returns a TrackingRun. Duplicate queued/running
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

`GET /tracking-runs/:externalId` returns RunStatus. Run success means processing
finished without technical failures, not that a Shipment was found or delivered.
Not-found is different from technical failure; failure preserves the known
snapshot and not-found count. A skipped lookup can safely produce a successful
run. Treat reason codes as diagnostics; unknown codes need a generic safe message.

Open `new EventSource(apiOrigin + '/events', { withCredentials: true })` once
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

On EventSource errors, check `/auth/me` once with backoff; close the stream for
401/restricted sessions instead of an endless login loop. Slow consumers are
disconnected; heartbeat revalidates quiet sessions. SSE proxies must preserve
streaming without buffering and allow long-lived responses. Carrier-setting
changes do not emit a Carrier event; refresh the Carrier list after edits and on
page focus/reconnect if settings are displayed.

## Errors and frontend acceptance checklist

Use status codes, not raw library diagnostics: 400 invalid input; 401 session;
403 origin/role/replacement; 404 missing/deleted; 409 forbidden state transition;
429 rate limit; 5xx safe generic failure. Do not assume every error body shares
the row-validation shape or contains a machine code. Do not automatically retry
non-idempotent mutations. Display generic connectivity errors without inventing
successful tracking results.

Before frontend handoff, test these groups against the real local backend:

1. Login, restricted-password flow, logout, expired/revoked session, refresh
   restoration, Staff/Admin authorization and account protection conflicts.
2. Batch add, row validation, duplicates, literal leading zeros, edit/clear notes,
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
