# V1-015: FFE request-based exploration

This document preserves discovery-time findings and recommendations. The approved
[implementation specification](V1-015-ffe-adapter.md) supersedes open decisions
below: both modes use one-year JSON searches, Cheerio parses login HTML, pickup
prefers actual then appointment, status detail is null, and duplicate exact IDs
use the first record because reliable update ordering was not established.

> Discovery evidence. Completed adapter verification is recorded in the
> [implementation summary](../implementation-summary/V1-015-implementation-summary.md).
> XML is unnecessary for the demonstrated per-reference JSON lookup path.

## Result and scope

**Request-based login and per-reference tracking are feasible.** On 2026-10-14,
a fresh Axios process authenticated using local FFE credentials and retrieved
three account-visible shipments through `POST /Customer/LoadShipmentTrackingData`.
Their projected tracking fields matched independently inspected browser responses.
The process launched no browser, imported no browser cookies/storage, and
downloaded no XML.

Several references work through sequential filtered calls in one authenticated
session. **A native multi-reference request is not established:** comma-separated
references and regex alternation both returned zero matches for two individually
retrievable references. This does not prove that every possible batch API is absent.

The user approved installed Axios, cookie-jar support, Playwright, and Zod for
discovery. That discovery phase installed no dependency and changed no application
source, database, worker registration, or production carrier settings. The later
approved implementation is documented separately above.

