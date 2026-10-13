# V1-015 implementation summary

## Summary

Implemented FFE tracking in request and browser modes, following V1-014's
database-selected transport and isolated run/session contracts. Both modes use
per-reference JSON rather than downloading account XML. Implementation is complete
and verified. The user subsequently approved the three local commits listed below;
deployment remains outside this task.

## Changes Made

### Transport and lifecycle

- Request is the default after `FfeRequestMode1792022400000`; browser remains an
  explicit Carrier API choice. Run mode capture is unchanged. Down restores FFE
  to browser without rewriting history. No application database migration was run.
- One fresh login per run, then sequential references. No immediate retries,
  mid-run re-login, native multi-reference request, or automatic transport fallback.
- Request mode uses the existing Axios/cookie-jar stack and approved
  `cheerio@1.2.0` for form-token and protected-page parsing. Chromium mode uses
  actual login/archive/search interactions and their naturally received JSON;
  no Axios, scripted fetch, DOM tracking-field mapper, or XML fallback.
- Shared worker-lifetime Bottleneck pacing is extracted from EchoShip without
  changing its behavior. FFE keeps a five-minute minimum polling interval.
- Physical I/O has a 30-second deadline; responses are limited to 4 MiB before
  parsing/persistence. Chromium buffers bodies, so this is not a process memory cap.
  Chromium request-stage interception protects each redirect hop; physical
  deadlines exclude RPM queue time. Optional external requests are blocked without
  invalidating first-party tracking. A timed-out page is replaced inside the same
  authenticated context for the next reference; the timed-out reference is not retried.
- Authentication failures invalidate the rest of the session without additional
  lookup I/O. A successful HTTP 200/empty JSON response alone never proves absence.
  Cancellation and shutdown close browsers, cookies, and pending work.

### Mapping and monitoring

- Search the one-year archive. Request absence requires complete coverage within
  ten 100-row pages. Browser absence requires complete observed results; partial
  coverage fails safely rather than advancing the not-found counter.
- Compare exact references, preserving case and leading zeros. No reliable update
  timestamp was established; use the first exact record in response order. Do not
  infer freshness from delivery/appointment dates or vehicle location timestamps.
- Pickup: valid actual `pickupDate`, then `apptPickupDate`. Store both raw values.
  Estimate: `apptDeliveryDate`, then `schedDeliveryDate`, then `requestedDeliveryDate`.
  Invalid optional dates fall through; year-one sentinels are absent. Calendar
  dates are not converted across timezones.
- Complete monitoring only for case-insensitive Delivered status plus valid
  `deliveryDate`. Delivered without a date stays active. Shared persistence retains
  previous known values when the new normalized value is null.
- Successful source evidence contains exactly eight selected fields:
  `orderNumber`, `shipmentStatus`, `pickupDate`, `apptPickupDate`,
  `apptDeliveryDate`, `schedDeliveryDate`, `requestedDeliveryDate`, `deliveryDate`.
  Failure/absence stores null; no addresses, account data, cookies, HTML, or full JSON.
- The user's monitoring-stop notification decision is recorded in V1-016 only.
  This ticket does not implement notification delivery.

## Files Changed

Paths below are relative to the repository root. All named changes belong to this
task; the pre-existing untracked `sample.txt` is untouched.

