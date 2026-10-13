# V1-014 implementation summary

## Summary

Implemented EchoShip request and browser monitoring, selected through the Carrier
database setting. Request is the default; browser is a manually selected backup.
Both modes use fresh verified authentication per run and preserve calendar dates.
The detail and tracking APIs are authoritative in both modes. A live disagreement
with the portal's feature-selected location-history panel was investigated and
resolved by explicit user decision: DOM text does not override API evidence.

Exploration reproduced the browser-inspection-to-HTTP-session pattern from
`/home/jeff/apps/tom-automation` without copying its Bun cookie parser or its
browser-dependent Cvent authentication. The original shipment-monitoring adapter
and EchoShip frontend were studied for field meanings. No reference repository
was changed.

## Changes Made

### Carrier settings and persistence

- Added `carriers.fetch_mode`, exposed as `fetchMode` by existing Carrier GET/PATCH
  endpoints. Request is initialized for UPS/EchoShip; FFE is initialized to browser.
  Unsupported Carrier/mode combinations are rejected. No `.env` transport switch.
- Added nullable `tracking_runs.fetch_mode`, captured under a Carrier row lock at
  execution start. Mode edits affect the next run, including queued manual runs,
  but never change an active session. Historical/queued runs do not invent a mode.
- Fixed a discovered persistence issue: raw PostgreSQL `date` reads produced
  JavaScript Date objects, causing identical incoming calendar strings to appear
  changed. The repository now selects all three calendar dates as text. Both the
  persistence regression and repeated EchoShip execution cover snapshot stability.
- No new foreign key, event timestamp column, automatic fallback, retry-delay
  column, or production artifact store was introduced.

### EchoShip sessions and mapping

- Added approved pinned dependencies: `playwright@1.64.0`, `tough-cookie@6.0.2`,
  `axios-cookiejar-support@7.0.0`. Reused Axios, Zod, TypeORM and Bottleneck;
  deliberately did not attach axios-retry to EchoShip.
- Each run opens one isolated fresh session, verifies protected access, reads
  sequentially, and closes resources. Manual work uses the same policy. Initial
  auth failure fails affected attempts; mid-run rejection fails remaining lookups
  without further requests. Earlier successful outcomes survive. No immediate
  lookup retry or mid-run re-login; recovery waits for scheduled/manual work.
- Request mode owns an in-memory rotating-cookie jar and fixed-origin JSON calls.
  A total 30-second dispatch deadline supplements Axios's inactivity timeout.
  Responses are capped at 4 MiB; redirects are rejected; Basic credentials appear
  only on sign-in; cookie agents are destroyed and the jar cleared on close.
- Browser mode uses Chromium navigation and maps detail/tracking responses naturally
  received by that page. No Axios/APIRequestContext fallback or DOM-derived status.
  It preserves the configured `/login` path, ignores expected pre-login 401s,
  detects post-verification rejection, and closes queued browser API pacing.
- Request search is bounded to ten pages of 100 results. Exact identity is required;
  incomplete, inconsistent or capped searches are failures. Browser partial-page
  absence is deliberately unconfirmed. A plain HTTP 400/404 is not not-found.
- Status/detail use the authoritative tracking API's descending modifiedDate, then
  descending createdDate ordering. A live delivered-load comparison exposed and
  corrected the initial createdDate-only assumption; a red/green regression covers
  both sort keys and invalid modified dates. Browser mode now has a red/green test
  proving conflicting DOM text cannot override the API. Pickup uses pickupDate; delivered uses
  deliveryDate. The undelivered estimate prefers the Delivery stop appointmentStart,
  then deliveryByDate, excluding year-one sentinels. Never use broad-list estimates
  or perform timezone conversion. Failed required components cannot save partial data.
- Persist only the documented successful-lookup allowlist; failed/not-found evidence
  is null. No credentials, cookies, HTML, complete responses, addresses or prices
  enter logs or application storage. Exploration and smoke artifacts remain ignored.

## Files Changed

Paths are repository-relative. Generated lockfile changes are listed because they
pin the approved runtime packages. `sample.txt` is pre-existing and untouched.

