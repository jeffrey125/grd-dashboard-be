# V1-010 implementation summary

## Summary

Implemented the approved employee-only backend authentication and authorization.
Admin-managed email/password accounts, Admin/Staff guards, mandatory issued-password
replacement, revocable 24-hour sessions, and trusted audit actors are complete in
the working tree. The user approved the four local commits listed below. No deployment or non-test migration was performed.

## Changes Made

- Added approved Better Auth 1.7.7 and Nest throttler 6.7.1. Reused TypeORM's pg
  pool, existing Bottleneck, Nest, and Zod. The narrow Nest facade owns product
  policy; Better Auth owns credential hashing, signed cookies, and sessions.
- Added four auth tables, immutable public user UUIDs, unique normalized emails,
  and indexed NO ACTION foreign keys, including Carrier/Shipment/tracking actors.
  Schema generation reports no drift; the original migration remains unchanged.
- Admins provision/edit/reset/deactivate accounts. Staff use all current Shipment
  workflows and read Carriers; only admins edit Carriers/manage accounts.
  Restricted sessions can only access profile, password replacement, and logout.
  Password changes require the current password and a different new password.
- Fixed 24-hour sessions allow simultaneous logins. Logout ends the current one;
  password reset/change, email/role changes, and deactivation revoke all. A shared
  queue plus database advisory lock serialize account/session mutations and
  prevent competing admin changes or login/reset races from restoring access.
- Enforced exact Origin and credentialed CORS, HttpOnly/Lax host-only cookies,
  production Secure/HTTPS, no-store responses, default-deny policies, and basic
  login/password throttles. API config is validated before opening database
  resources. Worker configuration stays independent.
- Added hidden-input bootstrap/recovery commands and safe account lifecycle logs.
  HTTP logger serializers now avoid handing live headers to recursive redaction;
  this prevents redaction from replacing an incoming session cookie in memory.
- Employee writes populate audit actors. Worker found/not-found/failed outcomes
  clear only the updater actor, preserving the employee creator. Client actor
  fields remain rejected. Removed `pnpm query` separately as requested.

## Files Changed

V1-009 design files are inventoried in the [design summary](V1-009-implementation-summary.md).
The implementation and separate query removal touch the following files: This summary records the review, verification, and commit partition.

