# MON-V1-002: delivered shipments with follow-up monitoring

Approved on 2026-10-28. This supersedes terminal-delivery behavior in the original
tracking specification and MON-V1-001. The existing provider safeguards, pacing,
manual pauses, immutable snapshots and single-worker architecture still apply.

## Rules

- A known delivery is identified by the current snapshot's non-null `deliveredOn`,
  matching the existing tracking contract. Delivery and monitoring are separate:
  a delivered Shipment remains active while `followUpOn` is strictly after today
  in `America/New_York`.
- MON-V1-003 clears that current delivery date when a successful lookup explicitly
  reverses delivery using a recognized carrier status. The shipment then follows
  undelivered monitoring rules, including after the follow-up cutoff. Missing or
  unknown statuses alone preserve known delivery. See [tracking behavior](tracking-behavior.md#normalized-tracking-state).
- Repeated delivered results keep monitoring active until the date arrives. Carrier
  status and delivery history remain visible; no snapshot is rewritten to resume.
- At the start of the follow-up date, stop new lookups. Today, overdue and null
  follow-up dates complete monitoring for delivered Shipments. Clearing a date
  completes monitoring immediately. Undelivered Shipments keep their normal rules.
- Staff/Admin use **Monitor again** from desktop row actions, mobile cards or
  details. The dialog defaults to tomorrow, accepts only a future date, and saves
  through the existing `PATCH /shipments/:externalId` with `{ followUpOn }`.
  The same date edit through assignment controls also reactivates completed rows.
- A future date edit does not override an explicit or safeguard pause. Resume and
  Retry retain their existing meanings; a delivered Shipment needs a future date
  before either can allow another lookup. Carrier disablement prevents requests.
- Existing completed Shipments with future follow-ups reactivate on the first
  worker scan after rollout. Deleted records and future-dated paused records are
  excluded. This is idempotent reconciliation, not a historical database migration.

## Presentation

Actively monitored delivered Shipments appear in Active unless existing Attention
rules apply. Once completed they appear in Delivered; a due follow-up also puts
that Shipment in Attention. Carrier status remains independent of monitoring state.
Upcoming deliveries and `undeliveredOnly=true` exclude known deliveries even when
monitoring is active. Counts, search results and detail controls use these rules.

## Persistence and timing

Reuse TypeORM transactions, Zod validation, PostgreSQL date/time functions, NestJS
Schedule, and the installed frontend form/UI/query/date libraries. The custom
code is limited to this approved business policy. No dependency, schema, foreign
key or environment changes are required.

The worker reconciles at the start of each existing scan, including disabled
Carriers. Stored state/tab placement catches up on the next scan (or after an
ongoing scan finishes). PostgreSQL-clock eligibility is checked independently at
scheduled selection, run creation/start, and immediately before each logical
lookup or batch, so a delayed scan cannot authorize a post-cutoff lookup. An
already-started lookup can finish; finalization reconciles the expiry atomically.
Session setup and provider-internal retries remain governed by existing adapters.

Staff edits and lifecycle transitions use existing row locks and version increments.
Late outcomes cannot undo a concurrent follow-up edit, pause or deletion.
Reconciliation preserves snapshots, assignment edit attribution and failure
counters. Generic database change events refresh the UI; keeping a delivered row
active does not emit a false stopped-delivery notice.

## Acceptance evidence

Verify with fixture providers and disposable PostgreSQL: future/today/past/null
dates; repeat delivery; automatic existing-record restart; manual pause and
carrier disablement; expiry during queued/session/in-flight work; concurrent
staff edits; New York midnight around both DST changes; tab/Attention/Upcoming
behavior; desktop/mobile restart and detail controls. See the implementation
summary for exact commands and results. Deployment is a separate task.
