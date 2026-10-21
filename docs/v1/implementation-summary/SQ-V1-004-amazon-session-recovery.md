# SQ-V1-004 follow-up: persistent Amazon session recovery

## Summary

Implemented the approved temporary request-based workaround: an SSH operator
completes Amazon verification, saves encrypted authentication state, and the worker
restores it across browser/container restarts. The dashboard explains when an admin
must reconnect. No commit or deployment has been performed.

## Changes Made

- Reused installed Playwright and Zod plus approved Node crypto/filesystem APIs.
  No dependency, lockfile, API route, database schema or migration change.
- Opt-in session directory/key file; AES-256-GCM, account binding, private permissions,
  atomic writes, fixed 12-hour expiry, explicit revocation, and no worker writes.
- Operator `init/connect/revoke` CLI with loopback Chromium debugging through SSH,
  manual CAPTCHA/MFA, a 15-minute recovery deadline, and read-only calculator
  verification before save. No rate/purchase/label request from verification.
- Saved-session quote/readiness adapters restore state, obtain fresh request tokens,
  and never fall back to password login. `verification_required` uses existing
  `failed` outcome and does not trigger automatic relogin, including a challenge
  encountered during the legacy bounded relogin. Other providers continue normally.
- Session-enabled readiness checks the calculator/bootstrap without depending on
  obsolete onboarding draft addresses. Existing generic readiness summaries remain.

## Files Changed

Backend paths are relative to `grd-dashboard-be`; frontend paths to its sibling.

| File                                                                  | Reason                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/modules/shipping-quotes/amazon-session.store.ts`                 | Account-bound encrypted snapshot storage, validation, expiry and revocation.                         |
| `src/modules/shipping-quotes/amazon-session.store.spec.ts`            | Restarts, permissions, tampering, account/key mismatch, expiry, revocation and opt-in configuration. |
| `src/amazon-session-cli.ts`                                           | SSH operator login/verification and lifecycle commands.                                              |
| `src/modules/shipping-quotes/amazon-quote.adapter.ts`                 | Restore state, refresh request context, classify challenges, verify manual login/readiness.          |
| `src/modules/shipping-quotes/amazon-quote.adapter.spec.ts`            | Session reuse, missing/rejected state and no challenge retry.                                        |
| `src/modules/shipping-quotes/amazon-session.integration.spec.ts`      | Real Chromium fixture for verify/save/restart/quote/readiness/challenge/revoke.                      |
| `src/modules/shipping-quotes/quote-execution.repository.ts`           | Add the safe verification reason.                                                                    |
| `src/modules/shipping-quotes/quote-executor.ts`                       | Preserve verification reason if a bounded relogin encounters a challenge.                            |
| `src/modules/shipping-quotes/quote-executor.spec.ts`                  | Regression for a challenge during relogin.                                                           |
| `src/modules/shipping-quotes/quote-worker.module.ts`                  | Wire optional encrypted storage into Amazon rate/readiness adapters.                                 |
| `.env.example`                                                        | Document optional worker/CLI session configuration.                                                  |
| `README.md`                                                           | Discoverable operator guide and session behavior.                                                    |
| `docs/v1/shipping-quotes.md`                                          | Record the approved persistence exception and challenge behavior.                                    |
| `docs/v1/frontend-handoff.md`                                         | Safe reason contract, retry instructions and readiness limits.                                       |
| `docs/v1/amazon-session-recovery.md`                                  | Exact host preparation, SSH tunnel, browser inspection, save/revoke and troubleshooting steps.       |
| `docs/v1/implementation-summary/SQ-V1-004-amazon-session-recovery.md` | Review evidence and commit boundaries.                                                               |
| FE `src/features/shipping-quotes/quote-progress.tsx`                  | Staff-facing Amazon reconnection instructions.                                                       |
| FE `src/features/shipping-quotes/quote-progress.test.tsx`             | Visible recovery instructions with another provider still represented.                               |

## Verification

- Regression first: `pnpm test src/modules/shipping-quotes/amazon-quote.adapter.spec.ts`
  initially failed on the exact defect: `authentication_failed`, one relogin instead
  of `verification_required`, zero relogins. After implementation it passes.
- `pnpm test src/modules/shipping-quotes/amazon-session.store.spec.ts src/modules/shipping-quotes/amazon-quote.adapter.spec.ts src/modules/shipping-quotes/quote-executor.spec.ts`:
  **25 passed**.
- `pnpm exec vitest run --project unit`: **326 passed**. Initial sandbox run of
  `pnpm test` had three notification fixture failures from `listen EPERM`; the
  unrestricted local-socket rerun passed all tests.
- `pnpm exec vitest run --project integration src/modules/shipping-quotes/amazon-session.integration.spec.ts`:
  **1 passed**, real Chromium with every request intercepted; no Amazon credentials.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: **passed**. An initial integration
  fixture literal-type error was corrected before the final successful typecheck.
- `pnpm exec prettier --check` on all changed/new TypeScript files and
  `git diff --check` in both repositories: **passed**.
- `pnpm test:container`: **6 passed**, including production-only runtime/Chromium,
  migrations, worker startup/shutdown and local Compose cleanup.
- Compiled CLI smoke via Node subprocesses: `init` succeeds, repeated `init` refuses
  key replacement, `revoke` succeeds, invalid command exits nonzero.
- Local Chromium CDP fixture: remote input reached the same page; screencast frame
  received; socket inspection confirmed only `127.0.0.1:19222` listened. Browser closed.
- FE `pnpm exec biome check --write src/features/shipping-quotes/quote-progress.tsx src/features/shipping-quotes/quote-progress.test.tsx`,
  `pnpm test src/features/shipping-quotes/quote-progress.test.tsx` (**11 passed**),
  `pnpm typecheck`, `pnpm build`: **passed**. Build reports its existing route-tool
  circular-property and large-bundle warnings.
- `pnpm test:cov:all`: **639 passed, 10 failed (77 files passed, 2 failed)**;
  no successful whole-backend coverage result is claimed. Failures are in
  `test/integration/quote-readiness.spec.ts` and nine cases in
  `test/integration/quote-execution.spec.ts`.
  The focused readiness rerun failed identically. Isolated archives of unchanged HEAD
  `850890f` built and reproduced the readiness failure (`['running','failed']` versus
  two running attempts) and all nine quote-execution failures (eight other cases passed).
  These failures predate the requested changes; this is not a clean whole-backend gate.
- Local frontend `http://localhost:5173/` and backend
  `http://localhost:3013/api/v1/health/ready`: **HTTP 200**, left running with disposable
  PostgreSQL and simulated quote providers. No live provider/tracking worker enabled.
