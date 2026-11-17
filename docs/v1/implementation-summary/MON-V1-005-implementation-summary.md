# MON-V1-005: delivery completion and one-off checks

## Summary

Confirmed delivery completes monitoring and moves a shipment to Delivered regardless
of follow-up dates. Monitor again remains available for one carrier check.
Implementation is in an isolated worktree checked out on main at `e8ce7df`.

## Changes Made

- Complete successful deliveries atomically; reconcile existing delivered active
  or paused rows on the next worker scan even when carriers are disabled.
- Remove automatic reactivation from future follow-up dates. Preserve those dates,
  due-follow-up Attention and immutable tracking history.
- Permit completed known deliveries in manual refresh eligibility only. Reuse
  pending-run coalescing and existing carrier, deletion, version and preflight checks.
- Retain delivery through failures/not-found, including safeguards at threshold.
  Recognized carrier reversals clear delivery and resume normal monitoring.
- Reuse the approved TypeORM/PostgreSQL transactions, Zod and NestJS scheduler.
  No new dependency, schema, foreign key, environment or deployment changes.

## Files Changed

| File                                                       | Purpose                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/modules/shipments/typeorm-delivered-monitoring.ts`    | Complete known deliveries and block further scheduled work independent of dates.                                 |
| `src/modules/tracking/tracking.repository.ts`              | Share manual versus scheduled eligibility; remove obsolete future-follow-up flag.                                |
| `src/modules/tracking/tracking.service.ts`                 | Complete delivery, allow one-off checks, preserve delivery at not-found threshold, and handle explicit reversal. |
| `src/modules/tracking/typeorm-tracking-http.repository.ts` | Queue completed-delivery checks using the shared eligibility policy.                                             |
| `src/modules/tracking/typeorm-tracking.repository.ts`      | Stop reading the unused follow-up completion flag.                                                               |
| `src/modules/tracking/tracking.service.spec.ts`            | Align the transaction fixture with its updated contract.                                                         |
| `test/integration/delivered-follow-up.spec.ts`             | Replace superseded date-window tests with 14 completion, one-off, race and coalescing regressions.               |
| `test/integration/delivery-reversal.spec.ts`               | Exercise corrections through explicit manual checks after completion.                                            |
| `docs/v1/delivered-monitor-once.md`                        | Record approved MON-V1-005 requirements and rollout order.                                                       |
| `docs/v1/delivered-follow-up-monitoring.md`                | Mark the old policy superseded, preserving historical context.                                                   |
| `docs/v1/tracking-behavior.md`                             | Align completion and manual-check rules.                                                                         |
| `docs/v1/frontend-handoff.md`                              | Document the unchanged refresh endpoint and new eligibility/controls.                                            |
| `docs/v1/README.md`                                        | Point to the current monitoring specification.                                                                   |
| This summary                                               | Review and verification evidence.                                                                                |

## Verification

- Red regression before implementation: `pnpm exec vitest run --project integration test/integration/delivered-follow-up.spec.ts -t 'completes confirmed delivery'`:
  future-date case failed with Active instead of Completed; other three dates passed.
- `pnpm check`: passed format, zero-warning lint, typecheck, 384 unit tests in
  43 files, and production build in the main worktree. Restricted notification
  HTTP tests initially hit `listen EPERM`; rerunning with localhost access passed.
- `pnpm exec vitest run --project integration test/integration/delivered-follow-up.spec.ts test/integration/delivery-reversal.spec.ts test/integration/tracking.spec.ts test/integration/monitoring-safeguards.spec.ts --project e2e test/e2e/refresh.spec.ts`:
  59 tests passed in five files against disposable PostgreSQL.
- After strengthening the late-result assertion, `pnpm exec vitest run --project integration test/integration/delivered-follow-up.spec.ts`: all 14 passed.
- Frontend real-API checks verify desktop/mobile one-off queueing, coalescing,
  Delivered retention and follow-up edits. See the sibling frontend summary.
- `git diff --check`: passed. No secrets, production credentials or live carrier
  calls used. Original backend feature worktree restored clean; unrelated frontend
  work left intact. Dependencies installed with the unchanged main lockfile.
- Full combined coverage, the full integration/e2e matrix, container/CI/deployment
  checks and production rollout were not run. No packaging changes were made.
- Help updated in the sibling frontend with a new fictional illustration and three
  markers; desktop/mobile role visibility, image loading and markers verified.
- Manual review API: `http://localhost:3019/api/v1/health/ready` returned HTTP 200
  with application/database up. Frontend `http://localhost:5178` and its health
  proxy returned HTTP 200. These run disposable test data with tracking worker off.

## Review Notes

The API and worker must release together before the frontend. Existing delivered
active/paused records complete on the first worker scan; no migration/backfill.
The manual run itself does not activate monitoring. Only an explicit recognized
carrier correction revokes delivery and resumes normal checks. In-flight staff
edits/deletions still invalidate outcomes. Carrier disablement and Other behavior
remain enforced. Ordinary manual refreshes of active/threshold-paused records
continue using the existing rules.

## Remaining Issues

Not committed or deployed. Production behavior remains unchanged. The local preview
has no carrier worker, so manual requests stay queued; execution is verified with
fixture adapters in PostgreSQL integration tests. No live carrier verification.

## Suggested Review Order

1. Delivery reconciliation and shared manual/scheduled eligibility.
2. Tracking finalization and HTTP queueing.
3. Database regressions, current specification and frontend contract.

One backend commit containing the files above:
`fix(tracking): MON-V1-005 complete deliveries and allow one-off checks`.
Explicit final approval is required before staging or committing.
