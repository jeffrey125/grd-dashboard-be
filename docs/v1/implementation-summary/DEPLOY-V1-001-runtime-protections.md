# DEPLOY-V1-001: App Platform runtime protections

## Summary

Adapt existing login IP throttling to App Platform ingress and serialize worker
processes against the same PostgreSQL database before background work starts.
No deployment, live data migration, production dependency, or schema change.

## Changes Made

- `AUTH_TRUST_PROXY=digitalocean` uses one validated `do-connecting-ip` for login
  IP counters. Missing/malformed/list/scoped headers return 400 before sign-in.
  Nest's installed tracker normalizes IPs and groups IPv6 by /64. Email/password
  limits remain unchanged. Express trust stays false for this mode.
- A dedicated `pg` connection owns a two-integer, database-local advisory lock
  before the worker creates its Nest context. Contenders wait without starting
  tracking recovery, provider work, or quote lifecycle timers.
- Ownership stays held throughout graceful shutdown until process exit. The
  entrypoint has a 40-second shutdown deadline, detects lock connection loss or
  failed heartbeats, and exits nonzero on scheduler failure. API composition is
  unchanged and never competes for worker ownership.
- Existing `pg`, Nest throttler, Node IP validation, and PostgreSQL locking were
  approved. Only `@types/pg` was added, as a development dependency. No custom IP
  parser, lock table, lease arithmetic, or distributed-lock package was added.

## Files Changed

- `src/modules/auth/auth.config.ts`, `auth-throttler.guard.ts`, `auth.module.ts`:
  opt-in trust mode, validated tracker, and guard wiring.
- `test/e2e/auth-client-ip.spec.ts`: real Nest guard/storage HTTP assertions with
  only credential verification mocked.
- `.do/app.yaml`, `.env.example`, `docs/v1/auth-api.md`: deployment setting and
  operator/API contract.
- `src/infrastructure/database/worker-ownership.ts` and its `.spec.ts`: dedicated
  session lock, heartbeat, and failure handling.
- `src/worker.ts`: ownership-before-initialization, shutdown and failure exits.
- `test/integration/runtime.spec.ts`: preserve shutdown-hook/log assertions while
  checking clean worker exit and ownership failure before application pool startup.
- `test/integration/worker-ownership.spec.ts`: disposable PostgreSQL contention,
  cancellation, termination and real compiled worker process handover.
- `package.json`, `pnpm-lock.yaml`: PostgreSQL client development types.
- `README.md`, `docs/v1/app-platform.md`, `docs/v1/release-readiness.md`, this file:
  operation, verification, and limitations.

## Verification

- Focused PostgreSQL ownership suite: 4 tests passed, including real worker
  processes, graceful SIGTERM handover, cancelled standby, lost ownership, and scheduler-failure termination.
- Focused auth configuration, ownership failure, and proxy HTTP suites: 8 tests
  passed. Initial HTTP test used the wrong health path; corrected to the actual
  `/api/v1/health/live`, then all passed.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and
  `git diff --check`: passed.
- `doctl apps spec validate .do/app.yaml --schema-only`: passed (not remote
  permission, capacity, or ingress acceptance evidence).
- `pnpm test:container`: final rerun passed all 6 tests (118.4 seconds), covering
  migration/API health, non-root Chromium, missing carrier credential rejection,
  idle worker lifecycle, and all 18 migrations reverting/reapplying. The first
  attempt failed in its migration container; its underlying error was not
  retained by the harness. A separate disposable reproduction and the complete
  rerun both passed without a runtime code change; original cause unconfirmed.
- Final `pnpm exec vitest run --project integration test/integration/runtime.spec.ts
test/integration/worker-ownership.spec.ts`: all 23 tests passed (49.0 seconds).
- `pnpm test:cov:all --reporter=verbose`: final run passed all 684 tests across
  90 files (684.96 seconds). Combined coverage: 90.56% lines, 89.03% statements,
  78.97% branches, 92.06% functions. Initial run exposed old worker
  signal/retry assertions and a duplicate shutdown log. The worker now preserves
  exactly one Nest shutdown event; runtime assertions cover its clean exit and
  early ownership connection failure, while API behavior remains unchanged.
  A subsequent run passed 662 tests but skipped 22 carrier HTTP tests after a
  disposable migration COMMIT query timeout. Those 22 passed alone; the final
  complete run passed without concurrent container builds and without another
  runtime change. This is evidence of recovery, not a proven timeout root cause.
  The existing two pg concurrent-query deprecation warnings remain.

## Review Notes

The working tree was clean before this task. All listed changes belong to these
protections. `.env.production` remains ignored and mode 0600; no secret values
were added to tracked files. Repository deployment enablement remains unset.

The lock is session-owned, not pooled, and requires the direct database endpoint.
Each waiting or active worker consumes one additional database connection. The
worker entrypoint retains the session until OS exit instead of releasing it
before bounded shutdown hooks have finished. Process-fatal loss handling avoids
continuing work or silently reconnecting after losing ownership.

This is cooperative ownership, not fencing or exactly-once external requests.
Network partitions or a stalled event loop can delay loss detection; heartbeat
interval is 2 seconds and query timeout is 5 seconds. Carrier requests already
sent cannot be recalled. Other worker entrypoints and old LAN images do not
participate and must not run against the destination during cutover.

The DigitalOcean mode trusts managed ingress; direct access to the API container
would permit forged ingress headers. Keep that route unavailable and verify
header replacement through the actual platform. The false/loopback modes retain
existing behavior. Proxy tests prove ignored X-Forwarded-For, per-visitor limits,
invalid header rejection, IPv6 grouping and default-mode header distrust; they do
not simulate DigitalOcean's network edge.

Primary references:

- [DigitalOcean client IP header](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/)
- [Nest rate limiting](https://docs.nestjs.com/security/rate-limiting)
- [PostgreSQL advisory locks](https://www.postgresql.org/docs/18/functions-admin.html)
- [node-postgres client lifecycle](https://node-postgres.com/apis/client)

Approved commit split:

- `fix(auth): DEPLOY-V1-001 handle App Platform client IPs` — auth config/guard/
  module, proxy HTTP tests, `.do/app.yaml`, `.env.example`, auth API documentation,
  and the auth-specific README/App Platform guide changes.
- `fix(worker): DEPLOY-V1-001 serialize worker processes with PostgreSQL` —
  ownership implementation/unit tests, worker entrypoint, ownership/runtime
  integration tests, development types/lockfile, remaining runtime documentation
  and this implementation summary.

## Remaining Issues

Actual App Platform ingress behavior, worker replacement/restart and browser
cleanup under the platform must be accepted before public rollout. Database
capacity, final cutover, DNS/TLS and live authenticated/provider acceptance remain
separate gates in the deployment guide. Deployment stays disabled.

## Suggested Review Order

1. Auth config/guard and HTTP tests, followed by the App Platform setting.
2. Ownership class and compiled worker entrypoint, followed by failure and
   PostgreSQL/process tests.
3. Runtime guide, dependency lockfile, and verification evidence.
