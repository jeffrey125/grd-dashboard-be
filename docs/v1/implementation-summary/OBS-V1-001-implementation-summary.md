# OBS-V1-001 implementation handoff

## Summary

Authenticated frontend diagnostics and shared OpenSearch frontend/backend debugging
dashboards. Application changes are local and uncommitted; no deployment occurred.
OpenSearch configuration and saved objects were applied live under the approved scope.

## Changes Made

- Browser/React/unhandled rejection and failed API capture with privacy projection,
  duplicate suppression and a 10-event/minute/tab budget. No user activity analytics.
- Authenticated, origin-protected strict ingestion with 20-request/minute/account
  throttling; existing Pino forwarding and server-generated request IDs reused.
- Hidden private source maps per release and a Node SourceMap resolver; public
  artifacts exclude maps. The production release must archive its exact build maps.
- New-log parsing pipeline, typed fields, future-index templates and 16 shared saved
  objects, including two dashboards. Historical records/retention are unchanged.

## Files Changed

Backend, relative to `grd-dashboard-be`:

| File                                                          | Purpose                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/modules/frontend-telemetry/frontend-telemetry.module.ts` | Strict schema and authenticated reporting controller/module                    |
| `src/modules/frontend-telemetry/frontend-telemetry.spec.ts`   | Privacy/schema and logger projection tests                                     |
| `src/app.module.ts`                                           | API-only feature registration                                                  |
| `src/modules/auth/auth.policy.ts`                             | Telemetry rate-limit metadata                                                  |
| `src/modules/auth/auth.module.ts`                             | Account throttle and exposed request-ID header                                 |
| `src/infrastructure/logging/logging.types.ts`                 | Typed diagnostic fields                                                        |
| `test/e2e/frontend-telemetry.spec.ts`                         | Real PostgreSQL session, origin, validation, revocation and quota verification |
| `.do/opensearch-debug-pipeline.json`                          | Parse structured logs while preserving plain/scalar/array output               |
| `.do/opensearch-debug-mapping.json`                           | Explicit searchable diagnostic fields                                          |
| `.do/opensearch-index-templates.json`                         | Mapping and parser inheritance for rollover indexes                            |
| `.do/opensearch-debug-dashboards.ndjson`                      | Reproducible data view, charts, searches and dashboards                        |
| `docs/v1/frontend-debugging.md`                               | Contract, operation, source maps, rollout and rollback                         |
| `docs/v1/auth-api.md`                                         | New authenticated endpoint and CORS contract                                   |
| `docs/v1/frontend-handoff.md`                                 | Frontend integration pointer                                                   |
| `docs/v1/app-platform.md`                                     | Parser bootstrap order and dashboard operation                                 |
| This summary                                                  | Review/verification evidence                                                   |

Frontend, relative to sibling `grd-dashboard-fe`:

| File                                 | Purpose                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| `src/lib/frontend-telemetry.ts`      | Privacy projection, frame extraction, bounded reporting          |
| `src/lib/frontend-telemetry.test.ts` | Privacy, auth gating, deduplication, quota and correlation tests |
| `src/app/telemetry.ts`               | Session-aware composition and browser listeners                  |
| `src/api/api.ts`                     | Failed request callback before normalization/session handling    |
| `src/app/router.ts`                  | Report errors caught by Router boundaries                        |
| `src/main.tsx`                       | Install capture and React root error callbacks                   |
| `src/vite-env.d.ts`                  | Typed build release constant                                     |
| `vite.config.ts`                     | Release stamp and private map extraction                         |
| `.gitignore`                         | Exclude private map archives                                     |
| `.dockerignore`                      | Exclude local archives from build contexts                       |
| `scripts/resolve-frontend-frame.mjs` | Offline bundle-frame to source-location lookup                   |
| `package.json`                       | `debug:frame` script; no dependency changes                      |
| `e2e/frontend-telemetry.spec.ts`     | Desktop/mobile signed-in and anonymous browser regression        |
| `README.md`                          | Operator instructions                                            |

Pre-existing frontend `e2e-backend/tracking-review.spec.ts` changes are unrelated
and preserved. No dependencies, lockfiles, database migrations or CI/CD workflows
were changed. Built-in hooks, existing Zod/Pino/Throttler and custom composition
were approved during the design interview.

## Verification

- Backend `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format:check`: passed.
- Backend `pnpm test`: 42 files / 371 tests passed outside the restricted sandbox.
  Initial sandbox run had 3 socket-binding EPERM failures; the unrestricted rerun passed.
- `pnpm exec vitest run --project e2e test/e2e/frontend-telemetry.spec.ts`: passed
  with disposable PostgreSQL and real sessions. Logging e2e also passed separately
  during the first focused run; the initial new-test harness lacked real PostgreSQL
  and was corrected before the successful run.
- Backend `pnpm test:cov:all`: 94 files / 714 tests passed; combined statements
  89.08%, branches 79.03%, functions 92.1%, lines 90.6% (761.01 seconds).
- Backend `pnpm test:container`: 6 tests passed, including migration revert/reapply.
- Frontend `pnpm typecheck`, `pnpm lint`, changed-file Biome checks, `pnpm exec knip`,
  and `pnpm build`: passed. Existing large-chunk and route-generator warnings remain.
- Frontend `pnpm test`: 37 files / 255 tests passed.
- Frontend `pnpm exec playwright test e2e/frontend-telemetry.spec.ts`: 4 passed
  across desktop/mobile Chromium using the production build and mocked API transport.
- Frontend `pnpm test:container`: 5 passed, including HTTPS serving/image privacy.
- Actual private map resolved to original source using Node; public `dist/assets`
  contained zero `.map` files.
- Live parser simulations passed JSON/plain/scalar/array cases. Fresh production
  logs have `grd` fields; count/event aggregations and P95 duration returned results.
- Global tenant import returned success for all 16 objects; both dashboards reread.
- Live browser verification: frontend six panels, backend seven panels, zero page
  errors; backend tables show live records. Missing panel-version metadata was
  corrected before final validation. Private-tenant duplicate objects created by
  the first import were removed; the pre-existing data view was preserved.
- Manual servers: frontend http://localhost:5173 (HTTP 200), disposable backend
  http://localhost:3017/api/v1 (health/ready reports application and database up).
- Full frontend acceptance suite and deployed frontend-to-OpenSearch smoke were
  not run; the application has not been deployed.

## Review Notes

Only safe bundle frames and allowlisted names are retained; raw messages and full
stacks are deliberately excluded. Correlation IDs in frontend reports are untrusted
hints. Failures are best effort with no durable queue/retries. Browser process
crashes are not captured. The private-map resolver is manual, not OpenSearch-side
symbolication. New fields are present only on records ingested after pipeline activation.

## Remaining Issues

Application deployment and exact-production-build private map archival are separate
release work. No commit, push, tag or deployment performed. Frontend production
panels remain empty until deployment. Both live dashboards are verified; empty frontend panels are expected before deployment.

## Suggested Review Order

1. Backend schema/controller and authenticated e2e test.
2. Frontend reporting module, session/API integration and browser tests.
3. Private map build/resolver and privacy exclusions.
4. OpenSearch parser/mappings, dashboard export and operational guide.

## Proposed commits (explicit approval required)

1. Backend application files, auth/frontend contract docs and feature tests:
   `feat(observability): OBS-V1-001 ingest authenticated frontend diagnostics`
2. Frontend files listed above, excluding pre-existing tracking-review changes:
   `feat(observability): OBS-V1-001 capture frontend failures with private source maps`
3. Backend `.do` artifacts, debugging/platform guides and this summary:
   `feat(observability): OBS-V1-001 configure OpenSearch debugging dashboards`
