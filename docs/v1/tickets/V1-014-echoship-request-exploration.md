# V1-014: EchoShip request-based exploration

> Historical exploration evidence, not the current implementation specification.
> The completed interview approved both modes, database-backed selection, fresh
> login per run without retries/re-login, calendar dates, and three dependencies.
> See [the reconciled ticket](V1-014-echoship-adapter.md) for current decisions.
> Later frontend inspection established estimate precedence: first Delivery stop
> `appointmentStart`, then `deliveryByDate`; both exclude year-one sentinels.
> Implementation-time frontend inspection corrected event ordering to
> `modifiedDate` descending, then `createdDate` descending. A later delivered-load
> smoke exposed the initial created-date-only assumption. The original observations
> below are historical and do not define the production mapping.
> A later live check also found that the feature-selected location-history panel
> can disagree with `/tracking`. The user selected the provider API as authoritative
> for both request and browser modes; browser DOM text is diagnostic only.

## Result and scope

**Request-based authentication and tracking are feasible.** On 2026-10-13,
an isolated Axios process logged in from credentials in the local `.env`, then
read search, detail, and tracking JSON for all three user-provided references.
It launched no browser and imported no browser cookies or storage state.
The latest tracking event matched the separately captured browser panel for
every reference after whitespace normalization.

This is a pre-grilling feasibility study and implementation proposal, **not a
completed V1-014 adapter**. Application source, dependencies, database, and worker
registration are unchanged. The user approved reusing Axios + Zod, with Playwright
only if needed. No new production dependency has been approved or installed.

Repository baseline: `476055e`. Reference project: `/home/jeff/apps/tom-automation`
at `67f96ec`. Its working tree was read without modification. The pre-existing
untracked `sample.txt` in this repository was left untouched.

## What was replicated from tom-automation

The useful pattern is browser inspection → captured request contract → isolated
authenticated HTTP session → validated response mapping.

| Reference file under `tom-automation` | Pattern to reuse                                                                               | EchoShip difference                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/worker/v2/auth-session.ts`       | Encapsulated authentication, serialized operations, invalidation, cleanup                      | Cvent still uses a persistent browser for login/refresh. EchoShip login worked directly over HTTP. |
| `src/worker/v2/http-client.ts`        | URL-scoped cookies, processing response cookie updates, explicit timeout and redirect behavior | Its `Cookie` import is Bun-specific. Do not copy it into this Node application.                    |
| `src/worker/v2/request-client.ts`     | Validate HTTP and application envelopes; safe error projection; bounded read retries           | EchoShip exposes REST-style JSON, not the Cvent GraphQL contract.                                  |
| `.gitignore`                          | Ignore captures, browser profiles, auth state and reports                                      | This repository now ignores equivalent local artifact locations.                                   |

Cvent's persistent profile and periodic homepage refresh are not required by this
EchoShip proof. Keep the existing GRD per-run session contract; the scheduler
already owns polling, sequential reads, cancellation and final session closure.

## Observed request contract

All requests below used `https://echoship.com`. These are the portal's observed
internal endpoints, not a verified public or supported EchoShip integration API.
Retain fixture coverage and expect the portal contract to change.

Paths deliberately retain the double slashes observed in browser traffic and
replayed successfully. Single-slash equivalents were not tested.

| Operation | Method and path                           | Observed contract                                                                                                                                                           |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login     | `POST /api/v1//auth/signIn`               | JSON `{ "Username": "<configured username>", "Password": "<configured password>" }`; the successful Axios probe also used HTTP Basic authentication with those credentials. |
| Search    | `GET /api//v3/customer/loadSummaries`     | Query parameters `offset=0`, `limit=10`, `sortBy=loadId:desc`, `searchQuery=<reference>`, `watched=false`.                                                                  |
| Detail    | `GET /api/v1//loads/{reference}`          | Envelope `status.code === 200`, `data.id` as a string, load status, pickup date, optional delivery date and stops.                                                          |
| Tracking  | `GET /api/v1//loads/{reference}/tracking` | Envelope `status.code === 200`, `data` array of events with numeric `id`, `typeName`, `notes`, `createdDate`, `modifiedDate`.                                               |

