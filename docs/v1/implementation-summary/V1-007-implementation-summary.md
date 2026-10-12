# V1-007 implementation summary

## Summary

Implemented the approved Carrier read/update API and production repository seam.
The revised ticket is complete: formatting, lint, typecheck,
unit, real PostgreSQL integration, HTTP e2e, and build checks pass. Independent
standards and specification reviews found no actionable issues. Following explicit
final approval, implementation commit `b983f53` and documentation commit `b039d1f`
were created. The repository-contract restoration requested afterward is complete
and received separate final commit approval; this summary accompanies that
restoration commit. No production database was accessed.

## Changes Made

### Settled scope and dependency approach

- Restoration: the assistant misinterpreted a clarification as a request to
  remove `carriers.repository.ts`. The user subsequently asked for it back. The
  original interface, public record type, Symbol, and provider wiring are restored;
  the temporary direct-injection exception is removed from the documentation.
- Only reviewed migrations accompanying an implemented adapter may add Carriers.
  Existing migration seed codes remain intact. Automatic slug generation,
  `slugify` installation, and runtime creation are deferred by explicit approval.
- No Carrier create, soft-delete, hard-delete, or restore endpoints. Admins can
  change settings and enable/disable Carriers. Existing soft-deleted rows remain
  hidden and cannot be changed through the application.
- Regular authenticated users may read; admins may update. This is the agreed
  policy for V1-009/V1-010, not an authorization guarantee implemented here.
- Shipment monitoring reuses `monitoring_status` and `monitoring_reason` with no
  additional boolean. V1-008 records the requested manual pause/resume work;
  transition and scheduling details remain for its interview.
- Reused installed Nest, TypeORM, Zod, Vitest, Supertest, and PostgreSQL
  Testcontainers. No dependency or lockfile changes. Nest's built-in UUID pipe
  handles HTTP identifiers; Zod validation runs in the service so internal callers
  receive the same protection. A separate custom Zod pipe was unnecessary.

### API and persistence

| Endpoint                      | Behavior                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `GET /carriers`               | Plain array of non-deleted Carriers, including disabled rows, ordered by code. |
| `GET /carriers/:externalId`   | Read one Carrier by UUIDv4; missing/deleted returns 404.                       |
| `PATCH /carriers/:externalId` | Partial settings update; returns the resulting public record.                  |

Responses use camelCase and contain `externalId`, `code`, `name`, `isActive`,
`notFoundPauseThreshold`, `pollIntervalMinutes`, `rateLimitPerMinute`, `createdAt`,
and `updatedAt`. Internal identities, actor IDs, and deletion metadata are absent.
Routes return `Cache-Control: no-store`.

Updates allow only name, active state, threshold, interval, and rate limit. Names
are trimmed and reject blanks, NUL, or more than 100 UTF-16 code units. Numeric
settings must be integers no greater than 32767; threshold starts at 2, and
interval/rate at 1. Explicit null clears the rate limit; omissions preserve it.
Unknown fields, immutable fields, client actor IDs, empty updates, and coercion
are rejected with a safe 400 response before persistence. Invalid UUIDs return 400. Error responses do not echo request values or unknown field names.

The service injects the `CarriersRepository` interface using the
`CARRIERS_REPOSITORY` Symbol. A provider factory supplies `TypeOrmCarriersRepository`;
`CarrierRecord` remains in the restored contract file. The TypeORM adapter projects explicit public fields and performs partial updates with an explicit
`deleted_at IS NULL` predicate. A transaction retains the update's row lock until
the response is read, preserving independent concurrent changes and preventing
another write/deletion from replacing that response. Same-field concurrent
updates use ordinary database serialization; there is no optimistic version API.

Carrier code is readonly and excluded from ORM updates. Public schemas reject
code changes; renaming preserves both code and UUID. Reviewed migrations remain
the privileged path for direct SQL; no new database trigger or migration is added.

`listActive()` excludes disabled and deleted Carriers without touching Shipments.
V1-012 must apply this eligibility policy when scheduling; no worker polling is
introduced here. No Carrier cache is added, so reads see database state directly.

The temporary Carrier test contract/provider/service is removed. Integration
coverage now uses the production service and repository. Fixtures create and
soft-delete rows directly to model migration-managed lifecycle operations.

## Files Changed