| File                                                                   | Purpose                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `.env.example`                                                         | Document required API-only auth environment.                                       |
| `docs/v1/tickets/V1-010-authentication-implementation.md`              | Ticket completion and review handoff.                                              |
| `package.json`                                                         | Approved auth dependencies/operator commands; separate query-script removal hunk.  |
| `pnpm-lock.yaml`                                                       | Pinned approved auth dependency graph.                                             |
| `src/app.module.ts`                                                    | Wire API-only auth module.                                                         |
| `src/auth-cli.ts`                                                      | Hidden-input operator bootstrap/recovery with safe lifecycle logs.                 |
| `src/infrastructure/database/README.md`                                | Separate requested removal of pnpm query documentation.                            |
| `src/infrastructure/database/migrations/1792108800000-EmployeeAuth.ts` | Reversible four-table auth extension, identity protection, actor foreign keys.     |
| `src/infrastructure/logging/logging.options.ts`                        | Safe auth event fields and redaction without mutating live request cookies.        |
| `src/infrastructure/logging/logging.types.ts`                          | Safe auth event fields and redaction without mutating live request cookies.        |
| `src/infrastructure/logging/pino-logger.service.spec.ts`               | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `src/main.ts`                                                          | Validate API auth before opening resources.                                        |
| `src/modules/auth/accounts.controller.ts`                              | Narrow account/auth HTTP facade; no generic library handler.                       |
| `src/modules/auth/auth-account.entity.ts`                              | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/auth/auth-browser.middleware.ts`                          | Exact Origin/credentialed CORS enforcement and no-store responses.                 |
| `src/modules/auth/auth-session.entity.ts`                              | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/auth/auth-user.entity.ts`                                 | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/auth/auth-verification.entity.ts`                         | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/auth/auth.config.spec.ts`                                 | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `src/modules/auth/auth.config.ts`                                      | API/CLI secret, exact origins, HTTPS, and explicit proxy validation.               |
| `src/modules/auth/auth.controller.ts`                                  | Narrow account/auth HTTP facade; no generic library handler.                       |
| `src/modules/auth/auth.engine.ts`                                      | Better Auth server API, shared pg pool, signed fixed-life cookies.                 |
| `src/modules/auth/auth.entities.ts`                                    | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/auth/auth.guard.spec.ts`                                  | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `src/modules/auth/auth.guard.ts`                                       | Default-deny route policies, fresh principals, forced-change and role checks.      |
| `src/modules/auth/auth.module.ts`                                      | Dependency wiring, global auth/throttle guards, Origin middleware.                 |
| `src/modules/auth/auth.policy.ts`                                      | Default-deny route policies, fresh principals, forced-change and role checks.      |
| `src/modules/auth/auth.repository.ts`                                  | Feature repository contract and public account projection.                         |
| `src/modules/auth/auth.schemas.ts`                                     | Strict normalized account and credential input validation.                         |
| `src/modules/auth/auth.service.ts`                                     | Account/password/session lifecycle and admin protections.                          |
| `src/modules/auth/typeorm-auth.repository.ts`                          | Transactional account persistence, fresh principal lookup, serialized auth queue.  |
| `src/modules/carriers/carrier.entity.ts`                               | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/carriers/carriers.controller.ts`                          | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/carriers/carriers.repository.ts`                          | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/carriers/carriers.service.spec.ts`                        | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `src/modules/carriers/carriers.service.ts`                             | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/carriers/typeorm-carriers.repository.ts`                  | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/health/health.controller.ts`                              | Explicit public policy on minimal health routes.                                   |
| `src/modules/shipments/shipment.entity.ts`                             | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/shipments/shipments.controller.ts`                        | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/shipments/shipments.repository.ts`                        | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/shipments/shipments.service.spec.ts`                      | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `src/modules/shipments/shipments.service.ts`                           | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/shipments/typeorm-shipments.repository.ts`                | Enforce role policy and propagate trusted employee actors through business writes. |
| `src/modules/tracking/tracking-run.entity.ts`                          | Map auth tables or indexed NO ACTION audit relationships.                          |
| `src/modules/tracking/typeorm-tracking.repository.ts`                  | Clear updater actor for all worker outcome writes.                                 |
| `src/runtime/composition.spec.ts`                                      | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/e2e/auth.spec.ts`                                                | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/e2e/carriers.spec.ts`                                            | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/e2e/shipments.spec.ts`                                           | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/integration/auth.spec.ts`                                        | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/integration/database.spec.ts`                                    | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/integration/runtime.spec.ts`                                     | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/integration/schema.spec.ts`                                      | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/integration/tracking.spec.ts`                                    | Auth coverage or existing regression updated for authenticated identity/schema.    |
| `test/support/authentication.ts`                                       | Disposable database/auth configuration or real-session HTTP fixture.               |
| `test/support/create-test-app.ts`                                      | Disposable database/auth configuration or real-session HTTP fixture.               |
| `test/support/environment.ts`                                          | Disposable database/auth configuration or real-session HTTP fixture.               |
| `test/support/postgresql-container.ts`                                 | Disposable database/auth configuration or real-session HTTP fixture.               |
| `test/support/shipment-database.ts`                                    | Disposable database/auth configuration or real-session HTTP fixture.               |

## Verification

| Command/check                                                                                                                                                                 | Result                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                                                                                                                                                                  | Passed on the final implementation: formatting, lint, TypeScript, 212 unit tests in 23 files, and production build.                                                                                                                                                                        |
| `pnpm build && pnpm exec vitest run --project integration --project e2e`                                                                                                      | Ran the complete 22-file suite: 164 passed, 7 failed. Failures were outdated authenticated actor/schema/runtime fixture expectations and the auth UUID mapping drift; all were corrected and their complete affected files rerun below.                                                    |
| `pnpm exec vitest run --project integration test/integration/runtime.spec.ts test/integration/database.spec.ts test/integration/schema.spec.ts test/integration/auth.spec.ts` | Passed 51 tests across all 4 files after final corrections: startup/shutdown, shared pool, migrations up/down/reapply and no drift, constraints/FKs, auth races, expiry, recovery, and Secure cookies.                                                                                     |
| `pnpm exec vitest run --project integration test/integration/auth.spec.ts test/integration/tracking.spec.ts --project e2e test/e2e/shipments.spec.ts`                         | Passed 31 tests across 3 files: auth lifecycle, all worker outcome actor transitions, Shipment regression.                                                                                                                                                                                 |
| `pnpm exec vitest run --project integration test/integration/auth.spec.ts --project e2e test/e2e/auth.spec.ts`                                                                | Passed 7 tests at that stage; the added eighth auth test subsequently passed in the 51-test rerun. Covers cookie login, role restrictions, forced change, spoofing rejection, CORS, throttling, and audit attribution.                                                                     |
| `node /tmp/grd-auth-cli-check.mjs`                                                                                                                                            | Passed disposable-PostgreSQL pseudo-terminal checks: bootstrap, second-bootstrap refusal, recovery, hidden password canaries, safe lifecycle event presence, persisted replacement restriction, rejection of noninteractive input. Temporary harness only; no real employee/database used. |
| Independent Standards and Spec reviews                                                                                                                                        | Found worker updater attribution and missing CLI logger; both fixed. Spec recheck reports no remaining findings.                                                                                                                                                                           |
| `git diff --check` and final working-tree review                                                                                                                              | Passed; unrelated pre-existing `sample.txt` untouched.                                                                                                                                                                                                                                     |