| Files                                                                                       | Review purpose                                                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/modules/carriers/adapters/ffe/ffe.adapter.ts`, `ffe.module.ts`                         | Lifecycle, configuration injection, transport dispatch and safe result boundary.                           |
| `src/modules/carriers/adapters/ffe/ffe.config.ts`, `ffe.failure.ts`                         | Pinned origin/environment validation and sanitized failure codes/messages.                                 |
| `src/modules/carriers/adapters/ffe/ffe.protocol.ts`, `ffe.mapping.ts`                       | DataTables contract, bounded envelope and approved normalized/source projection.                           |
| `src/modules/carriers/adapters/ffe/ffe.request.ts`                                          | Fresh cookie/form login and bounded sequential JSON search.                                                |
| `src/modules/carriers/adapters/ffe/ffe.browser.ts`, `ffe.browser-network.ts`                | Real UI workflow, Chromium redirect protection, pacing/deadlines and page recovery.                        |
| `src/modules/carriers/adapters/ffe/ffe.adapter.spec.ts`, `ffe.mapping.spec.ts`              | Configuration/session and date/privacy mapping regressions.                                                |
| `src/modules/carriers/adapters/carrier-request-limiter.ts`, `echoship/echoship.limiter.ts`  | Reuse existing pacing through a compatibility export.                                                      |
| `src/modules/carriers/adapters/carrier-adapters.module.ts`                                  | Register FFE alongside UPS and EchoShip.                                                                   |
| `src/modules/carriers/carrier-fetch-mode.ts`, `carriers.service.spec.ts`                    | Accept both FFE modes and verify service behavior.                                                         |
| `src/infrastructure/database/migrations/1792022400000-FfeRequestMode.ts`                    | Reversible FFE request default; no new foreign keys or run-history edits.                                  |
| `test/integration/ffe-http.spec.ts`                                                         | Real Axios sockets, cookies, pagination, errors, bounds, cancellation and deadlines.                       |
| `test/integration/ffe-browser.spec.ts`, `ffe-browser-network.spec.ts`                       | Real Chromium UI, response correlation, auth expiry, redirects, low RPM, deadlines and recovery.           |
| `test/integration/ffe-worker.spec.ts`                                                       | Real executor/PostgreSQL outcomes, failure isolation, unchanged snapshots, retained pickup and completion. |
| `test/integration/database.spec.ts`, `runtime.spec.ts`, `test/support/shipment-database.ts` | Register migration, verify rollback/history, and isolate runtime fixture credentials.                      |
| `test/e2e/carriers.spec.ts`                                                                 | Request default and explicit switching in both directions through the API.                                 |
| `package.json`, `pnpm-lock.yaml`, `.env.example`                                            | Approved Cheerio dependency and FFE configuration guidance.                                                |
| `docs/v1/architecture.md`, `database-schema.md`, `decisions.md`, `folder-structure.md`      | Reconcile implemented architecture, mode, dependencies and file layout.                                    |
| `docs/v1/tracking-behavior.md`, `tracking-source-data-policy.md`                            | Approved JSON mapping, monitoring and minimal evidence policy.                                             |
| `docs/v1/tickets/README.md`, `V1-015-ffe-adapter.md`, `V1-015-ffe-request-exploration.md`   | Ticket index, final specification and discovery evidence like V1-014.                                      |
| `docs/v1/tickets/V1-016-refresh-events-and-notifications.md`                                | Separately scoped future monitoring-stop notifications.                                                    |
| `docs/v1/implementation-summary/V1-015-implementation-summary.md`                           | This verification and review handoff.                                                                      |

## Verification

| Command                                                                                                                        | Result                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                                                                   | Passed formatting, lint, TypeScript, 209 unit tests in 21 files, and build.                                                                                                                     |
| `pnpm test:integration`                                                                                                        | Passed 126 tests in 16 files against real Chromium/native HTTP and disposable PostgreSQL.                                                                                                       |
| `pnpm test:e2e`                                                                                                                | Passed 37 tests in four files, including FFE's default and mode switching.                                                                                                                      |
| `pnpm exec vitest run --project integration test/integration/ffe-browser-network.spec.ts test/integration/ffe-browser.spec.ts` | Passed 12 tests at the network-hardening checkpoint, including real one-RPM redirect pacing. The final suite includes the additional timeout-recovery case.                                     |
| `node artifacts/ffe/v1-015/implementation-smoke.mts`                                                                           | Read-only production-adapter smoke: three authorized references found in each mode, with identical normalized/source projections and no database writes.                                        |
| `node artifacts/ffe/v1-015/audit.mts`                                                                                          | Thirteen private artifacts hashed and restricted to 0600 (directory 0700); configured-credential/JWT/public-key scans and cross-mode comparison passed. Artifacts remain ignored and untracked. |
| Final `git diff --check`, changed-file configured-credential scan                                                              | Passed; 39 requested files reviewed, excluding untouched `sample.txt`.                                                                                                                          |

The final focused command
`pnpm exec vitest run --project integration test/integration/ffe-browser.spec.ts`
passed all seven browser cases after the last recovery guard. A final
`pnpm format:check && pnpm lint && pnpm typecheck && git diff --check` also passed.
The final live smoke was repeated against the built adapter after the suites and
again found all six results; the artifact audit was refreshed afterward.

The final main checks ran sequentially as
`pnpm check && pnpm test:integration && pnpm test:e2e`, preventing build interference.
Live diagnostics are opt-in, not CI; ordinary tests never use live credentials.
No application database migration, production worker polling, frontend server,
notification delivery, or deployment was run. API/worker startup is covered by
disposable runtime fixtures. The suite still emits an existing PostgreSQL client
concurrent-query deprecation warning; it does not fail the current pinned pg version.

Development checks established red/green behavior for request-mode support and
archive-toggle expiry; regression coverage also includes whitespace-wrapped year-one dates. Real-socket fixtures
exercise cookie rotation, unauthorized empty responses, 4 MiB bounds, streaming
deadlines, and blocked cross-origin 307/308 credential forwarding.

An initial full integration run had seven failures unrelated to FFE mapping:
three migration CLI failures during an overlapping rebuild of `dist/`, and four
runtime JSON-output failures caused by local Console Ninja instrumentation.
Verification was rerun without overlapping builds and with that local hook
temporarily isolated. Its original SHA-256 is
`d4079bc43937cca2385359f3419c39ae1d210e83feee41f0fca13caa568e1d3f`.
The original file was restored and its SHA-256 matched exactly before handoff;
no tracked dependency edit is included.
An intermediate timeout-recovery regression also exposed an asynchronous page-close
race, corrected by awaiting closure before returning or opening the replacement page.

## Review Notes

### Standards

Independent standards review found no documented-standard violations. It also
identified a whitespace/year-one mapping edge case, which was corrected and tested.

### Spec

Independent spec review identified redirect-hop origin protection, archive-toggle
expiry classification, combined physical deadlines, low-RPM queue waits, and
timeout recovery. These were addressed with Chromium interception, guarded
authentication checks, queue-aware waits and same-context page recovery tests.
Final follow-up reviews found no remaining material standards or spec findings.
The non-blocking body-timeout reason-code edge was also corrected by avoiding
authentication rechecks while a timed-out page is closing.

### Operational boundaries

FFE's endpoint is an observed authenticated portal API, not a promised public API;
markup or contract changes can require adapter updates. One-year absence is not
proof of absence in older history. Browser mode needs Chromium and OS libraries;
request mode does not launch a browser. There is no automatic mode fallback.

Run the new migration during the normal deployment workflow. It intentionally
sets every FFE row to request, including an operator's prior browser selection;
operators can select browser afterward. Down deterministically restores browser,
not an arbitrary prior value. No production migration, deployment, notification,
push, or merge was performed by this task. Local commits were separately approved
after the implementation handoff.

## Remaining Issues

No outstanding V1-015 implementation blocker. Monitoring-stop notifications remain
the approved V1-016 follow-up. The new migration is verified but has not been applied
to the application's database. Local Console Ninja instrumentation must be disabled
or isolated to reproduce clean JSON-output runtime tests; it is restored unchanged
in this workspace. Provider-internal API stability and one-year coverage remain
the documented operational boundaries, not guarantees of older shipment retrieval.

## Suggested Review Order

1. Ticket and discovery report; mapping/protocol and source-data policy.
2. Request/browser/network modules with fixture tests.
3. Migration/mode registration and PostgreSQL/API tests.
4. Runtime/dependency/documentation changes and this verification record.

### Approved commit plan

1. `feat(ffe): V1-015 add request and browser tracking` — production source,
   dependency/configuration changes, migration and all related unit/integration/API
   tests listed above. One functional feature with its safety and persistence tests.
2. `feat(docs): V1-015 document FFE discovery and implementation` — all V1-015 and
   shared documentation listed above, excluding the V1-016 ticket.
3. `feat(notifications): V1-016 specify monitoring-stop alerts` — only the V1-016
   ticket's approved completion/automatic-pause notification requirements.

The user approved this plan after reviewing the implementation handoff. Exclude
`sample.txt` and ignored diagnostic artifacts. Commit hashes are reported in the
commit handoff; pushing, merging and applying the migration are not authorized.