| File                                                              | Review purpose                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/modules/carriers/carrier.entity.ts`                          | Protect adapter code from ORM updates.                                                                            |
| `src/modules/carriers/carriers.repository.ts`                     | Restore the public record, repository interface, and Symbol injection token.                                      |
| `src/modules/carriers/typeorm-carriers.repository.ts`             | Contract implementation/provider, filtering, projection, transactional partial updates.                           |
| `src/modules/carriers/carriers.schemas.ts`                        | Strict UUID/configuration validation and safe validation errors.                                                  |
| `src/modules/carriers/carriers.service.ts`                        | Contract/Symbol injection, read/update operations, application validation.                                        |
| `src/modules/carriers/carriers.controller.ts`                     | List/detail/PATCH HTTP routes using UUIDs.                                                                        |
| `src/modules/carriers/carriers.module.ts`                         | Repository provider registration and Symbol export.                                                               |
| `src/app.module.ts`                                               | Register Carrier HTTP feature in the API.                                                                         |
| `src/modules/carriers/carriers.service.spec.ts`                   | 27 behavior cases using Nest Symbol-token substitution for the repository.                                        |
| `test/integration/database.spec.ts`                               | Replace temporary seam; preserve audit/UUID/uniqueness assertions and add eligibility/concurrent update coverage. |
| `test/e2e/carriers.spec.ts`                                       | 18 real PostgreSQL HTTP cases, including forbidden lifecycle endpoints.                                           |
| `test/support/carrier-repository.ts` (deleted)                    | Remove the superseded temporary contract, adapter, and service.                                                   |
| `src/infrastructure/database/README.md`                           | Update repository-test and migration-owned Carrier lifecycle guidance.                                            |
| `docs/v1/tickets/V1-007-carriers-module.md`                       | Record approved scope and testable revised acceptance criteria.                                                   |
| `docs/v1/database-schema.md`                                      | Record explicit migration codes and read/update-only lifecycle.                                                   |
| `docs/v1/decisions.md`                                            | Defer slugify/automatic creation and record the approved lifecycle.                                               |
| `docs/v1/architecture.md`                                         | Restore the shared repository-contract rule by removing the temporary exception.                                  |
| `docs/v1/folder-structure.md`                                     | Restore the Carrier repository contract in the target layout.                                                     |
| `docs/v1/auth-plan.md`                                            | Preserve regular-user read/admin update policy for auth work.                                                     |
| `docs/v1/tickets/V1-008-shipments-module.md`                      | Record manual pause/resume using existing monitoring columns.                                                     |
| `docs/v1/tickets/V1-012-worker-scheduler.md`                      | Record Carrier eligibility integration obligation.                                                                |
| `docs/v1/tickets/README.md`                                       | Align V1-007 index description with revised scope.                                                                |
| `docs/v1/implementation-summary/V1-007-implementation-summary.md` | Decisions, implementation evidence, limitations, and review/commit handoff.                                       |

## Verification

| Exact command                                                                                                          | Result                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit src/modules/carriers/carriers.service.spec.ts`                                    | Red/green development: initial missing module, then 22 passing cases. Expanded NUL regression failed before its validation fix; final 27 cases pass in the full unit suite. |
| `pnpm exec vitest run --project unit src/modules/carriers/carriers.service.spec.ts src/runtime/composition.spec.ts`    | Passed 25 cases before the final validation additions, including unchanged API/worker separation.                                                                           |
| `pnpm exec vitest run --project integration test/integration/database.spec.ts --project e2e test/e2e/carriers.spec.ts` | Repository slice passed 9 tests; HTTP slice intentionally failed 17 tests with 404 before route registration.                                                               |
| `pnpm exec vitest run --project e2e test/e2e/carriers.spec.ts`                                                         | Passed 17 HTTP cases after route registration; final added NUL case passes in the full suite.                                                                               |
| `pnpm typecheck`                                                                                                       | Passed during implementation.                                                                                                                                               |
| `pnpm check`                                                                                                           | Passed repository formatting, warning-free Oxlint, typecheck, all 75 unit tests in 11 files, and production build.                                                          |
| `pnpm test:integration`                                                                                                | Passed all 42 tests in 4 files after building, using disposable PostgreSQL 18.3 containers and real compiled API/worker runtime checks.                                     |
| `pnpm test:e2e`                                                                                                        | Passed all 21 tests in 3 files after building, including 18 Carrier HTTP tests against PostgreSQL.                                                                          |
| `pnpm format:check`                                                                                                    | Passed after final documentation changes.                                                                                                                                   |
| `git diff --check`                                                                                                     | Passed after final documentation changes; tracked diff and new files reviewed against the revised acceptance criteria.                                                      |

The restoration was checked first with
`pnpm exec vitest run --project unit src/modules/carriers/carriers.service.spec.ts src/runtime/composition.spec.ts`
(30 passing cases) and `pnpm typecheck` (passed). Before restoring production
wiring, the Symbol-token tests failed on the old concrete dependency, proving the
regression check. Earlier development rows above record the initial implementation;
final full-suite totals are unchanged after the restoration.

The full PostgreSQL and HTTP suites ran sequentially with
`pnpm test:integration && pnpm test:e2e`. Initial sandboxed PostgreSQL attempts
could not reach Docker; escalation enabled the disposable containers/local
listeners and all final checks passed. The inherited node-postgres concurrent
query deprecation warning remains in schema introspection; it does not fail tests.
Migration run/revert/run, uniqueness, no schema drift, runtime lifecycle/readiness,
logging, and existing health routes all remain covered and passing.