- Live Amazon CAPTCHA completion, saved production session, live dashboard quote,
  and VM deployment **not performed**. No claim of successful live Amazon rates.

## Review Notes

The saved state expires after 12 hours even if read repeatedly; Amazon may challenge
sooner. Persistence reduces repeated login but cannot guarantee no further CAPTCHA.
The configured account email binds encryption; the operator must actually sign into
that account. Worker mounts should be read-only and survive container replacement.
Only the operator writes snapshots, avoiding stale in-flight workers overwriting
new credentials. Revocation does not cancel a quote already running in memory.

The debug port grants browser control: it must remain loopback-only and reachable
through trusted SSH access. The operator browser exits after save/quit/interrupt or
its deadline. No stored secrets enter Git, the database, frontend, logs or build
context. Existing account-default refresh still uses its separate legacy login flow.
Session-enabled readiness retains generic failure summaries; quote attempts expose
the specific reconnection reason. No CAPTCHA solver or bypass was added.

Pre-existing changes were preserved: BE `docs/v1/amazon-api-access-proposal.md`,
`docs/v1/implementation-summary/SQ-V1-010-manual-rate-card-investigation.md`, `work/`;
FE `e2e/shipments.spec.ts`, `e2e/tracking-review.spec.ts`,
`src/features/shipments/pages/shipments-page.tsx`, `src/features/shipments/shipment-grid.tsx`,
and its untracked `FE-V1-006-tab-transition-stability-follow-up.md` summary.

## Remaining Issues

- Full-suite worker-readiness and nine quote-execution failures reproduced on unchanged
  HEAD; not fixed in this task.
- VM configuration/mounts, deployment, operator verification and live Amazon rate
  validation remain. Actual API entitlement is outside this temporary workaround.
- Commit approval pending. No live browser/session credentials were saved by these tests.

## Suggested Review Order

1. Session store and its tests, then operator CLI/recovery guide.
2. Adapter, executor, worker wiring and browser integration regression.
3. Frontend message/test and contract documentation.

Proposed independently reviewable commits (stage only the listed task files):

1. Backend: `feat(shipping-quotes): SQ-V1-004 persist verified Amazon sessions`
   — all backend files in the manifest above, including this summary; excludes
   all pre-existing untracked files.
2. Frontend: `fix(shipping-quotes): SQ-V1-004 explain Amazon reconnection`
   — only `quote-progress.tsx` and `quote-progress.test.tsx`; excludes shipment work.

Explicit final approval is required before staging/committing. Deployment remains
a separate action after release preparation and live verification arrangements.
