# OBS-V1-002 implementation handoff

## Summary

Implemented and activated event-day OpenSearch routing to stop repeated deliveries
from creating copies across rollover indexes. Inspected all nine historical
frontend reports without changing frontend behavior.

## Changes Made

- Preserve forwarded document IDs and route known components to UTC event-day
  indexes using OpenSearch's built-in date processor and `date_index_name`.
- Drop arrivals before the oldest retained UTC day, keeping today plus the previous
  seven days eligible. Delete date indexes eight days after creation to retain
  approximately seven to eight days of current events. The policy ID
  `grd-event-days-seven-days` names the approximate event retention, not index age.
- Keep component write aliases, legacy retention, application deployments and
  existing records intact. Historical duplicates are not cleaned up by this change.
- Provide default simulation and an opt-in fixture test. Use Node built-ins and
  existing doctl authentication; add no dependencies.
- Record frontend request correlation, deletion reconciliation and the limits
  imposed by intentionally omitted validation payloads.

## Files Changed

- `.do/opensearch-debug-pipeline.json`: replay-safe routing and UTC expiry guard.
- `.do/opensearch-date-index-templates.json`: date-index mappings, zero replicas,
  shared parsing pipeline and non-write component aliases.
- `.do/opensearch-date-retention.json`: event-day ISM policy, separate from legacy
  source-index rollover.
- `scripts/check-opensearch-routing.ts`: live simulation, retry indexing checks
  and isolated fixture cleanup.
- `docs/v1/log-replay-remediation.md`: incident evidence, operational apply/rollback,
  retention limitations and nine-report frontend investigation.
- `docs/v1/app-platform.md`: point operators to the current routing configuration.
- `docs/v1/frontend-debugging.md`: align debugging setup with the current pipeline.
- This summary: review, verification and commit handoff.

Pre-existing work is excluded: `package.json`, `pnpm-lock.yaml`, `docs/quickbooks/`
and `test/support/quickbooks/`. The frontend also has an unrelated existing edit in
`e2e-backend/tracking-review.spec.ts`; no frontend files were modified by this task.

## Verification

- `node scripts/check-opensearch-routing.ts 014bb398-40c2-476a-8317-9ed1b848ef4d --fixtures`:
  passed simulation for all three components, stable replay identity, exact UTC
  expiry boundary, offset timestamps, malformed timestamps and plain/scalar/JSON
  logs. Real default-pipeline indexing stored one document at version two for each
  component after replay through two source indexes. Fixture cleanup passed.
- `pnpm exec tsc --ignoreConfig --noEmit --module nodenext --moduleResolution nodenext --target ES2023 --types node --strict --skipLibCheck scripts/check-opensearch-routing.ts`:
  passed.
- `pnpm exec oxlint --deny-warnings scripts/check-opensearch-routing.ts`: passed.
- `pnpm exec prettier --check` over all eight requested files: passed.
- `git diff --check`: passed. Reviewed tracked diff and all new task files;
  separated unrelated pre-existing work.
- `pnpm --dir /home/jeff/apps/grd-dashboard/grd-dashboard-fe exec vitest run src/features/shipments/create-schema.test.ts src/features/shipments/detail-model.test.ts src/lib/frontend-telemetry.test.ts`:
  32 tests passed in three files.
- `pnpm --dir /home/jeff/apps/grd-dashboard/grd-dashboard-fe exec vitest run src/features/tracking-updates/review.test.ts src/features/tracking-updates/live-updates.test.ts`:
  30 tests passed in two files, including deliberate 404 review-state cleanup.
- Live pipeline/templates/policy acknowledged and configuration read back. Initial
  activation: 2026-11-12 05:43:43 UTC. Final eight-day index retention definition
  persisted afterward; managed indexes refresh cached policy asynchronously. The
  API date index initially cached seven days; a policy-version refresh without a
  state override was accepted (`updated_indices: 1`, no failures).
- Fresh API request `b59e30a8-f342-417b-b24d-a51b55b11eb1` returned 200 and appeared
  exactly once in `grd-day-api-2026-11-12` across the GRD search pattern. OpenSearch
  stayed green; existing write aliases remained unchanged. ISM attached to the new
  date indexes and was enabled. A natural worker `tracking.run.completed` event at
  05:49:12 UTC arrived in `grd-day-worker-2026-11-12` with the final retention policy.
- No application build, whole-backend coverage, container suite or browser UI
  suite was run: no application runtime/image or frontend code changed. Synthetic
  tests cover all three components; natural migration forwarding and actual timed
  expiry need continued observation.

## Review Notes

Retention drops expired arrivals; it is not an exact deletion deadline for every
record. Transitional historical replays can remain longer, and old/new copies can
coexist until legacy retention expires. Daily targets do not use the previous
256 MiB rollover limit. Monitor disk and daily volume. Deduplication relies on the
stable document IDs observed in the managed forwarder.

The tiny retention predicate uses built-in Java time parsing through OpenSearch
Painless conditions, within the user-approved platform-built-in approach. No
custom replacement logging client, npm dependency, credential capture, index
deletion or application deployment was introduced.

Help assessment: no Help update is needed because this changes operator log
storage only; user workflows, permissions, statuses and visible behavior are
unchanged. Operator documentation was updated instead.

## Remaining Issues

- Historical duplicates remain until retention removes legacy indexes.
- Actual eight-day expiry and future cross-rollover forwarding require time to
  observe; these are configured and fixture-tested, not elapsed-time verified.
- The API index's final cached eight-day policy adoption is asynchronous; its
  version refresh was accepted. Worker date-index creation used the final version.
- The six create-400 rejected fields cannot be recovered from existing logs. Two
  404s fit deletion reconciliation; the third exact trigger remains unverified.
  No uncaught browser exception was established by these nine reports.
- Migration natural production arrivals are not yet observed after activation;
  migration routing passed the same real indexing fixtures as API and worker.
- No commit or push was performed.

## Suggested Review Order

1. `docs/v1/log-replay-remediation.md` for scope, evidence and retention tradeoffs.
2. Pipeline, date templates and date retention policy together.
3. `scripts/check-opensearch-routing.ts` and verification evidence.
4. Documentation updates and this handoff.

One coherent proposed commit contains the eight task files listed above:

```text
fix(logging): OBS-V1-002 deduplicate replayed logs by event day
```

Behavioral summary: stable event-day routing, expiry guard, retention configuration,
live regression checker and operational/debugging documentation. Stage only these
files after explicit final commit approval; exclude all pre-existing work.