Remote CI, deployment, production migrations, watch/debug mode, and coverage
report generation were not run. This is backend-only; no frontend exists and no
manual development server was left running. Tests clean up their containers and
listeners.

## Review Notes

- Initial working tree was clean at `80fe8f233a7b6f926ffd61168d43a400a59aa572`.
  The restoration began from clean commit `b039d1f`. All changes belong to this
  task; no unrelated user changes were mixed in.
- V1-005's schema is present and its required local checks were recorded complete.
  V1-004/V1-006 limitations were reconciled with actual code; TLS and scheduler
  deferrals do not block the approved read/update scope.
- Field validation stays in the service, including for future non-HTTP callers.
  The repository contract does not expose lifecycle writes. Query projection
  prevents accidental exposure of entity fields added in later tickets.
- The catalog is small and migration-managed, so list pagination is unnecessary.
  Disabled rows remain readable; deleted rows are uniformly hidden. A successful
  identical-value PATCH still follows TypeORM's normal update timestamp behavior.
- No new foreign key, migration, authentication mechanism, adapter, worker,
  Shipment behavior, or dependency is introduced.

### Standards

Independent standards review inspected the baseline diff and every new source/test
file. No actionable documented-standard violations or consequential baseline
smells were found. Independent follow-up review checked the restoration against
the shared repository-contract architecture and found no actionable issue. The
final summary was checked by the lead.

### Spec

Independent specification review found no missing requirements, scope creep, or
incorrect behavior relative to the user-approved scope. It checked transactional
updates, filtering, projection, validation, and preserved V1-005 assertions.
Independent follow-up review confirmed that the restoration preserves queries
and routes while consistently reconnecting the contract, Symbol, provider factory,
and test dependencies. No actionable issue was found.

Standards: 0 findings. Spec: 0 findings. No outstanding review issue on either axis.

## Remaining Issues

None for the approved V1-007 scope. Explicit cross-ticket deferrals remain:

- V1-009/V1-010: authentication and admin-only update enforcement. These routes
  are currently unauthenticated and are not ready for public deployment.
- V1-008: Shipment manual pause/resume; V1-012: scheduler enforcement of Carrier
  active/deleted eligibility.
- Existing project limitations: PostgreSQL TLS is deferred and schema
  introspection emits the previously recorded pg deprecation warning. Remote CI
  has not run.

## Suggested Review Order

1. Restored repository contract, service injection, and provider/module wiring.
2. TypeORM implementation, service, controller/module wiring, and entity mapping.
3. Unit/integration/HTTP tests, follow-up documentation, and this summary.

## Committed History

1. `feat(carriers): V1-007 add carrier read and configuration APIs`
   - Created as `b983f53`. Pre-commit formatting/lint, typecheck, and all 75 unit
     tests passed.
   - Files: `src/app.module.ts`; all seven files in `src/modules/carriers/`;
     `test/integration/database.spec.ts`; `test/e2e/carriers.spec.ts`; deletion of
     `test/support/carrier-repository.ts`.
   - Purpose: ship the read/update feature, replace the temporary seam, and verify
     validation, persistence, HTTP behavior, and relationship preservation together.
2. `feat(docs): V1-007 record carrier lifecycle decisions and verification`
   - Created as `b039d1f`.
   - Files: `src/infrastructure/database/README.md`; `docs/v1/auth-plan.md`;
     `docs/v1/database-schema.md`; `docs/v1/decisions.md`;
     `docs/v1/architecture.md`; `docs/v1/folder-structure.md`;
     `docs/v1/tickets/README.md`; the V1-007, V1-008, and V1-012 ticket files;
     this implementation summary.
   - Purpose: preserve approved scope, deferred responsibilities, and review evidence.

The user explicitly approved both commits. No merge, tag, push, or deployment was
authorized or performed as part of this commit handoff.

## Approved Restoration Commit

`feat(carriers): V1-007 restore repository contract`

One coherent correction contains:

- `src/modules/carriers/carriers.repository.ts`, `typeorm-carriers.repository.ts`,
  `carriers.service.ts`, and `carriers.module.ts`: restore the contract, Symbol,
  implementation binding, and service injection.
- `src/modules/carriers/carriers.service.spec.ts` and
  `test/integration/database.spec.ts`: exercise the restored dependency wiring.
- `docs/v1/architecture.md`, `docs/v1/folder-structure.md`,
  `docs/v1/tickets/V1-007-carriers-module.md`,
  `src/infrastructure/database/README.md`, and this summary: restore consistent
  architecture guidance and record the correction.

The user separately approved this restoration commit. No merge, tag, push, or
deployment is included in that approval.
