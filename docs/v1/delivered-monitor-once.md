# MON-V1-005: delivery completion and one-off checks

Approved in the shipment 69898669 investigation. This supersedes MON-V1-002.

## Behavior

- A current non-null delivered date completes monitoring immediately, independent
  of follow-up dates. New results complete in their transaction; existing active
  or paused deliveries reconcile on the next worker scan even with disabled carriers.
- Follow-up dates remain editable and continue to drive due-follow-up Attention.
  Editing a date never restarts a confirmed delivery. Delivery/history are preserved.
- Monitor again remains on desktop rows, mobile cards and details. Check once
  requests one manual refresh through the existing authenticated refresh endpoint.
  It does not edit follow-up dates or reopen scheduled monitoring. Pending repeat
  requests coalesce; disabled/deleted carriers and manual Other remain excluded.
- Confirmed/retained delivery stays Completed for found, unknown, missing, failed
  and not-found results. Counters and lookup outcomes remain observable; safeguard
  failures cannot replace known delivery with a paused status.
- A recognized carrier delivery reversal clears the current delivery date and
  resumes normal active monitoring. Missing/unknown statuses do not revoke delivery.
  The original snapshot remains immutable. Staff edits/deletion retain existing
  version checks and stale-result rejection.

## Implementation

Reuse TypeORM/PostgreSQL transactions, the existing NestJS scheduler, Zod request
validation and existing MUI/TanStack Query controls. The custom code is limited to
this approved business policy. No dependency, schema, FK or environment changes.
Scheduled eligibility never permits known delivery, including during queueing,
run start and pre-lookup checks. Manual eligibility explicitly permits completed
confirmed deliveries. Reconciliation is idempotent and preserves staff attribution.

## Verification

Use fixture carriers and disposable PostgreSQL. Cover future/today/past/null dates,
existing active/paused rows, disabled carriers, follow-up edits, manual coalescing,
retained snapshot history, failures/not-found at thresholds, delivery reversals,
concurrent staff edits/deletion and queued/session races. Browser checks cover
row/card/detail entry points, pending locks, progress, dismissal/focus, reduced
motion and Help guides/markers. See the implementation summary for final results.

## Rollout

Deployment is separate. Release API and worker together before the frontend.
Existing delivered active/paused records complete on the first worker scan;
there is no production backfill or migration in this change.