TDD evidence includes failing config/account/HTTP tests before implementation and
three failing worker actor tests before clearing updater IDs. Final evidence uses
the full-suite run plus targeted complete-file reruns; the full long-running
suite was not repeated after those targeted fixes. Production deployment and
frontend/browser UI testing were not performed; this ticket is backend-only.
A TypeORM schema-introspection deprecation warning from pg is non-failing.

## Review Notes

- Rate limits are per-process and reset on restart. Shared storage is needed
  before multiple API replicas; the approved deployment uses one API process.
- Auth transaction queueing prevents pool starvation while the library uses the
  same pool. The database lock also coordinates operator processes. Ordinary
  business requests already authorized before revocation may finish.
- Accounts are deactivated, never deleted. Recovery does not reactivate or
  promote accounts. No public bootstrap/signup/reset handler is mounted.
- Production requires real auth configuration, reviewed migration execution,
  same-site HTTPS frontend/API origins, and initial admin bootstrap. Existing
  unauthenticated API consumers must adopt credentialed login requests.
- The schema is operationally reversible, but reverting the auth migration drops
  auth data; tested reversals used disposable databases only.
- Current repository changes belong to the requested tickets except the separate
  `pnpm query` removal. No unrelated tracked edits were present at baseline
  `8275874a6ce65480ed5aaccf7580b9fbf50806e6`.

### Standards review

One substantive finding: worker updates retained employee attribution. Fixed in
all three outcome writes, with failing-then-passing PostgreSQL regressions. No
material remaining standards/smell findings.

### Spec review

Two substantive findings: worker attribution and omitted operator lifecycle logs.
Both fixed; independent recheck found no remaining issues. No scope creep found.

## Remaining Issues

None within the approved backend ticket scope. Frontend screens, deployment,
production secret provisioning/migration/bootstrap, and V1-016 refresh/events
remain separate work. No production database or employee credentials were touched.

## Suggested Review Order

1. ADR/API contract and migration/entity mappings.
2. Auth engine, repository, service, guard/middleware, and controllers.
3. Audit propagation, logger boundary, operator CLI, and regression evidence.

## Approved commit partition

1. `feat(auth): V1-009 record employee authentication design`
   - Files: `CONTEXT.md`, ADR 0001, auth API/plan, architecture/database-schema,
     V1-009 ticket and summary. Purpose: approved design and integration contract.
2. `feat(auth): V1-010 add employee identity schema`
   - Files: new auth migration, four auth entities plus entity list, business
     entity actor mappings, schema/database migration tests, shipment database
     helper, and entity/migration fixture hunks in Carrier e2e. Purpose: reviewed
     persistent identities, sessions, credentials, and audit relationships.
3. `feat(auth): V1-010 enforce employee sessions and role policies`
   - Files: remaining auth code/tests, API composition/startup, CLI, configuration,
     auth package/lockfile additions, Carrier/Shipment actor behavior, worker actor
     clearing, logging, authenticated fixtures, runtime tests, and V1-010 ticket/
     summary. Purpose: account/session lifecycle, access control, and audit writes.
4. `chore(database): remove query shortcut`
   - Files: only the `query` script removal hunk in `package.json` and the matching
     example in `src/infrastructure/database/README.md`. Purpose: remove the
     user-requested shortcut without removing other TypeORM commands.

The user explicitly approved this partition. Stage only the listed files/hunks;
leave the unrelated `sample.txt` untouched. Commit hashes are reported in the
conversation handoff. No push, merge, or tag is included in this approval.
