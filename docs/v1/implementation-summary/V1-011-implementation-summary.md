# V1-011 implementation summary

## Summary

Implemented tracking-run, attempt, immutable-snapshot, and Shipment-outcome
persistence through a feature-owned application service and transactional
TypeORM persistence port.
The implementation preserves the useful original-app behavior—known-value merge,
change-only snapshots, successful URL population, delivery completion, and stale
write protection—while applying the v1 PostgreSQL run model and five-result
not-found threshold. No migration or dependency change was required.

## Changes Made

- Added strict Zod command validation (including standalone run IDs), a
  manager-bound tracking transaction contract, TypeORM implementation,
  application service, and Nest module. The service owns workflow and
  transaction intent while TypeORM owns SQL and locking. Runs atomically create
  one pending attempt per unique target and expose execution contexts only after
  a queued-to-running transition.
- Added atomic `found`, `not_found`, `failed`, and `skipped` finalization. Found
  results merge missing fields with known state, create an immutable snapshot
  only when the complete state changes, reuse the existing snapshot otherwise,
  populate a null verification URL after success, and complete delivery.
- Added the configurable not-found threshold, normal failure scheduling, manual
  schedule preservation, threshold-pause reactivation, and database-clock-based
  effective-interval scheduling. Every Shipment mutation increments and checks
  `lock_version`; stale/deleted work becomes `skipped / SHIPMENT_STATE_CHANGED`.
- Added strict run finalization, partial-success derivation, interruption recovery,
  and queued/running cancellation. Pending attempts cannot survive a terminal run;
  skips remain neutral and cancellation preserves already finalized work.
- Persist optional adapter-sanitized allowlisted `source_data` unchanged for
  `found`, `not_found`, and `failed`; require null for `skipped`. Raw artifacts,
  new source-version columns, retention, and access APIs remain outside scope.

## Files Changed

| File                                                  | Review purpose                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/modules/tracking/tracking.schemas.ts`            | Validated run and outcome commands, calendar dates, and JSON-object source data.                     |
| `src/modules/tracking/tracking.repository.ts`         | Feature-owned transaction/persistence contract, result records, and state errors.                    |
| `src/modules/tracking/typeorm-tracking.repository.ts` | Manager-bound PostgreSQL queries, locks, and atomic persistence primitives.                          |
| `src/modules/tracking/tracking.service.ts`            | Validated use-case orchestration, transaction intent, outcome policy, scheduling, and run lifecycle. |
| `src/modules/tracking/tracking.module.ts`             | Nest provider composition and exports for later worker/API tickets.                                  |
| `src/modules/tracking/tracking.service.spec.ts`       | Unit coverage for command validation and unchanged sanitized-source handoff.                         |
| `test/integration/tracking.spec.ts`                   | Real-PostgreSQL outcome, rollback, ownership, concurrency, source-data, and run-summary coverage.    |
| `docs/v1/tickets/V1-011-tracking-persistence.md`      | Implementation state and approved decisions.                                                         |
| `docs/v1/tracking-source-data-policy.md`              | Approved population outcomes and remaining deferrals.                                                |
| `docs/v1/database-schema.md`                          | Reconciled source-data deferral text.                                                                |

## Verification

| Exact command/check                                                                 | Result                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit src/modules/tracking/tracking.service.spec.ts` | Passed: 4 tests.                                                                                                                                      |
| `pnpm exec vitest run --project integration test/integration/tracking.spec.ts`      | Passed: 12 tests against disposable PostgreSQL 18.3.                                                                                                  |
| `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`       | Passed: formatting, zero-warning lint, typecheck, 14 unit files / 112 tests, and production build.                                                    |
| `pnpm test:integration`                                                             | Passed: 63 tests in 6 files, including tracking and migration regression, after temporarily disabling the pre-existing local Console Ninja injection. |
| `pnpm test:e2e`                                                                     | Passed: 35 tests in 4 files after the same temporary local-instrumentation isolation.                                                                 |
| Parallel Standards and Spec reviews                                                 | Passed after the transaction-store refactor: no remaining findings and no behavioral regressions.                                                     |
| `git diff --check`                                                                  | Passed in the final review.                                                                                                                           |

The first full integration run had 59 passing tests and four existing runtime-log
failures because the locally injected Console Ninja hook printed colored text into
JSON-only child-process output. The hook was temporarily removed for clean full
runs and restored afterward; `node_modules/@nestjs/core/index.js` returned to its
original SHA-256
`81239b7f838540635b3fea7d179fe7d454dc82248974b167f672e9f6f141b23a`.
The inherited `pg` concurrent-query deprecation warning still appears during
schema introspection. No production dependency file was changed.

## Review Notes

- `succeeded` means no attempt failed; intentional skips are neutral. Mixed failed
  and non-failed outcomes produce `partially_succeeded`; all failed produces
  `failed`. An all-skipped run therefore succeeds as safely processed work.
- Attempts are durable from run creation. `started_at` is the logical-attempt
  creation time; later tickets own physical Carrier-request timing and retries.
- Persistence validates JSON-object shape but cannot know Carrier-specific fields.
  Adapter tickets must prove their allowlists and sanitization before calling it.
- The scheduler ticket owns effective-interval calculation and due selection.
  This ticket accepts the validated positive interval and applies it atomically
  from one database completion timestamp.
- `sample.txt` was an unrelated pre-existing untracked file and was not changed.

## Remaining Issues

- Remote CI has not run.
- Carrier adapter allowlist tests arrive with V1-013 through V1-015; V1-011 can
  validate JSON shape but cannot independently identify provider-specific secrets.
- The pre-existing PostgreSQL TLS deferral, `pg` introspection warning, and local
  Console Ninja runtime-log interference remain outside this ticket.

## Suggested Review Order

1. `tracking.schemas.ts`, `tracking.repository.ts`, and `tracking.service.ts`.
2. `typeorm-tracking.repository.ts` SQL primitives and optimistic concurrency.
3. Tracking unit/integration tests, module wiring, and documentation updates.

## Proposed Commits

1. `feat(tracking): V1-011 add transactional tracking persistence`
   - Files: tracking module, contract, schemas, service, TypeORM repository, and tests.
   - Purpose: implement the complete run/attempt/snapshot/Shipment persistence behavior.
2. `feat(docs): V1-011 record tracking persistence decisions`
   - Files: ticket, source-data policy, database schema note, and this summary.
   - Purpose: preserve approved behavior, verification evidence, and remaining deferrals.

No files were staged or committed. Explicit final approval is required before
creating either commit.