The login returned HTTP 200 and `status.code: 200`, plus `AuthToken` and
`RefreshToken` cookies. Both observed cookies had `Path=/`, `Secure`, `HttpOnly`,
and `SameSite=Strict`, with no explicit expiry attributes. Subsequent read requests
worked with the cookie header and no copied browser headers, CSRF token, browser
profile, or browser context. Responses can rotate `AuthToken`; process every
`Set-Cookie` response. Cookie values and credentials were kept in memory and were
not saved in the evidence files.

The successful Basic-plus-JSON login is a sufficient recipe; whether Basic is
strictly necessary was not tested. Token lifetime, refresh-token use, MFA,
CAPTCHA, forced logout and long-running expiry remain unverified. Do not infer an
expiry duration from the cookie names or add an undocumented refresh request.

Unauthenticated detail access returned HTTP 401 with `{ code: 401, messages:
["Unauthorized."] }`, a different error shape from the normal success envelope.
Check transport status before parsing a success schema.

## Live evidence and mapping

The three references all had load status `PickedUp`; none exercised delivery.

| Reference  | Detail `pickupDate`   | Detail `deliveryByDate` / browser estimate | Tracking panel status | Tracking event count |
| ---------- | --------------------- | ------------------------------------------ | --------------------- | -------------------- |
| `69451086` | `2026-10-08T16:23:00` | Absent / Unknown                           | Shipment enroute      | 22                   |
| `69372728` | `2026-10-06T15:25:00` | `2026-10-13T17:00:00` / Oct 13             | Shipment enroute      | 25                   |
| `69173190` | `2026-09-23T17:06:00` | Absent / Unknown                           | Shipment enroute      | 21                   |

For each tracking response, selecting the greatest `createdDate` matched both
the browser's displayed status (`typeName`) and detail (`notes`). The returned
arrays were not chronologically sorted. This is an observation across three
samples, not proof of the portal's general sorting or tie-breaking algorithm.
Decide equal timestamps, invalid timestamps, empty history and modified events
during grilling, and cover them with fixtures.

Key mapping findings:

- **Status:** detail/search `status: PickedUp` differs from the displayed tracking
  status `Shipment enroute`. To preserve the old adapter's behavior, prefer the
  selected event's `typeName` and `notes`; agree any fallback explicitly.
- **Pickup:** detail `pickupDate` matches the browser's actual pickup. Search
  `pickupStartDate`/`pickupEndDate` represent a pickup window and are not substitutes.
- **Estimate:** `deliveryByDate` matched the detail-page estimate in the populated
  sample. Search returned estimates even when the detail page displayed Unknown.
  Do not silently substitute the list estimate or parse an ETA out of event notes.
- **Calendar dates:** detail/event timestamps lack a timezone suffix; list dates
  contain `Z`. Prefer validated carrier calendar dates for PostgreSQL `date`, with
  an agreed rule rather than converting through the worker's local timezone.
- **Delivery:** the delivered field and multi-stop final-delivery rule are still
  unverified. A delivered sample is needed before finalizing those mappings.

The browser also fetched location history, item, quote, terminal and other page
data. The request proof needed only login, search, detail and tracking. Do not
replicate the page's ancillary calls or telemetry in the adapter.

## Safe absence and error classification

Search is broad across BOL, PO, PRO, reference, carrier and location fields.
An HTTP 200 search response is not proof that the requested load exists.

| Probe                                  | Observed response                                                   | Meaning for the adapter                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Each supplied reference                | HTTP 200, one result, exact numeric `id`                            | Compare the canonical reference to the result ID and subsequently the detail ID.                                   |
| Search `00000000`                      | HTTP 200, 37 matches, first page of 10 unrelated IDs                | Broad partial results cannot be interpreted as an exact match or confirmed absence.                                |
| Search `GRD-V1-014-NOT-FOUND-20261013` | HTTP 200, success envelope, `totalRecordCount: 0`, `results: []`    | Observed authenticated empty-search shape; the synthetic string is not a proposed valid shipment-reference format. |
| Detail `00000000`                      | HTTP 400, application code `400125`, missing/invalid LoadId message | Invalid input is not evidence that a valid shipment is absent.                                                     |
| Detail without cookies                 | HTTP 401                                                            | Authentication failure, never `not_found`.                                                                         |

