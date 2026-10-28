# MON-V1-003: explicit carrier delivery reversals

## Summary

Recognized non-delivered statuses from FFE, UPS and EchoShip clear the current
delivery date before persistence decides whether to complete monitoring. This
fixes the reproduced FFE 9723395 sequence: Delivered, then Scheduled, then
Out for Delivery, with an obsolete delivery date retained across the reversal.

## Changes Made

- Added a carrier-owned exact-status policy using existing mapped labels.
- Apply that evidence before merging dates, including a contradictory delivery
  date in the current response or an initial observation. Unknown/missing statuses
  retain the existing date-preservation behavior.
- Continue existing TypeORM transactions, immutable snapshots, normal scheduling,
  follow-up reconciliation, optimistic version checks and change notifications.
- No new dependency, public API, schema, foreign key, deployment configuration or
  frontend change. Approved approach: existing Zod, TypeORM and platform built-ins
  with the specifically approved carrier business rules.

## Files Changed

- `src/modules/carriers/carrier-delivery-policy.ts`: carrier-specific recognized
  non-delivered statuses, normalized for casing and whitespace.
- `src/modules/carriers/carrier-delivery-policy.spec.ts`: normalization,
  inconclusive labels and cross-carrier boundaries.
- `src/modules/tracking/tracking.service.ts`: clear the current delivery date
  before snapshot comparison and completion decisions.
- `test/integration/delivery-reversal.spec.ts`: real mappers through the executor
  and disposable PostgreSQL, including expiry during lookup and later delivery.
- `docs/v1/tracking-behavior.md`: approved MON-V1-003 evidence and merge rules.
- `docs/v1/delivered-follow-up-monitoring.md`: reversal interaction with cutoff.
- This summary: implementation, verification and operational boundaries.

## Verification

- Before fix: `pnpm exec vitest run --project integration test/integration/delivery-reversal.spec.ts`
  reproduced 10 failures (non-delivered status retained delivery date and completed
  monitoring); 3 preservation cases passed.
- After fix: `pnpm exec vitest run --project integration test/integration/delivery-reversal.spec.ts test/integration/delivered-follow-up.spec.ts test/integration/tracking.spec.ts`
  passed 38 tests. After adding first-observation cases and production-observed
  labels, `pnpm exec vitest run --project integration test/integration/delivery-reversal.spec.ts`
  passed all 20 focused tests.
- `pnpm exec vitest run --project unit src/modules/carriers/carrier-delivery-policy.spec.ts`:
  7 passed.
- `pnpm typecheck`: passed.
- `pnpm check`: final unrestricted run passed formatting, lint, typecheck, all
  369 unit tests in 41 files, and production build. An earlier restricted-sandbox
  attempt hit `listen EPERM` in 3 notification tests; unrestricted reruns passed.
- `pnpm test:cov:all`: passed 707 tests in 92 files in 731.64 seconds, exit 0.
  Combined V8 coverage: 89.04% statements, 79.01% branches, 92.07% functions,
  90.57% lines. Existing pg concurrent-query deprecation warnings did not fail
  the suite. Compiled subprocess coverage limitations remain as documented in
  release readiness.
- `git diff --check`: passed. Initial worktree was clean; all changes are scoped
  to MON-V1-003. No custom replacement for library functionality was introduced.
- Live read-only audit: FFE 9723395 remains completed with snapshot 105 and
  delivery date 2026-10-27; fresh FFE lookup reports Out for Delivery. No UPS
  contradiction among stored deliveries. EchoShip 69582518 has Arrived at
  Delivery Location plus a delivery date, which is not sufficient reversal
  evidence and is deliberately outside this repair.
- `bash scripts/check-app-platform.sh https://api.globalresourcesdirect.com`:
  pre-release readiness, tracking-only configuration and auth boundary passed.
- The targeted 9723395 repair script passed syntax checking and a read-only
  production dry run. Guards: shipment 7, external ID
  `6efcca11-a778-42de-8c1f-3be6f15088c1`, snapshot 105, version 1493, completed /
  delivered, follow-up 2026-10-28, no pending attempts, active FFE, and a fresh
  recognized non-delivered FFE response. Planned transaction appends an immutable
  snapshot plus an explicitly recorded manual repair run/attempt, reactivates
  monitoring, and schedules immediately without changing the follow-up date.

## Review Notes

The policy uses exact known mapped labels, not substring matching or a generic
"anything except Delivered" rule. EchoShip's latest event/detail fallback
precedence and UPS's simplified status preference remain intact. Unrecognized
labels require separate evidence before expanding the policy. Historical
snapshots and failed/not-found observations are never rewritten.

## Remaining Issues

- Commit and deployment were approved after review. At preparation time, release
  and targeted production repair are pending. FFE 9723395 needs a guarded correction
  and reactivation because completed shipments no longer poll. Post-release
  verification is reported in the release handoff.
- This change cannot discover reversals after legitimate monitoring completion.
  Use the existing future-follow-up / Monitor again workflow when further
  observations are needed.
- Live UPS/EchoShip reversal scenarios have not been induced; their coverage is
  fixture-based. Container lifecycle and production rollout gates run in CI/CD.

## Suggested Review Order

1. Carrier policy and tracking-service merge.
2. Executor/PostgreSQL regression test and policy tests.
3. Tracking/follow-up specification and this summary.

One coherent commit: `fix(tracking): MON-V1-003 handle explicit carrier delivery reversals`.