| Files                                                                                                                      | Review purpose                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/infrastructure/database/migrations/1791936000000-CarrierFetchMode.ts`                                                 | Forward/rollback mode columns, constraints, and Carrier initialization.                                          |
| `src/modules/carriers/carrier-fetch-mode.ts`                                                                               | API/worker-shared mode schema and supported-mode metadata, without browser imports.                              |
| `src/modules/carriers/carrier.entity.ts`, `carriers.repository.ts`, `typeorm-carriers.repository.ts` in the same directory | Persist and return the selected mode.                                                                            |
| `src/modules/carriers/carriers.schemas.ts`, `carriers.service.ts`, `carriers.service.spec.ts`                              | Carrier PATCH validation and capability tests.                                                                   |
| `src/modules/carriers/adapters/carrier-adapter.ts`, `carrier-adapter.registry.ts`                                          | Pass the selected mode and validate capability at execution/startup.                                             |
| `src/modules/carriers/adapters/carrier-adapters.module.ts`                                                                 | Register EchoShip alongside UPS in the worker.                                                                   |
| `src/modules/tracking/tracking-run.entity.ts`, `tracking.repository.ts`, `typeorm-tracking.repository.ts`                  | Run evidence, atomic mode capture, and calendar-date read correction.                                            |
| `src/modules/tracking/tracking-executor.service.ts`, `tracking-scheduler.service.ts`                                       | Use the captured mode; revalidate enabled Carrier settings.                                                      |
| `src/modules/shipments/shipments.service.spec.ts`, `src/modules/tracking/tracking-scheduler.service.spec.ts`               | Update existing typed Carrier fixtures.                                                                          |
| `src/modules/carriers/adapters/echoship/echoship.adapter.ts`, `echoship.module.ts`                                         | Session lifecycle, mode dispatch, failure isolation and DI registration.                                         |
| `src/modules/carriers/adapters/echoship/echoship.config.ts`, `echoship.failure.ts`                                         | Lazy fixed-origin configuration and safe failure projection.                                                     |
| `src/modules/carriers/adapters/echoship/echoship.request.ts`, `echoship.browser.ts`                                        | Actual isolated request and browser transports.                                                                  |
| `src/modules/carriers/adapters/echoship/echoship.mapping.ts`, `echoship.limiter.ts`                                        | Provider validation/allowlist/calendar mapping and cross-session pacing.                                         |
| `src/modules/carriers/adapters/echoship/echoship.adapter.spec.ts`                                                          | Adapter-boundary unit coverage, including auth, no retry, dates, paging and pacing.                              |
| `test/integration/echoship-http.spec.ts`                                                                                   | Native Axios cookies, isolation, body/content/redirect limits, streaming deadline.                               |
| `test/integration/echoship-browser.spec.ts`                                                                                | Actual Chromium with intercepted portal fixtures, pre-login 401s, delayed rendering and cancellation.            |
| `test/integration/echoship-worker.spec.ts`                                                                                 | Real executor/PostgreSQL outcomes, prior-state preservation and repeated reads.                                  |
| `test/integration/tracking-worker.spec.ts`, `test/integration/tracking.spec.ts`                                            | Start-time immutable mode selection and stable calendar-date snapshots.                                          |
| `test/support/shipment-database.ts`, `test/integration/database.spec.ts`, `test/integration/schema.spec.ts`                | Register the migration, verify complete schema, CLI up/down and no drift.                                        |
| `test/integration/runtime.spec.ts`                                                                                         | EchoShip registration expectations; blank provider credentials prevent local .env leakage into process fixtures. |
| `test/e2e/carriers.spec.ts`                                                                                                | Public mode API and unsupported-mode behavior; migration fixture.                                                |
| `package.json`, `pnpm-lock.yaml`, `.env.example`, `.github/workflows/ci.yml`                                               | Exact dependencies, login/browser configuration guidance and CI Chromium installation.                           |
| `.gitignore`                                                                                                               | Ignore diagnostics, browser auth state and test artifacts.                                                       |
| `docs/v1/architecture.md`, `database-schema.md`, `decisions.md`, `tracking-behavior.md`, `tracking-source-data-policy.md`  | Reconcile approved runtime, schema, dependencies, mapping and evidence policies.                                 |
| `docs/v1/tickets/README.md`, `V1-014-echoship-adapter.md`, `V1-014-echoship-request-exploration.md`                        | Current ticket specification and historical feasibility evidence.                                                |
| This summary                                                                                                               | Verification, operational limitations, review order and proposed commits.                                        |

## Verification

| Exact command/check                                                                                           | Result                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm add --save-exact playwright@1.64.0 tough-cookie@6.0.2 axios-cookiejar-support@7.0.0`                    | Passed; explicit user approval preceded installation.                                                                                                                                                                          |
| `pnpm exec playwright install chromium`                                                                       | Passed; local platform used Playwright's Ubuntu fallback build.                                                                                                                                                                |
| `pnpm exec vitest run --project unit src/modules/carriers/carriers.service.spec.ts`                           | Passed: 28 tests after an observed red/green mode-setting test.                                                                                                                                                                |
| `pnpm exec vitest run --project unit src/modules/carriers/adapters/echoship/echoship.adapter.spec.ts`         | Earlier focused run passed 23 tests; final full unit run includes 24 EchoShip cases.                                                                                                                                           |
| `pnpm check`                                                                                                  | Passed: 193 unit tests, lint, format, typecheck and build.                                                                                                                                                                     |
| `pnpm test:integration && pnpm test:e2e`                                                                      | Passed: 96 integration and 36 e2e tests after event-order correction.                                                                                                                                                          |
| `node artifacts/echoship/v1-014/implementation-smoke.mts`                                                     | Request mode found all three supplied references; initial browser diagnostic failures were corrected. No database writes.                                                                                                      |
| `node artifacts/echoship/v1-014/implementation-smoke.mts --browser-only`                                      | Browser mode found all three supplied references using the production launcher and configured login path.                                                                                                                      |
| `node artifacts/echoship/v1-014/implementation-smoke.mts --request-only`                                      | Fresh request mode found all three, including the newly delivered sample 69372728.                                                                                                                                             |
| `node artifacts/echoship/v1-014/implementation-smoke.mts --delivered-only`                                    | Request returned authoritative `Shipment delivered`; that run's browser session had one bounded portal timeout and saved no result.                                                                                            |
| `node artifacts/echoship/v1-014/implementation-smoke.mts --browser-only --delivered-only`                     | The next fresh browser run returned the same authoritative `Shipment delivered`, detail and calendar dates, confirming both mode parity and next-run recovery.                                                                 |
| `node artifacts/echoship/v1-014/event-order-probe.mts` and `node artifacts/echoship/v1-014/panel-inspect.mts` | Confirmed modified/created ordering in the browser-loaded public bundle, and runtime `shouldUseLocationHistory: true flag: true hasData: true`. Saved only bounded public snippets and projected authorized shipment evidence. |
| Standards and Spec code review against `476055e` plus new files                                               | Passed final follow-up: zero outstanding spec findings, zero hard standards breaches and zero material judgment-call smells.                                                                                                   |
| Artifact credential/JWT scan, SHA-256 manifest, permissions, Git exclusion; `git diff --check`                | Refreshed before handoff; see the local manifest for the exact inventory.                                                                                                                                                      |

