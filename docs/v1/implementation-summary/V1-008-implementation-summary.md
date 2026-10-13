# V1-008 implementation summary

## Summary

Implemented Shipment management through public UUIDs, atomic creation of 1–10
explicit records, duplicate reporting, note updates, soft deletion, and strict
manual pause/resume. The user-approved ticket scope is complete in the working
tree. Unit, PostgreSQL integration, HTTP e2e, formatting, lint, typecheck, and build
checks pass. Independent standards and specification reviews found no blocking
issues. Following explicit approval, the implementation commit was created and
the documentation commit accompanies this summary. No merge, tag, push, or
production migration was performed.

## Changes Made

### Approved approach and behavior

- Reused installed Nest, Zod, TypeORM, PostgreSQL, Vitest, Supertest, and
  Testcontainers. No package/lockfile changes, new production dependencies, or
  migrations. Existing Shipment mapping and database constraints are sufficient.
  The implementation uses the feature-owned repository contract and Symbol-token
  injection pattern restored in V1-007.
- Generic Carrier reference validation was explicitly approved: trim, require a
  string of 1–255 UTF-16 code units, reject NUL, and preserve case, leading zeros,
  and interior whitespace. No JSON-number conversion or provider-specific format
  restrictions. Notes are trimmed strings of 1–500 UTF-16 code units or null;
  omitted creation notes become null. Unknown and client actor/state/identity
  fields are rejected. Row errors report one-based rows and allowlisted fields,
  without echoing submitted values or unknown field names.
- The original app was inspected as behavioral reference. Within a request, the
  last normalized Carrier/reference occurrence supplies the notes, including null
  when omitted. Every submitted row is validated before deduplication. Each pair
  appears once, preserving first-occurrence pair order within its result array.
  Existing non-deleted Shipments remain unchanged and appear in `duplicates`,
  even when monitoring is paused/completed. Soft-deleted pairs can be added as
  new rows with new public UUIDs.
- Missing, deleted, or disabled Carriers reject the entire creation batch.
  Existing Shipments remain accessible when their Carrier is disabled/deleted.
  Creation starts active and immediately due, with null verification URL and
  actor columns. Pure Carrier reference policies provide the original UPS,
  EchoShip, and FFE URL templates without loading provider sessions. A successful
  lookup in later tracking tickets populates the URL; creation never does.
- Pause accepts only active → paused/manual, clearing the next check. Resume
  accepts only paused/manual → active, clearing the reason and making the next
  check immediately due. Both retain the not-found count and tracking history.
  Repeated or invalid transitions return 409. Threshold pause requires the later
  manual-refresh workflow; delivered remains terminal. Notes/lifecycle writes
  increment the existing lock version; no public version-precondition API is added.

### HTTP contract

