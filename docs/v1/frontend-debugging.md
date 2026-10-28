# OBS-V1-001: frontend and backend debugging

Approved scope: authenticated frontend JavaScript/React errors, unhandled promise
rejections and failed API calls; separate frontend and backend OpenSearch dashboards.
No usage analytics, login-page telemetry, browser performance collection or resource
metrics. DigitalOcean Insights owns resource monitoring. Browser process crashes,
offline delivery and errors before application initialization cannot be guaranteed.

## Contract and controls

`POST /api/v1/telemetry/frontend` accepts an active session (including password-change
restricted sessions), trusted Origin and strict JSON. Success is 204, invalid data
400, missing/revoked session 401, forbidden origin 403, account limit 429.

Fields: `kind` (browser/react/unhandled-rejection/api), `page` (normalized path),
`release` (40-character Git SHA or development), `errorName` (fixed enum), `frames`
(up to eight `assets/<bundle>.js:<line>:<column>` entries). API errors optionally
include `method`, normalized `route`, `status` (0 means no HTTP response) and
`failedRequestId` (UUID returned by the failed API response). Server request IDs
remain server generated; the failed request ID is client-reported diagnostic data,
not authorization or proof of causality. The API exposes X-Request-Id through CORS.

No raw messages, stacks, form data, headers, bodies, query strings, fragments,
user identifiers or external source URLs are collected. The browser keeps known
route segments and replaces other segments with `:id`. Error names and source
locations replace unrestricted exception messages, trading detail for privacy.
Failures of the reporting transport never enter the normal API error handler.
There is no persistent queue or retry. Client limit: 10 distinct events/minute/tab;
server: 20 requests/minute/account via installed Nest throttler. Session validity
is checked again server-side. Existing JSON body limits also apply.

## OpenSearch

Configuration files are `.do/opensearch-debug-pipeline.json`,
`.do/opensearch-debug-mapping.json`, `.do/opensearch-index-templates.json` and
`.do/opensearch-debug-dashboards.ndjson`. Pipeline `grd-debug-v1` parses forwarded
`log` JSON into `grd`; plain text continues to index. Only known fields are mapped,
and `grd` has dynamic mapping disabled. Existing raw `log` is retained.

Apply pipeline first, add the mapping to existing GRD component indexes, merge
`index.default_pipeline=grd-debug-v1` into their settings and templates, then import
the saved objects in the Global tenant of Dashboards Management (API imports
must send `securitytenant: global`). Inspect conflicts before overwriting
saved objects. These additive changes do not change retention or reindex old logs.
Fresh logs alone have structured fields; historical logs remain searchable in `log`.

Saved dashboards: `grd-frontend-debugging` and `grd-backend-debugging`.
Frontend: trend, error type, page, release, failed API route and recent events.
Backend: warning/error trend, severity, failed API status, worker warnings/failures,
carrier warnings/failures, recent events and API P95 latency (excluding long-lived `/api/v1/events` streams).

Use Discover with the `grd-*` data view and a query such as
`grd.requestId : "<failedRequestId>"` to follow a failed browser API call.
Use `grd.release`, `grd.page`, `grd.event` and `grd.carrierCode` filters to narrow it.
Expected empty frontend panels before application deployment are not an ingestion
failure. The existing roughly 7–8 day retention remains unchanged.

Rollback: remove `index.default_pipeline` from affected indexes/templates first;
then remove only the OBS-V1-001 saved objects/pipeline if desired. Added mappings
can remain. Do not delete indexes or reset aliases to roll back this feature.

## Private source maps and release handoff

The frontend build writes hidden maps outside `dist`, at
`.private-source-maps/<release>/assets/`; Git and Docker build contexts exclude
that directory. Production App Platform builds supply BUILD_COMMIT. Standalone
builds use Git HEAD or `development` if Git metadata is unavailable. Uncommitted
builds are test artifacts, not authoritative release maps.

Retain the maps from the **exact production build**, privately, for at least the
log retention window. Do not use maps from a different build even with the same
commit: build-time configuration can change bundle hashes. In the existing
App Platform build image they are at `/app/.private-source-maps/<release>`; only
`/app/dist` is published. The separate deployment task must export/archive that
folder before discarding its build image. No CI/CD or deployment was changed here.
Local build maps are retained on disk, but are not a durable production archive.

From the frontend checkout:

```sh
pnpm debug:frame /private/archive/<release> assets/<bundle>.js:<line>:<column>
```

The resolver uses Node's built-in SourceMap and prints the original file/line.
OpenSearch displays bundle frames; it does not automatically resolve source maps.
Never upload source maps or source contents into the public static directory.

Tenant selection follows the [OpenSearch saved-object API contract](https://docs.opensearch.org/latest/dashboards/management/saved-objects-api/).
