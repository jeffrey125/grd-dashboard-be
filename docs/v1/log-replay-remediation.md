# OBS-V1-002: replay-safe OpenSearch routing

## Scope and diagnosis

On 2026-11-12, the retained GRD log snapshot contained 89,531 documents but
28,617 distinct `log` values. Identical events had identical document IDs across
successive rollover indexes. The live App Platform specification had one log
destination and one replica per API/worker component. This establishes repeated
delivery across indexes, rather than additional application executions. The
forwarder's internal replay trigger remains unverified.

An ID is unique within an index. Reusing that ID after the write alias rolls over
therefore creates another document. Changing IDs or adding an npm logging package
would not fix that boundary.

The user approved OpenSearch's built-in `date_index_name` approach on 2026-11-12.
No application dependency, database schema, application deployment or restart is
required. The small UTC retention predicate uses OpenSearch's built-in Painless
condition support and Java time parsing.

## Configuration

- `.do/opensearch-debug-pipeline.json`: existing `grd-debug-v1` JSON parsing plus
  validated event timestamps, UTC-day routing, and expired-replay rejection.
- `.do/opensearch-date-index-templates.json`: three `grd-day-<component>-*`
  templates, one primary/zero replicas, existing diagnostic mappings, explicit
  `@timestamp` mapping, and the existing component alias as a **non-write** alias.
- `.do/opensearch-date-retention.json`: policy `grd-event-days-seven-days`, deleting
  daily indexes eight days after creation (approximately seven to eight days per event). Its patterns do not match legacy indexes.
- `scripts/check-opensearch-routing.ts`: live simulation and isolated synthetic
  indexing verification using Node built-ins and the existing `doctl` login.

Forwarding destinations and their write aliases remain unchanged. Legacy source
indexes still roll over and expire using their existing policy. Their default
pipeline sends newly arriving documents to `grd-day-api-YYYY-MM-DD`,
`grd-day-worker-YYYY-MM-DD` or `grd-day-migrate-YYYY-MM-DD`, using the forwarded
`@timestamp` and preserving the supplied `_id`. Retries now update the same
event-day document, even when the source write alias has rolled over.

Plain/scalar output still indexes without a parsed `grd` object. Missing or
malformed timestamps are not routed; downstream mappings can still reject invalid
timestamp values. Temporary parsing fields are removed before indexing. No raw
payloads, credentials or user data are added.

## Retention and transition

Ingestion accepts today and the preceding seven **UTC calendar days**. Older arrivals
are dropped, preventing a replay from recreating an index after retention deletes
it. This is a calendar-day boundary, not a rolling 192-hour ingest window.

Index deletion runs asynchronously through ISM eight days after index creation.
Newly created indexes can initially receive recent historical replays, so during
cutover those events can remain longer than seven days from their event timestamp
(up to approximately sixteen days plus ISM delay). In steady state, each day's
index is created near its first arrival and retained for approximately seven to eight days per event.
Never describe this as an exact per-document deletion deadline.

Existing duplicate documents were **not deleted or reindexed**. Old/new indexes
may temporarily contain the same historical event until legacy retention catches
up. Assess fresh events after activation or group by document identity when
checking improvement; the historical 68% ratio is not expected to vanish instantly.
Daily destination indexes no longer have the legacy 256 MiB rollover threshold;
monitor disk and daily volume. This preserves stable routing for each document ID.

## Apply and verify

Use the cluster connection credentials only in process memory with normal HTTPS
certificate/hostname verification. Do not save connection JSON or app specifications.

1. Inspect and back up the current pipeline, target templates and policy definitions
   privately. Compare existing names before creating or overwriting configuration.
2. Apply `.do/opensearch-date-retention.json` to
   `PUT /_plugins/_ism/policies/grd-event-days-seven-days`.
3. Apply each named entry from `.do/opensearch-date-index-templates.json` to
   `PUT /_index_template/<name>`.
4. Apply `.do/opensearch-debug-pipeline.json` to
   `PUT /_ingest/pipeline/grd-debug-v1` **last**. Do not change forwarding aliases.
5. Inspect fresh documents in `grd-day-*`, their non-write component aliases,
   cluster health and `GET /_plugins/_ism/explain/grd-day-*`. Policy attachment and
   deletion are asynchronous; verify actual attachment rather than only policy existence.

Simulation changes no cluster configuration or documents:

```sh
node scripts/check-opensearch-routing.ts CLUSTER_ID
```

An opt-in real indexing test creates a unique `routing-check-<UUID>` pipeline and
isolated indexes, verifies one stored document/version two after replay through
two sources for all three components, then deletes only those fixtures:

```sh
node scripts/check-opensearch-routing.ts CLUSTER_ID --fixtures
```

Rollback: restore the captured previous `grd-debug-v1` definition. New deliveries
then return to the original source indexes; existing event-day data stays readable
and expires under its own policy. Leave templates and policies in place until
their data has expired. Rollback restores the previous duplication risk. No alias
reset, index deletion, app restart or deployment is needed.

## Frontend report investigation

All nine unique frontend reports on release
`03d4098c984a019e01f2f0664205b87e99e03446` correlate through `failedRequestId` to
real backend request records. Times below are UTC.

| Reports                                   | Evidence                                                                      | Conclusion                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Two create 400s, Nov 3 21:01:10–23        | A create returned 201 at 21:01:33.                                            | Requests were rejected; the subsequent request succeeded. Logs do not identify the rejected fields or prove these were the same input/user. |
| Four create 400s, Nov 5 20:53:58–20:54:33 | Create returned existing/200 at 20:54:40, then 201 at 20:55:30.               | Same diagnostic limit; no evidence of a persistent create outage.                                                                           |
| Two detail 404s, Nov 10 14:19:20          | Successful DELETE at 14:19:19.756, followed by GETs at 14:19:20.332 and .692. | Consistent with deletion reconciliation. Routes omit record IDs, so identity cannot be proven retrospectively.                              |
| One detail 404, Nov 10 16:02:28           | Shipment search succeeds immediately around the GET.                          | Missing record is handled; its precise trigger remains unverified.                                                                          |

`src/app/tracking-review.tsx` in the frontend reads current shipment state during
review reconciliation. `review-controller.ts` deliberately removes saved review
state on a 404. `query-refresh.ts` clears stale detail data on a 404, and the detail
page shows “Shipment unavailable”. The API client emits telemetry **before**
mapping handled form errors, so these reports do not establish uncaught exceptions.

The frontend create schema validates a follow-up date's format but does not reject
past dates; the backend also rejects past follow-up dates and unavailable carriers
or sales reps. These are possible rejection paths, not proven explanations for
the six historical requests. Field values/messages were intentionally excluded
from telemetry. Do not claim historical root causes from missing data.

No frontend behavior or telemetry payload was changed. A separate improvement
could capture allowlisted validation field/reason codes and distinguish handled
missing-record responses while retaining unexpected 404 reports. That requires
its own agreed implementation scope and Help assessment.

References: [date-based routing](https://docs.opensearch.org/latest/ingest-pipelines/processors/date-index-name/),
[simulation](https://docs.opensearch.org/latest/ingest-pipelines/simulate-ingest/),
[ISM conditions](https://docs.opensearch.org/latest/im-plugin/ism/policies/).