| Endpoint                             | Behavior                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /shipments`                    | `{ items: [{ carrierExternalId, trackingReference, notes? }] }`, 1–10 submitted items. Returns full public records in `{ inserted, duplicates }`; 201 with any insertion, otherwise 200. |
| `GET /shipments`                     | Plain array of non-deleted Shipments, newest creation first, then descending internal identity for ties; initially unpaginated.                                                          |
| `GET /shipments/:externalId`         | Read by UUIDv4; missing/deleted returns 404.                                                                                                                                             |
| `PATCH /shipments/:externalId`       | Strict `{ notes: string \| null }`; missing/deleted returns 404.                                                                                                                         |
| `DELETE /shipments/:externalId`      | Soft-delete and clear the schedule; 204 on success, 404 when missing/deleted.                                                                                                            |
| `POST /shipments/:externalId/pause`  | Empty/absent body; returns the changed record with 200, invalid transition 409.                                                                                                          |
| `POST /shipments/:externalId/resume` | Empty/absent body; returns the changed record with 200, invalid transition 409.                                                                                                          |

Responses use camelCase and include `externalId`, a Carrier summary
(`externalId`, `code`, `name`, `isActive`), `trackingReference`, `notes`,
`verificationUrl`, `monitoringStatus`, `monitoringReason`, `lastAttemptedAt`,
`nextCheckAt`, `consecutiveNotFoundCount`, `createdAt`, and `updatedAt`.
Dates serialize to ISO timestamps. Internal IDs, snapshot pointers, actor IDs,
deletion metadata, and lock versions are excluded through explicit projection.
Routes set `Cache-Control: no-store`. Invalid UUIDs return 400.

### Transaction guarantees

The service validates and deduplicates before repository writes. The repository
then locks all referenced Carriers in identity order with shared locks and checks
eligibility again. Concurrent disable/deletion serializes with creation. Invalid
eligibility returns without inserting any sibling.

Creation uses one READ COMMITTED transaction and deterministic pair ordering to
avoid reverse-order bulk deadlocks. Parameterized PostgreSQL `INSERT ... ON
CONFLICT` targets only the existing partial unique Carrier/reference index. Other
database errors propagate and roll back the complete batch. A subsequent statement
reads a conflicting row with a fresh snapshot after a concurrent transaction
commits; the row stays locked until its public response is read. If a concurrent
deletion removed that conflict, creation retries the insert/read sequence.
Existing duplicate notes, state, timestamps, versions, and history are not updated.

Note updates retain the write lock through response retrieval. Monitoring commands
lock the Shipment before validating the transition. Deletion is one atomic update
with an explicit non-deleted predicate. No operation revives a deleted UUID, and
an old UUID cannot modify a newly created replacement.

## Files Changed

| File                                                              | Review purpose                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/app.module.ts`                                               | Register the Shipment HTTP feature only in the API root.                                                          |
| `src/modules/carriers/carrier-reference-policy.ts`                | Generic reference validation and pure original Carrier URL templates.                                             |
| `src/modules/carriers/carrier-reference-policy.spec.ts`           | String preservation, validation, encoded URLs, and unknown-Carrier behavior.                                      |
| `src/modules/shipments/shipments.schemas.ts`                      | Strict request/public-record/result schemas and safe row error structure.                                         |
| `src/modules/shipments/shipments.repository.ts`                   | Public records, use-case results, repository interface, and Symbol token.                                         |
| `src/modules/shipments/typeorm-shipments.repository.ts`           | Transactional creation, eligibility/row locks, duplicate handling, public projection, and lifecycle writes.       |
| `src/modules/shipments/shipments.service.ts`                      | Complete validation, last-occurrence deduplication, Carrier policy selection, and safe HTTP error mapping.        |
| `src/modules/shipments/shipments.controller.ts`                   | UUID routes, response status selection, and no-store headers.                                                     |
| `src/modules/shipments/shipments.module.ts`                       | Repository provider and service/controller composition.                                                           |
| `src/modules/shipments/shipments.service.spec.ts`                 | 29 service creation validation/normalization/atomicity cases.                                                     |
| `test/support/shipment-database.ts`                               | Disposable migrated PostgreSQL fixture shared by Shipment integration/e2e suites.                                 |
| `test/integration/shipments.spec.ts`                              | Nine real PostgreSQL persistence, rollback, ordering, eligibility race, and lifecycle/concurrent-duplicate cases. |
| `test/e2e/shipments.spec.ts`                                      | Fourteen HTTP cases through AppModule and PostgreSQL, including safe 500/rollback and simultaneous requests.      |
| `docs/v1/tickets/V1-008-shipments-module.md`                      | Record the user-approved contract and scope refinements.                                                          |
| `docs/v1/tracking-behavior.md`                                    | Generic validation, deduplication, URL timing, creation eligibility, and manual monitoring behavior.              |
| `docs/v1/database-schema.md`                                      | Application scheduling, URL, deletion, and version semantics; schema unchanged.                                   |
| `docs/v1/tickets/V1-011-tracking-persistence.md`                  | Hand off successful-lookup URL persistence and stale-write protection.                                            |
| `docs/v1/implementation-summary/V1-008-implementation-summary.md` | Decisions, evidence, limitations, review, and commit plan.                                                        |

## Verification