Repository baseline: `77169c1`. Reference project:
`/home/jeff/apps/shipment-monitoring/robin-monitoring-automation` at `881985d`.
The reference project was read without modification. Pre-existing untracked
`sample.txt` is unrelated and remains untouched. This follows
[V1-014's exploration](V1-014-echoship-request-exploration.md).

## Observed request contract

All requests were pinned to `https://www.ffeinc.com`. These are observed internal
portal endpoints, not a verified supported public API.

| Operation      | Method and path                           | Observed contract                                                                                                                                                        |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login form     | `GET /Account/Login`                      | HTML form and anti-forgery cookie; extract hidden `__RequestVerificationToken`.                                                                                          |
| Sign in        | `POST /Account/Login`                     | URL-encoded `ReturnUrl` (empty), `UserName`, `Password`, `__RequestVerificationToken`; retain the cookie jar. Success returned 302 to `/Customer` and a `USERID` cookie. |
| Protected page | `GET /Customer/ShipmentTracking`          | Authenticated: 200 HTML with `shipmentTrackingDataTable`. Unauthenticated: 302 to `/Account/Login`.                                                                      |
| Tracking data  | `POST /Customer/LoadShipmentTrackingData` | JSON DataTables request with an order-number column filter; envelope contains `draw`, `recordsFiltered`, `recordsTotal`, and `data`.                                     |

The probe did not follow the login redirect or navigate to the tracking page
before its first lookup. It sent no copied browser headers, Basic credentials,
or anti-forgery header on data requests. The token was used in the login form;
cookies remained in memory.

Observed cookie metadata: `.AspNetCore.Antiforgery.lTla9bK8UdU` was an HttpOnly,
SameSite=Strict session cookie; `USERID` was HttpOnly with an explicit expiry.
Both had `Path=/`; neither carried `Secure` in the observed response. Keep the
transport HTTPS-only regardless. Cookie/token values are not retained. Session
lifetime, expiry behavior, MFA/CAPTCHA, and forced logout were not tested.

### Shipment request body

The portal uses DataTables with `serverSide: true`. Its `Order# Search` control
changes `columns[0].search.value`. Successful replay preserved the complete
observed columns array, ordering, and blank other filters. This TypeScript example
describes the captured contract; it is not production code:

```typescript
const columnNames = [
  'orderNumber',
  'bolNumber',
  'poNumber',
  'pickupLocation',
  'shipmentStatus',
  'stringApptPickupDate',
  'stringApptDeliveryDate',
  'consignee',
  'city',
  'state',
  'stringDeliveryDate',
  'unitLatitude',
  'unitLongitude',
  'orderStatusId',
];

const body = {
  draw: 2,
  columns: columnNames.map((name) => ({
    data: name,
    name,
    searchable: true,
    orderable: true,
    search: { value: name === 'orderNumber' ? reference : '', regex: false },
  })),
  order: [{ column: 10, dir: 'desc' }],
  start: 0,
  length: 25,
  search: { value: '', regex: false },
  archiveLimit: '90',
};
```

The UI offers page sizes 25/50/75/100/200 and archive windows of 90/365 days.
The probe additionally verified `length: 1`, `start: 0` and `start: 1`: each
returned one distinct row from four filtered matches. No provider maximum size
or rate limit was established. A reduced request payload was not tested.

The page script also names `POST /Customer/ShipmentTrackingDetail` with a form
field `orderNumber`; it inserts the response into an HTML panel. That endpoint
was not needed or replayed. Document/map/export routes were not invoked.

## Live evidence and mapping

Three samples were selected from different account-visible status values. Each
full order filter returned one exact row, `recordsFiltered: 1`, and
`recordsTotal: 16` in the 90-day scope.

| Reference | Carrier status  | Appointment pickup | Appointment delivery | Delivered  |
| --------- | --------------- | ------------------ | -------------------- | ---------- |
| `9708239` | `Delivered`     | 2026-09-24         | 2026-09-30           | 2026-09-30 |
| `9718040` | `Scheduled`     | 2026-10-07         | 2026-10-14           | Absent     |
| `9723395` | null / blank UI | 2026-10-15         | Absent               | Absent     |

Browser cells matched corresponding formatted API fields. All 13 retained API
fields per sample matched the fresh Axios response. The third sample had
`requestedDeliveryDate: 2026-10-23T00:00:00`, although its appointment delivery
column was blank. Estimate precedence therefore needs an explicit decision.

| API field                                                        | Mapping finding / decision                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `orderNumber`                                                    | String identity; preserve leading zeros and require exact equality after agreed canonicalization.             |
| `shipmentStatus`                                                 | May legitimately be null; do not invent a status from appointment dates.                                      |
| `pickupDate`                                                     | Null in all samples; actual pickup remains unverified.                                                        |
| `apptPickupDate` / `stringApptPickupDate`                        | Appointment date. The old XML adapter mapped this to pickup; that does not establish actual pickup semantics. |
| `apptDeliveryDate`, `schedDeliveryDate`, `requestedDeliveryDate` | Estimate candidates in the old adapter's precedence order; agree API mapping explicitly.                      |
| `deliveryDate` / `stringDeliveryDate`                            | Populated for the delivered sample. Agree whether to preserve the old delivered-status gate.                  |

Raw dates used `YYYY-MM-DDT00:00:00` without timezone suffix; display strings
used `MM/DD/YYYY` or empty strings. Prefer validated calendar dates without
worker-local timezone conversion. Null fields must interact deliberately with
GRD's previous-value preservation rule. No in-transit, malformed-date,
duplicate-exact-ID, or actual-pickup sample was established.

## Filtering, authentication, and safe absence

| Probe                                     | Observed result                                                             | Consequence                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Partial order `97082`                     | Row `9708239` returned                                                      | Search is not exact equality; validate identity.                                       |
| `9708239,9718040`                         | Zero filtered rows                                                          | Comma syntax did not retrieve the two known references.                                |
| `9708239\|9718040`, `regex: true`         | Zero filtered rows                                                          | Regex alternation did not implement batch lookup.                                      |
| Numeric missing control `000000000000000` | Zero rows in both archive windows; totals remained 16/50                    | Authenticated empty shape observed; the synthetic input's validity is not established. |
| Archive `90` versus `365`                 | Total rows increased from 16 to 50; known delivered reference still matched | Default scope hides older shipments.                                                   |
| Data request with empty cookie jar        | HTTP 200, `{ draw: 1, recordsFiltered: 0, recordsTotal: 0, data: [] }`      | Valid empty JSON does not prove authentication or absence.                             |

The protected HTML page distinguished the tested authenticated/unauthenticated
states. Recommend checking it when establishing the session and when a lookup
is empty or suspicious. Validate redirects explicitly; login HTML must become
an authentication failure. This is a proposed guard, not proof against every
expiry race between requests. Validate response/request draw correlation, but
do not treat that alone as an established authentication contract.

Return `not_found` only after verified authentication, complete validated filtered
results within the agreed archive scope, and no exact match. Bound pagination;
page-cap exhaustion, changing totals, invalid JSON, untrusted redirects,
and ambiguity are technical failures. Empty 90/365-day results do not establish
absence across all history. The date FFE uses for archive filtering and retrieval
beyond one year remain unverified.

## Recommended implementation direction

Use one isolated request session per run and sequential filtered JSON reads for
requested references. This fits both `read` and `readMany` without downloading
the whole account or parsing XML. Reconcile this direction into V1-015 before
production implementation.

Reuse installed `axios@1.20.0`, `axios-cookiejar-support@7.0.0`,
`tough-cookie@6.0.2`, and `zod@4.6.6`. Installed `playwright@1.64.0` supports
inspection and a possible explicitly selected browser backup. No XML parser is
needed. The diagnostic token extractor is a narrow form match, not a production
HTML parser; settle robust form parsing during implementation.

The [Axios cookie-jar integration](https://github.com/3846masa/axios-cookiejar-support)
fits the existing EchoShip transport. Playwright's
[APIRequestContext](https://playwright.dev/docs/api/class-apirequestcontext)
is an alternative with cookie handling, subject to separate response-bound
evaluation. Neither requires a custom cookie jar.

`TrackingSession` already supports `read` and optional `readMany`, and the
executor prefers the latter. At discovery time FFE's mode metadata allowed only
`browser`; the completed implementation adds request mode and API tests. No new scheduler
is needed for the demonstrated flow. The old reference's 100-character validator
must not silently replace GRD's 255-code-unit creation contract.

Suggested boundaries: configuration, isolated auth/client, response schemas,
mapping, session adapter, and fixture tests. Agree deadlines, response/page caps,
pacing, cancellation, retry/re-login policy, and supported modes. The probe used
a 20-second request deadline, 1 MiB response cap, no redirects, and no retries;
these are diagnostic choices, not provider limits or approved production defaults.

## Source data and private artifacts

Responses include addresses, account identifiers, weights, instructions, and
document/map metadata. Retain only the exact matching reference and consumed
status/date fields. Reconcile a minimal camelCase API allowlist with the
[FFE source-data policy](../tracking-source-data-policy.md#ffe-allowlist-example),
which originally illustrated XML field names. The completed implementation now
uses the approved eight-field camelCase projection and null status detail.

Evidence is under ignored **`artifacts/ffe/v1-015/`**, restricted to the local user.
Captures exclude credentials, cookie values, anti-forgery values, raw HTML, full
data rows, and XML. Static portal script text is retained with its public map key
redacted. Projected shipment evidence is still private diagnostic material.

| Artifact                                            | Purpose                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `inspect.mts`, `page-contract.json`, `network.json` | Browser recipe, controls/static scripts, request/response-shape metadata.                              |
| `request-template.json`, `browser-comparisons.json` | Observed request template and three minimal UI/API comparisons.                                        |
| `request-probe.mts`, `request-probe.json`           | Fresh HTTP login and eight single-reference/filter/archive/batch-candidate results.                    |
| `request-controls.json`                             | Separate session verifying unauthenticated behavior, protected page, pagination, and archive controls. |
| `README.md`, `manifest.json`                        | Reproduction/privacy notes and generated hashes.                                                       |

Reproduce from the repository root only for an intentional live diagnostic pass:

```sh
node artifacts/ffe/v1-015/inspect.mts
node artifacts/ffe/v1-015/request-probe.mts
node artifacts/ffe/v1-015/request-probe.mts --controls-only
```

Scripts read local `.env` credentials, close the browser and clear HTTP cookie
state, and overwrite named captures. Preserve a dated copy before rerunning if
needed. These are diagnostic scripts, not production adapters or CI tests.

## Verification and limitations

- `node artifacts/ffe/v1-015/inspect.mts`: passed login, JSON discovery, and three
  filtered browser comparisons; Chromium closed afterward.
- `node artifacts/ffe/v1-015/request-probe.mts`: passed fresh login and eight
  lookup/control requests; all three projections matched browser evidence.
  No browser state imported or XML requested.
- `node artifacts/ffe/v1-015/request-probe.mts --controls-only`: passed separate
  fresh login, protected-page check, two distinct one-row pages, and one-year
  exact/missing controls; unauthenticated empty response recorded explicitly.
- Documentation formatting, final diff review, artifact secret scans,
  permissions/hashes, and Git exclusion checked for handoff.
- Application unit/integration/e2e tests, typecheck, and build were not run:
  application code and dependencies were unchanged. No database writes or
  deployment occurred. Feasibility is not proof of production resilience.

## Decisions before implementation

1. Approve per-reference JSON requests in one session and supported modes;
   native batch retrieval is not demonstrated.
2. Set archive coverage and authenticated absence rules, including history beyond
   one year and empty-account/session-expiry behavior.
3. Set pickup/estimate/delivery semantics, null handling, ambiguity rules, and
   minimal API source data.
4. Set I/O bounds, pacing, cancellation, authentication parsing and retry policy;
   cover these with fixtures and reconcile the ticket/shared documentation.
