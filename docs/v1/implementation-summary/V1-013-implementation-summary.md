# V1-013 implementation summary

## Summary

Implemented the worker's real UPS adapter: OAuth, token caching, validated
tracking results, bounded HTTP retries, and shared physical-request throttling.
V1-013 is complete locally, including a successful user-authorized production UPS
lookup. No migration or deployment was performed. UI status/SSE delivery remains
in V1-016. The user approved both commits listed below. Implementation was
committed as `e6f4415`; this summary accompanies the approved documentation commit.

The original `/home/jeff/apps/shipment-monitoring/` UPS adapter, schemas, and tests
were studied before the design interview. Exact package matching, status mapping,
date precedence, and allowlisted source retention preserve its intended behavior.

## Changes Made

### Approved dependencies and configuration

The user explicitly approved exact production dependencies `axios@1.20.0`,
`axios-retry@4.5.0`, and `bottleneck@2.19.5`, installed using pnpm. Existing Zod
and Nest cache infrastructure handle validation and token storage. Direct Axios
fits the promise-based adapter contract without the additional `@nestjs/axios`
Observable wrapper. Node fetch was evaluated but would require custom retry and
response-size handling. Bottleneck supplies queueing and spacing; its older
release cadence is a maintenance tradeoff, accepted with behavior tests. A
physical-send guard additionally prevents event-loop jitter compressing requests.