| Exact command                                                                                                                               | Result                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit src/modules/shipments/shipments.service.spec.ts`                                                       | Initial missing-service red run; then one passing tracer test and later all 29 service cases passed.                                                                                                            |
| `pnpm exec vitest run --project integration test/integration/shipments.spec.ts`                                                             | Initial missing-repository red run; first creation case passed against PostgreSQL. Lifecycle expansion failed on missing methods, then all seven initial cases passed. Final nine cases pass in the full suite. |
| `pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts`                                                                             | Twelve cases failed with unregistered-route 404s before wiring; all 13 initial cases passed after wiring. Final 14 cases pass in the full suite.                                                                |
| `pnpm exec vitest run --project unit src/modules/shipments/shipments.service.spec.ts src/modules/carriers/carrier-reference-policy.spec.ts` | Passed 33 tests in two files.                                                                                                                                                                                   |
| `pnpm typecheck`                                                                                                                            | Passed throughout completed slices; early discriminated-union/test-parameter typing errors were corrected before final verification.                                                                            |
| `pnpm check`                                                                                                                                | Passed formatting, warning-free Oxlint, typecheck, all 108 unit tests in 13 files, and production build.                                                                                                        |
| `pnpm test:integration && pnpm test:e2e`                                                                                                    | Final run passed 51 integration tests in five files and 35 e2e tests in four files, with production builds before each suite. All database behavior used disposable PostgreSQL 18.3 containers.                 |
| `pnpm format:check && pnpm lint && pnpm typecheck`                                                                                          | Final source/test/documentation check recorded below after summary completion.                                                                                                                                  |
| `git diff --check`                                                                                                                          | Passed before summary; repeated in final handoff verification.                                                                                                                                                  |

Final handoff checks passed: `pnpm format:check && pnpm lint && pnpm typecheck`
and `git diff --check`. The final formatting pass normalized the added race-test
layout; it did not change behavior. The lead reviewed the final tracked diff and
new files against the clean baseline and each acceptance criterion.

The initial sandboxed database test failed because Docker was inaccessible;
escalated runs used disposable containers and local listeners. The first full
integration run passed 45 tests but failed four existing startup JSON-log tests
because the locally installed `@nestjs/core/index.js` contained a Console Ninja
extension hook that printed colored text. E2e did not run in that failed chained
command. Temporarily removing only that injected hook allowed the final full
integration/e2e run to pass. The hook was restored afterward, and its SHA-256
matched the original
`81239b7f838540635b3fea7d179fe7d454dc82248974b167f672e9f6f141b23a`.
No installed dependency modification is part of the deliverable.

The inherited pg concurrent-query deprecation warning still appears during
schema introspection; all final database checks pass. Remote CI, coverage reports,
live Carrier requests, deployment, and production migrations were not run. This
is backend-only; no frontend or persistent development server was started.

## Review Notes

- Baseline was clean `c55c8e6d6a454a6bae12cb15335f22d6cfe50dd2` on `master`.
  All tracked/new changes listed here belong to this ticket. The original
  shipment-monitoring repositories were read only. V1-007's repository restoration
  and V1-005's existing entity/index/migration are present; prerequisite deferrals
  do not block this scope.
- In this API, an active duplicate means a non-deleted database pair, regardless
  of its monitoring status. Neither creation nor repeated pause/resume silently
  overwrites existing lifecycle state. Missing/deleted UUIDs consistently return
  404, including repeated DELETE.
- Carrier UUIDs normalize to lowercase before deduplication. Reference strings
  remain case-sensitive. Notes/reference limits follow Zod's UTF-16 string length,
  consistent with the existing Carrier validation style.
- The response schemas represent application records with Date values; Nest
  serializes them to ISO strings. Current snapshot/history data and tracking
  execution endpoints remain in later tickets. No cache means cross-process reads
  see PostgreSQL state directly.
- The implement-ticket/TDD workflow shaped service, repository, and HTTP behavior
  coverage. The code-review workflow used independent standards/spec reviewers.
  Final diff and acceptance criteria were checked by the lead.

### Standards

Independent review found zero substantive documented-standard violations or
actionable maintainability findings. Repository contracts, query ownership,
public projection, and transaction boundaries match project conventions.

### Spec

Independent review found zero blocking requirement mismatches, scope creep, or
incorrect behavior. It suggested explicit newest-first/tie-breaker and concurrent
Carrier-disable coverage; both were added and pass in the final integration run.

Standards: 0 actionable findings. Spec: 0 blocking findings; both suggested coverage
improvements are complete.

## Remaining Issues

None for the approved V1-008 implementation scope. Cross-ticket/local limitations:

- V1-010 must implement authentication/authorization before public deployment.
- V1-011–V1-016 own lookup persistence, scheduling, adapter execution, successful
  URL persistence, and threshold-pause recovery. URLs intentionally remain null
  until that workflow exists.
- The restored local Console Ninja hook can reproduce the four startup-log test
  failures while instrumentation is enabled. Production source and tests were
  not weakened to accommodate extension output.
- Existing PostgreSQL TLS deferral and pg introspection warning remain. Remote CI
  has not run; the unpaginated list is the approved initial contract.

## Suggested Review Order

1. V1-008 approved decisions, request/record schemas, and repository contract.
2. Transactional repository, Carrier policy, service, and HTTP/module wiring.
3. Service/Carrier-policy tests, PostgreSQL integration/e2e suites, and documentation.

## Committed History

1. `feat(shipments): V1-008 add atomic creation and management APIs`
   - Created as `8c6803c`. Pre-commit formatting/lint fixes, typecheck, and all
     108 unit tests passed.
   - Files: `src/app.module.ts`; both `src/modules/carriers/carrier-reference-policy`
     files; all seven new `src/modules/shipments/shipments.*` and
     `typeorm-shipments.repository.ts` files listed above; `test/support/shipment-database.ts`;
     `test/integration/shipments.spec.ts`; `test/e2e/shipments.spec.ts`.
   - Purpose: ship the cohesive Shipment API, repository/policy seams, and required
     behavior/concurrency tests. Existing `shipment.entity.ts` is unchanged.
2. `feat(docs): V1-008 record shipment contracts and verification`
   - Files: `docs/v1/database-schema.md`, `docs/v1/tracking-behavior.md`, the V1-008
     and V1-011 ticket files, and this summary.
   - Purpose: preserve agreed behavior, future integration obligations, and review
     evidence separately from executable changes. This commit includes the final
     summary and therefore records its subject rather than its own hash.

The user explicitly approved both commits. Publishing, merging, and tagging were
not authorized or performed.