All automated Carrier I/O uses fixtures. PostgreSQL checks use disposable
containers, not the application's database. The native slow-stream regression
runs for about 30 seconds to prove a busy socket cannot evade the deadline.

The final manifest indexes 28 ignored files. Every file hash and 0600 permission
was verified; configured-credential/JWT scanning passed. Git tracks no EchoShip
artifacts. Final documentation formatting and `git diff --check` passed.

Initial full-suite failures exposed local Console Ninja output/timers, process
fixtures loading local provider credentials, and the date assertion/parser issue.
The fixture credentials are now explicitly blank; the calendar-date regression
was observed failing before the repository correction. Developer instrumentation
in `node_modules/@nestjs/core/index.js` was temporarily isolated for verification;
its original SHA-256 is `9aae7364564b9936a3ac106af064fd993c8ba5587d12c5a89fc1164d7cc8be56`
and the original file was restored with that exact SHA-256 before handoff. No
tracked dependency file contains that temporary instrumentation change.

The added pacing test initially mixed fake timers with Node's real abortable
timer promises; it now uses short real-time intervals. This was a test-harness
problem, not an approved retry or pacing-policy change. The inherited pg
concurrent-query deprecation warning remains outside this ticket.

## Review Notes

- Baseline: `476055ee2d0dd8b21b7148f7f82fbf5aaadec3b4`. Earlier working-tree edits
  to `.gitignore`, the ticket/index and exploration report belong to this task.
  Untracked `sample.txt` belongs to the user and is excluded.