Recommended conservative rule: return `not_found` only after a valid reference
has a validated, authenticated, complete search with no exact match. If search
pagination is needed, bound it; exhausting a cap is a technical failure, not
absence. An empty first page with a nonzero total, duplicate exact matches,
mismatched detail IDs, malformed JSON, unexpected HTML/redirects and login errors
must not increment the not-found counter. No valid-reference missing-detail 404
contract was established, so do not map all detail 404s to `not_found`.

Direct detail reads already succeeded without a preceding search in that read
loop, although the session had previously searched those references. Grilling
should choose search-first versus direct-detail-first with search as a fallback;
the proof does not establish all account/absence semantics for either strategy.

## Recommended implementation

Reuse the installed `axios@1.20.0` and `zod@4.6.6`, as approved in this conversation.
Use existing `axios-retry` and Bottleneck if the agreed retry/rate policy requires
them; configure an EchoShip-specific client and limiter rather than importing
UPS's provider-specific behavior. No production Playwright dependency is needed
for the demonstrated request path.

Cookie handling is the remaining library choice. Recommend evaluating
[`tough-cookie`](https://github.com/salesforce/tough-cookie) with
[`axios-cookiejar-support`](https://github.com/3846masa/axios-cookiejar-support)
before production implementation. They provide cookie parsing/storage and Axios
integration; this adds dependencies and the wrapper owns HTTP/HTTPS agents, which
must be considered if a custom proxy agent is introduced. Verify exact versions,
Node 24/Axios compatibility and maintenance at the implementation gate, and obtain
explicit approval before installing either package. The diagnostic probe's
fixed-origin two-cookie map is intentionally not a general cookie jar and must
not become the production implementation.

Alternatives: Playwright's browser-free `APIRequestContext` includes cookie
handling but introduces a Playwright runtime dependency; native `fetch` would
still need cookie/session handling and duplicates the existing Axios transport.
See the [Playwright API testing documentation](https://playwright.dev/docs/api-testing)
and [Axios request configuration](https://axios-http.com/docs/req_config).

Suggested files under `src/modules/carriers/adapters/echoship/`:

| File                                         | Responsibility                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `echoship.adapter.ts`, `echoship.module.ts`  | Implement/register the existing worker-only adapter and per-run session.                                     |
| `echoship.config.ts`, `echoship.session.ts`  | Validate enabled-carrier config locally; authenticate once, maintain isolated cookies, invalidate and close. |
| `echoship.client.ts`, `echoship.failure.ts`  | Fixed HTTPS origin, bounded transport, physical-request limiting, safe typed failures.                       |
| `echoship.schemas.ts`, `echoship.mapper.ts`  | Validate envelopes/identity, choose the event, map calendar dates and construct approved source data.        |
| Unit tests and tracking integration fixtures | Exercise mapping, authentication, absence, bounds and lifecycle without live carrier access.                 |

Proposed session flow: validate config → authenticate → sequential search/detail/
tracking reads → validate and map → close in `finally`. Honour both the run's and
each lookup's abort signals. Keep credentials and cookies out of logs, error
causes, fixtures, source data and database records. Restrict credential-bearing
requests to the configured approved HTTPS origin; reject cross-origin redirects.
Do not introduce persistent browser profiles, background keepalive timers or a
second polling scheduler.

Suggested bounds to settle during grilling: 15-second physical HTTP deadline,
1 MiB response cap per endpoint, explicit event/page caps, finite transient read
retries, and at most one fresh-login/read replay on an authentication rejection.
These are proposed defaults, not provider limits or already approved behavior.
Close/abort must fit the worker's existing 30-second shutdown grace period.

## Historical source-data decision gate

At exploration time, the policy allowed five DOM-text fields: `statusText`, `ediStatusText`,
`pickedUpText`, `deliveryHeading`, and `deliveryText`. JSON values are not DOM
text; do not claim that synthesizing those labels preserves the original source.

Recommend an explicit minimal JSON allowlist revision during grilling: matched
load ID, consumed pickup/estimate/delivery fields, and only the selected tracking
event's consumed ID/status/notes/date fields. If stop fields are needed for
delivery, approve their exact subset after a delivered example. Do not persist
the full event history, account data, addresses, prices, documents or raw
responses. The implementation interview subsequently approved the minimal API
allowlist, and API data is authoritative in both modes. See the current ticket and
source-data policy. No database schema change was required by this proposal.

## Local artifacts and reproduction

Evidence lives under **`artifacts/echoship/v1-014/`**, ignored by Git. Browser CLI
output is under ignored `.playwright-cli/`. These are local diagnostic artifacts,
not production retention or committed CI fixtures. Treat even redacted captures
as private because tracking notes and incidental portal data may be sensitive.

| Artifact                                                                     | Purpose                                                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `inspect.mts`, `cli.config.json`                                             | Local Playwright inspection recipe; references the already installed Playwright and Chromium paths on this machine.                 |
| `network-redacted.json`                                                      | Captured request paths, query/body metadata, header names, cookie names and redacted response data; no credential or cookie values. |
| `69451086-dom.json`, `69372728-dom.json`, `69173190-dom.json`                | Pickup/delivery text and tracking panel extracts for the supplied references.                                                       |
| `request-probe.mts`, `request-probe.json`                                    | Fresh browser-free Axios login/read recipe and projected results, event lists and DOM comparisons.                                  |
| `search-controls.json`, `page-diagnostic.json`, `manifest.json`, `README.md` | Search inspection, sanitized failure diagnostic, file hashes and local handling/reproduction notes.                                 |

Run from the repository root only when another live diagnostic pass is intended:

```sh
node artifacts/echoship/v1-014/inspect.mts
node artifacts/echoship/v1-014/request-probe.mts
```

Both read `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, `ECHOSHIP_PASSWORD` from `.env`.
The request probe is pinned to `https://echoship.com`, refuses redirects, caps
response size and clears its in-memory cookie map. It compares against the DOM
captures, so run inspection first for a fresh comparison. Scripts overwrite their
named local captures; preserve a dated copy if previous evidence is needed.
Neither script is a production adapter, ordinary CI test or general-purpose
automation client. They use existing local packages; no install step was run.

## Verification and limitations

- `node artifacts/echoship/v1-014/inspect.mts`: final pass succeeded for all three
  UI lookups and closed Chromium. Earlier passes exposed keyboard-triggered search
  and reading the tracking panel before its asynchronous response; the final
  recipe types the search and waits for panel content.
- `node artifacts/echoship/v1-014/request-probe.mts`: fresh login 200; all three
  searches, details and tracking reads 200; 22/25/21 events with matching IDs;
  all three latest-event status/detail comparisons passed. Empty/broad search,
  invalid-detail 400 and unauthenticated 401 shapes recorded.
- Credential/JWT scan of local captures found no configured username/password
  values or JWT-shaped tokens. This is a targeted check, not a claim that all
  business data has been removed. No auth state or cookie values were persisted.
- `node artifacts/echoship/v1-014/finalize-artifacts.mts`: passed; narrowed
  incidental captures, restricted directory/file permissions and indexed 12
  artifacts with SHA-256 hashes in `manifest.json`.
- `pnpm exec prettier --check docs/v1/tickets/V1-014-echoship-adapter.md docs/v1/tickets/V1-014-echoship-request-exploration.md`:
  passed. `git diff --check`: passed. `git check-ignore` verified captures,
  profiles, auth state and report paths; `git ls-files artifacts .playwright-cli`
  returned no tracked captures.
- Application unit/integration/e2e/typecheck/build checks were not run for this
  documentation-only application diff. No worker, database or frontend was
  started. Final diff review separated the four requested documentation/ignore
  changes from the untouched, pre-existing `sample.txt`.
- No expiry, invalid-password, throttling, transient-error, cancellation, delivered,
  multi-stop or sustained-load live test was performed. Ordinary CI must use
  synthetic/sanitized fixtures; these local captures are not automatically safe
  to commit.

## Grilling agenda

1. Preserve browser status/detail semantics and detail-page estimates, or adopt
   different business fields deliberately; choose empty-history fallback.
2. Establish delivered/multi-stop mapping and calendar-date/timestamp tie rules
   using a delivered example plus edge-case fixtures.
3. Choose search/identity/absence policy, pagination limits and accepted reference
   format; define failure versus partial-success handling.
4. Set session reauthentication, retry, timeout, size/event caps and request-rate
   behavior; approve the cookie-library choice before installation.
5. Approve the exact JSON source-data allowlist and reconcile
   `tracking-behavior.md`, `tracking-source-data-policy.md`, architecture/folder
   documentation and dependency decisions when implementing the final agreement.
