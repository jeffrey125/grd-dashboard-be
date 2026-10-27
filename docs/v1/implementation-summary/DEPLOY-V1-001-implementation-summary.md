# DEPLOY-V1-001: App Platform preparation

## Summary

Prepared backend CI/CD and deployment configuration for the approved DigitalOcean
App Platform target. Live deployment remains disabled; no production writes,
credential changes, DNS changes, commits or releases were performed.

## Changes Made

- Reused Tom's quality/secret gates, immutable backend image releases, serialized
  deploys, superseded-revision handling and public smoke verification.
- Pinned official Actions to commit hashes; retained Node/pnpm and installed test
  libraries. No package or lockfile change, new production dependency or custom
  replacement for reusable application functionality.
- Added one API, one worker, a PRE_DEPLOY TypeORM job, existing managed database
  binding, TLS CA materialization and tracking-only production configuration.
- Repaired release-test assumptions: discover the migration count from source;
  enable quotes explicitly in shared feature integration fixtures, while leaving
  production defaults and explicit disabled-mode tests unchanged.

## Files Changed

| File                                | Purpose                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `.gitleaksignore`                   | Exact historical prose false positive; no broad rule suppression.                                   |
| `.github/workflows/ci.yml`          | Combined quality/container/secret gates, GHCR publish, disabled-by-default App Platform deployment. |
| `.do/app.yaml`                      | API/worker/migration topology, domains, database bindings and runtime settings.                     |
| `scripts/check-app-platform.sh`     | Public readiness, quote flag and authentication-boundary smoke checks.                              |
| `test/container/runtime.test.ts`    | Replace stale migration count with discovery.                                                       |
| `test/support/shipment-database.ts` | Explicit quote-enabled integration fixture configuration.                                           |
| `README.md`                         | Link to current deployment preparation.                                                             |
| `docs/v1/release-readiness.md`      | Distinguish historical hosting deferral from this later approval.                                   |
| `docs/v1/app-platform.md`           | Settings, migration procedure, rollout blockers and recovery boundaries.                            |
| This summary                        | Review and verification evidence.                                                                   |

Backend worktree was clean at start. The frontend's pre-existing
`e2e-backend/tracking-review.spec.ts` edit was not changed or included in this work.

## Verification

- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test:container`: passed, 6 tests; all 18 migrations apply/revert/reapply,
  non-root Chromium launches and the idle worker stops cleanly.
- `pnpm test:cov:all`: passed, 673 tests / 87 files in 739.56 seconds;
  combined coverage: 90.50% lines, 78.88% branches, 88.95% statements,
  91.98% functions. Two pg concurrent-query deprecation warnings were emitted;
  they did not fail tests and no pg upgrade is part of this change.
- `doctl apps spec validate --schema-only /tmp/grd-be-spec.json`: passed with a
  disposable digest and no registry credential. Schema validation is not live
  account, capacity or connectivity verification.
- `actionlint -shellcheck=` on both workflows: passed. External ShellCheck was
  unavailable; `bash -n` passed for both smoke scripts.
- Local HTTP fixture checks: healthy backend accepted; quotes unexpectedly
  enabled and unauthenticated access unexpectedly allowed were both rejected.
- Topology assertions: single API/worker, shared digest, PRE_DEPLOY migration,
  intended database/user, disabled quotes and explicit deployment gates passed.
- Checksum-pinned Gitleaks 8.30.1 history scan: passed (107 commits). One
  historical English-prose false positive is exempted by exact fingerprint.
- `git diff --check`: passed.
- Isolated manual API is reachable at `http://localhost:3017/api/v1`; readiness
  returns 200 and quote comparison is false. Frontend is reachable at
  `http://localhost:4176`. No tracking worker or live carrier calls are enabled.
- Remote CI, App Platform deployment, production database restore, provider calls,
  image/OS security scan and actual-domain browser acceptance were not performed.

## Review Notes

The new workflows cannot deploy until the repository enable variable is set and
all prerequisites pass. Backend images can publish on main before deployment is
enabled. The official deploy action can create/update an app by its spec name;
confirm the intended project/account and names before enabling it.

The shared cluster, user and database were observed in the browser, not tested
through a production SQL connection. Sizes in the spec are provisional; they are
not a capacity guarantee or authorization to provision paid resources.

## Remaining Issues

Public client-IP handling, worker replacement without overlap, browser child
cleanup/worker monitoring, source/destination inspection and migration rehearsal,
shared-cluster capacity, GitHub/DO settings, DNS/TLS and external acceptance remain
explicit rollout blockers. See the deployment guide for the exact sequence.

## Suggested Review Order

1. `docs/v1/app-platform.md` and `.do/app.yaml`.
2. `.github/workflows/ci.yml` and `scripts/check-app-platform.sh`.
3. Fixture changes and verification evidence.

Proposed commits, pending explicit approval:

- `test(release): DEPLOY-V1-001 repair migration and quote fixture gates`
  — `test/container/runtime.test.ts`, `test/support/shipment-database.ts`.
- `ci(deploy): DEPLOY-V1-001 prepare backend App Platform delivery`
  — workflow, spec, smoke script, scanner exception, README, release audit, deployment guide and this summary.