Package/API facts were checked against primary sources:
[Axios](https://github.com/axios/axios),
[axios-retry](https://github.com/softonic/axios-retry),
[Bottleneck](https://github.com/SGrondin/bottleneck), and
[UPS Tracking specification](https://github.com/UPS-API/api-documentation/blob/main/Tracking-Ready.yaml).

UPS defaults to CIE. Production requires `UPS_ENVIRONMENT=production`; enabled
UPS also requires valid client ID/secret. Validation is worker-only and lazy:
API startup and disabled UPS do not require these credentials. UPS is registered
in production; enabled, unfinished EchoShip/FFE adapters still prevent startup.

### HTTP, token, and cooldown behavior

- One worker-lifetime limiter covers OAuth, tracking, every retry, and 401 replay.
  The cap is the stricter of database RPM and 10 production/5 CIE; null uses the
  environment cap. These are conservative application caps inherited from the
  original app, not a guarantee about an account's UPS quota. Requests are evenly
  spaced with concurrency one. A rate change waits at least one minute after the
  previous send; closing a session cannot reset quota or cooldown.
- Each physical request has a 15-second timeout and unique transaction ID. OAuth
  allows one transient retry; tracking allows two. Retryable conditions are
  selected network errors, HTTP 408/429/5xx. Backoff starts at 500 ms, honors valid
  Retry-After, and consumes limiter capacity. A 401 permits one token refresh and
  replay, with the same bounded transient retry budget for the replay.
- A Retry-After over 60 seconds ends the lookup immediately with retryable
  `UPS_RATE_LIMITED` and message "UPS temporarily unavailable. Tracking will retry
  later." Subsequent UPS lookups fail without HTTP until expiry; other Carriers
  continue. Actual timeouts use `UPS_TIMEOUT`. Existing worker outcomes preserve
  prior snapshots and schedule failures normally; expiry does not enqueue work.
- Tokens use the existing in-memory cache with a safety margin of min(60 seconds,
  10% of lifetime), accounting conservatively for acquisition time. Concurrent
  callers share one refresh; a late 401 for an older token cannot discard a newer
  token. Missing/corrupt cache entries reacquire. Cache-operation errors disable
  cache use for the process. Individual cancellation does not cancel another
  caller's shared refresh; worker shutdown aborts shared I/O.
- Responses must be JSON and fit 1 MiB; redirects are disabled. HTTP diagnostics
  use the existing safe structured-error projection, excluding credentials,
  bodies, raw error messages, and Axios configuration. Failure/not-found source
  data is null. No live Carrier calls occur in the automated tests.

### Validation and persistence

The generic Shipment API reference policy is unchanged; the worker rejects UPS
references outside 7–34 characters before OAuth. Only tracking HTTP 404 is
not-found. OAuth failures, empty/mismatched/duplicate packages, malformed bodies,
and invalid dates remain technical failures.

Exactly one matching package is required. Nonblank simplified status wins over
description; differing description becomes detail. Estimated delivery uses last
RDD, otherwise first SDD; delivered date uses last DEL. Pickup remains null.
Real YYYYMMDD dates become YYYY-MM-DD. Source data retains only tracking number,
allowlisted current status fields, and delivery date type/date fields, with
original strings preserved. Unknown and sibling package fields are discarded.
The existing TrackingService owns persistence; no API/schema changes were needed.

### Requested local environment migration

Created a Git-ignored, owner-only (`0600`) `.env` from the original application's
local configuration. It retains the original production UPS environment and
credentials, maps legacy `USERNAME`/`PASSWORD` to the future EchoShip names, and
copies FFE credentials with the tracking URL from its source. Secrets were never
printed or added to tracked documentation. Legacy scheduler/SQLite settings are
not consumed by this backend; UPS RPM remains database configuration. PostgreSQL
uses the example's local defaults and still needs a password, because the
original application has no PostgreSQL credentials.

## Files Changed

UPS paths below are relative to `src/modules/carriers/adapters/ups/`.

Local `.env` was also created at the user's request; it is ignored and excluded
from both approved commits.

| File                                                       | Review purpose                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`                           | Approved exact HTTP/retry/limiter dependencies.                                     |
| `.env.example`                                             | CIE default and enabled-worker credential requirements.                             |
| `src/modules/carriers/adapters/carrier-adapters.module.ts` | Register the real UPS adapter.                                                      |
| `ups.module.ts`                                            | Worker providers and replaceable HTTP transport seam.                               |
| `ups.config.ts`                                            | Lazy configuration validation and environment limits.                               |
| `ups.client.ts`                                            | Physical request limits, retries, timeout, cooldown, safe diagnostics and shutdown. |
| `ups.retry.ts`                                             | Transient conditions and Retry-After parsing.                                       |
| `ups.async.ts`                                             | Abort-aware delay and shared-work waiting.                                          |
| `ups-token.provider.ts`                                    | Namespaced cache, expiry margin, single refresh and stale-401 handling.             |
| `ups.adapter.ts`                                           | Session lifecycle, reference validation, one 401 replay and normalized outcomes.    |
| `ups.failure.ts`                                           | Safe, typed failure mapping without retained Axios secrets.                         |
| `ups.schemas.ts`                                           | Provider validation and source allowlisting.                                        |
| `ups.mapper.ts`                                            | Exact package matching, status and legacy date precedence.                          |
| `ups.adapter.spec.ts`                                      | 39 fake-clock HTTP/cache/session/privacy behavior tests.                            |
| `ups.mapper.spec.ts`                                       | 11 mapping/allowlist/malformed-response tests.                                      |
| `test/integration/ups-http.spec.ts`                        | Four native Axios tests against a loopback server.                                  |
| `test/integration/ups-worker.spec.ts`                      | Two disposable-PostgreSQL tests of real UPS registration and persisted outcomes.    |
| `test/integration/runtime.spec.ts`                         | Enabled UPS configuration failure, missing EchoShip adapter and API independence.   |
| `docs/v1/architecture.md`                                  | Production adapter registration and startup requirements.                           |
| `docs/v1/decisions.md`                                     | Approved dependencies and remaining dependency gates.                               |
| `docs/v1/tracking-behavior.md`                             | Approved retry, quota, cooldown, mapping and token semantics.                       |
| `docs/v1/tracking-source-data-policy.md`                   | Exact persisted UPS allowlist and rejected responses.                               |
| `docs/v1/tickets/V1-013-ups-adapter.md`                    | Completion status and approved cooldown/UI scope.                                   |
| This summary                                               | Review evidence, limitations and proposed commits.                                  |

## Verification

| Exact command/check                                                                                                                              | Result                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `pnpm add --save-exact axios@1.20.0 axios-retry@4.5.0 bottleneck@2.19.5`                                                                         | Passed using approved network access.                                                    |
| `pnpm exec vitest run --project unit src/modules/carriers/adapters/ups/ups.mapper.spec.ts src/modules/carriers/adapters/ups/ups.adapter.spec.ts` | Passed: 50 UPS unit tests.                                                               |
| `pnpm exec vitest run --project integration test/integration/ups-http.spec.ts`                                                                   | Passed: four native HTTP tests.                                                          |
| `pnpm check`                                                                                                                                     | Passed: formatting, zero-warning lint, typecheck, 168 unit tests in 18 files, and build. |
| `pnpm test:integration && pnpm test:e2e`                                                                                                         | Passed: 83 integration tests in nine files and 35 e2e tests in four files.               |
| Independent Standards and Spec review, including follow-up                                                                                       | No remaining actionable findings.                                                        |
| `git diff --check`                                                                                                                               | Passed during final review.                                                              |

The pre-existing Console Ninja injection in `node_modules/@nestjs/core/index.js`
added timers and initially failed a composition assertion. It was temporarily
removed for the final test runs and restored afterward, with its original SHA-256
verified: `58fda9cb037f6539e3d2c2d01566c2fdb996fbbe7b72da4c13e4de47d0b21355`.
The inherited pg concurrent-query warning remains in schema introspection.

The local `.env` was checked with the actual dotenv parser used by Nest, with
exact value comparisons against the legacy inputs and Node's parser. Compiled
UPS configuration validation passed. Compiled runtime validation reports only
the missing `DB_PASSWORD`; database connectivity was not attempted. File mode
`0600` and `git check-ignore .env` were verified. Environment validation itself
made no provider request.

The user subsequently authorized `node /tmp/grd-v1-013-live-ups.mjs`, an opt-in
smoke harness using the compiled adapter, actual Axios transport, in-memory
cache, project logger, and local credentials. On 2026-10-13 at 13:52 UTC, the
requested tracking reference ending in `5041` returned `found`, status
`Out for Delivery`, estimated delivery `2026-10-13`, and no delivered date.
OAuth and tracking both returned HTTP 200; exactly two physical calls started
six seconds apart, with no retries. The harness closed its session, client, and
cache; it made no database writes and printed no credentials or raw provider body.

Development red/green checks exposed duplicate concurrent token acquisition,
physical-send jitter, OAuth 404 misclassification, and content-type rejection.
Native Axios checks also caught that ERR_BAD_RESPONSE represents both malformed
successful bodies and HTTP failures: only absent/2xx status now maps that code to
invalid response; redirects and transient 5xx retain their own classification.
These issues were corrected before final verification.

PostgreSQL tests use disposable PostgreSQL containers with Docker/local-port
access. Provider responses and time are controlled; small real-time intervals
allow database and loopback sockets to progress. No application database or live
UPS account was used by the automated tests; the separate live smoke is described
above.

## Review Notes

- Baseline: `3372990`. Pre-existing untracked `sample.txt` is untouched and excluded.
  No migration, foreign key, frontend file, or unrelated tracked file was changed.
- Quota/cooldown are process-local and reset on worker restart. They assume the
  existing single worker and cannot coordinate other applications sharing UPS
  credentials. Cache failure increases OAuth traffic but still respects the cap.
- Short Retry-After values and physical request spacing can still occupy the
  sequential worker; the approved immediate-return behavior applies above 60
  seconds. Cancellation and timeouts bound active network work. A cold cache
  consumes an OAuth request before tracking and therefore adds limiter delay.
- Standards and Spec reviewers found import-alias and technical-diagnostic issues;
  both were fixed. Follow-up reviews reported no actionable findings, including
  the final native HTTP classification and runtime-test changes.
- `implement-ticket`, `grilling`, `implement`/`tdd`, and `code-review` supplied the
  approved workflow. All implementation/dependency decisions were confirmed
  before production changes. The user explicitly approved staging and both commits.

## Remaining Issues

- Local startup awaits PostgreSQL connection settings/password; the original
  SQLite configuration cannot supply them. The requested `.env` is created but
  not yet sufficient for backend startup.
- No incomplete V1-013 acceptance criterion remains. UI error/status/SSE delivery
  is deferred to V1-016 as agreed; this ticket persists the safe error contract.
- Remote CI, deployment, and coverage generation were not run.
  Backend-only work does not start a frontend or leave development servers running.
- Pre-existing Console Ninja test interference and the pg schema-introspection
  concurrent-query deprecation remain outside this ticket.

## Suggested Review Order

1. `ups.client.ts`, `ups.retry.ts`, `ups-token.provider.ts`: quota/retry/token rules.
2. Adapter, schemas, mapper and failure mapping: normalized outcomes and privacy.
3. Unit/integration tests, registration/configuration, and behavior documentation.

## Approved Commits

1. `feat(ups): V1-013 add OAuth tracking adapter`
   - Created as `e6f4415`. Normal pre-commit formatting/lint, typecheck, and all
     168 unit tests passed with temporary Console Ninja instrumentation isolation;
     the original local file was restored and its hash verified afterward.
   - Files: `.env.example`, `package.json`, `pnpm-lock.yaml`, the adapter registry
     module, all 12 UPS source/test files, and the three integration test files
     listed above.
   - Purpose: one executable adapter with approved dependencies and regression
     coverage.
2. `feat(docs): V1-013 record UPS behavior and verification`
   - Files: the architecture, decisions, tracking behavior, source-data policy,
     ticket, and implementation-summary Markdown files listed above.
   - Purpose: record approved behavior, operational scope, and verification.

The user explicitly approved both commits. No push, merge, tag, or deployment is
included in this handoff.