- `implement-ticket`, grilling, TDD at approved adapter/API/execution seams, and
  independent Standards/Spec review shaped the work. The local ticket is the
  review specification; no external issue tracker was needed. The commit sequence
  below was created only after explicit final user approval.
- The carrier setting migration must run before deploying the updated API/worker.
  Rollback removes mode settings/history. Existing dates and tracking outcomes
  are not migrated or reinterpreted. Only disposable databases were migrated here.
- EchoShip endpoints are private portal contracts. Browser backup still depends
  on that portal backend, so it cannot rescue a backend outage. Browser absence
  is deliberately conservative when search pagination is incomplete.
- The browser body cap is checked after Chromium buffers a chunked response;
  it is not a hard browser-process memory limit. Pacing covers portal API requests,
  not static assets; low configured RPM can exceed UI response/navigation timeouts.
- Source data is minimal allowlisted evidence, not a raw audit archive. Artifact
  files remain local-only, permission-restricted and uncommitted.

## Remaining Issues

- Apply the migration to the intended application database before rollout; that
  database was not changed by this implementation.
- Chromium and OS libraries are required only when using browser mode. CI setup
  is updated, but remote CI/deployment were not run.
- Manual refresh transport/session behavior is implemented through queued runs;
  the public manual-refresh endpoint remains V1-016, as already scoped.
- FFE remains unimplemented and must remain disabled for worker startup. No
  frontend or development servers were started for this backend-only ticket.
- The browser's optional location-history panel can disagree with API status. This
  is an observed provider UI inconsistency, not a fallback source: API data remains
  authoritative by explicit decision. Diagnostic evidence remains ignored locally.

## Suggested Review Order

1. Migration, Carrier API mode validation and start-time capture.
2. Calendar-date repository correction and tracking regression.
3. EchoShip request/browser lifecycle, mapping, deadlines and limiter.
4. Fixture/live evidence and updated ticket/source-data policy.

## Approved Commits

1. `ae9d255 feat(tracking): V1-014 preserve calendar dates when reading snapshots`
   - Files/hunks: calendar-date SELECT in `typeorm-tracking.repository.ts` and
     the regression in `test/integration/tracking.spec.ts`.
   - Purpose: fix false snapshot changes independently of the new adapter.
2. `b45de1e feat(carriers): V1-014 configure and record tracking fetch mode`
   - Files: migration; shared mode metadata; Carrier entity/repository/schema/
     service/test; adapter contract/registry; tracking run entity/repository,
     executor/scheduler; typed fixtures; Carrier e2e and migration/schema/worker
     tests. Include only migration-registration hunks of runtime fixtures.
   - Purpose: one DB/API/run-evidence change without the EchoShip transport.
3. `cdd7f9c feat(echoship): V1-014 add request and browser tracking adapters`
   - Files: all nine EchoShip source/test files, three EchoShip integration tests,
     production adapter module registration, package manifest/lockfile,
     `.env.example`, CI browser installation, remaining runtime fixture changes.
   - Purpose: executable adapter, approved dependencies and regression coverage.
4. `feat(docs): V1-014 document EchoShip monitoring and evidence`
   - Files: `.gitignore`, all changed `docs/v1/` files listed above, including
     the exploration and this summary. Raw artifacts and `sample.txt` are excluded.
   - Purpose: record approved behavior, local evidence policy and verified handoff.

The fourth commit contains this summary; its resulting hash is reported in the
interactive handoff. No push, merge, tag, database migration or deployment was
performed.
