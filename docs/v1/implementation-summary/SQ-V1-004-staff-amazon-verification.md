# SQ-V1-004: staff Amazon verification

## Summary

Implemented the approved **Verify Amazon & retry** workflow locally. Authorized
staff can manually complete supported CAPTCHA/verification screens in a worker-owned
browser from a comparison dialog. Protected authentication is checked before saving
an encrypted Amazon-only session; the frontend retries the original attempt once.
The user approved the three commits below and deployment to `debian-vm`.
The persistence foundation is committed as `1e0e924`; this document records
implementation evidence before the authorized rollout.

This builds on the earlier
[session-persistence milestone](SQ-V1-004-amazon-session-recovery.md).
The user approved installed Playwright, NestJS, React/MUI, Zod and Node built-ins;
no dependencies or lockfiles changed.

## Changes Made

- The API authenticates every command and derives ownership from staff identity plus
  login session. UUIDs, command kinds, coordinates, input lengths and key choices are
  validated. Nondeleted failed Amazon attempts and start-time retry eligibility are
  required. Frames are no-store; auth and comparison availability are rechecked after
  capture. Revocation during a request cancels the recovery before returning pixels.
- The worker owns the browser behind a private mode-0600 Unix socket in a mode-0700
  directory outside the checkout. The API receives challenge pixels/status only.
  No DB schema, migrations, raw debug port, generic remote desktop, browser URL or
  script-execution endpoint was added.
- Recovery has an absolute ten-minute deadline and sixty-second authenticated-poll
  idle deadline. Only one staff login session controls Amazon at a time. Amazon
  quote/readiness/legacy sender refresh share a worker account lock; other providers
  continue. Click/text/key actions consume a frame nonce and return preparing while
  provider navigation settles. Redirect races discard the captured frame.
- Staff input is restricted to recognized challenge containers and frames. Account
  links, unsupported navigation, password/email inputs and arbitrary actions are
  rejected. Rates, shipments, labels, pickups and onboarding writes are blocked
  during recovery. A fresh protected rates bootstrap, not a redirect, proves success.
- The verified session is saved atomically with AES-256-GCM for at most twelve hours.
  Only Amazon state is retained; third-party CAPTCHA cookies/storage are discarded.
  Quote/readiness attempts read but never extend saved expiry. The dialog retries
  through the existing immutable endpoint, reports errors and cleans up on exit.

## Files Changed

Commit numbers refer to the approved split below. Shared files require feature-scoped
hunks: persistence first (1), staff access second (2). Backend module paths below are
relative to `src/modules/shipping-quotes/`; other paths are written explicitly.

| Backend file                                                            | Purpose                                                                                        | Commit |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| `amazon-session.store.ts`                                               | Private encrypted account-bound snapshots and Amazon-only filtering                            | 1      |
| `amazon-session.store.spec.ts`                                          | Encryption, permissions, expiry, tampering, account and key regressions                        | 1      |
| `amazon-session.integration.spec.ts`                                    | Fresh browser instances reuse verified state and fresh bootstrap tokens                        | 1      |
| `src/amazon-session-cli.ts`                                             | Private operator init/connect/revoke fallback                                                  | 1      |
| `amazon-quote.adapter.ts`                                               | Saved state, verification-required classification, protected verification; staff prepare entry | 1, 2   |
| `amazon-quote.adapter.spec.ts`                                          | Saved-session and verification classification regressions                                      | 1      |
| `quote-execution.repository.ts`                                         | Safe `verification_required` reason                                                            | 1      |
| `quote-executor.ts`                                                     | Preserve verification-required through bounded relogin handling                                | 1      |
| `quote-executor.spec.ts`                                                | Verification during relogin regression                                                         | 1      |
| `quote-worker.module.ts`                                                | Session-store injection, staff worker and shared Amazon lock wiring                            | 1, 2   |
| `amazon-account-access.ts`                                              | Worker-local account exclusion across quote/readiness/recovery                                 | 2      |
| `amazon-account-access.module.ts`                                       | Share the same lock with legacy sender refresh                                                 | 2      |
| `amazon-account-access.spec.ts`                                         | Exclusion lifetime and unaffected second provider                                              | 2      |
| `amazon-verification.contract.ts`                                       | Strict command/view schemas and bounded input vocabulary                                       | 2      |
| `amazon-verification.bridge.ts`                                         | Private Unix-socket HTTP transport with size/time limits                                       | 2      |
| `amazon-verification.browser.ts`                                        | Challenge-only screenshots/input, navigation guards, verified save                             | 2      |
| `amazon-verification.manager.ts`                                        | Staff ownership, account lock, deadlines, cancellation and audit outcomes                      | 2      |
| `amazon-verification.worker.ts`                                         | Opt-in worker startup/shutdown without API auth dependencies                                   | 2      |
| `amazon-verification.controller.ts`                                     | Staff API, attempt checks, auth recheck and sanitized errors                                   | 2      |
| `amazon-verification.manager.spec.ts`                                   | Ownership, expiry, cancellation, save failures and navigation settlement                       | 2      |
| `amazon-verification.integration.spec.ts`                               | Offline Chromium interaction/storage/privacy and real Unix-socket transport                    | 2      |
| `amazon-verification.controller.integration.spec.ts`                    | Real Nest HTTP guard/origin/revocation/validation behavior                                     | 2      |
| `amazon-verification.worker.integration.spec.ts`                        | Enabled worker IPC lifecycle and shared account lock                                           | 2      |
| `provider-readiness-guard.ts`                                           | Explicit challenge-submit allowlist during staff recovery only                                 | 2      |
| `quote.module.ts`                                                       | API controller and client bridge composition                                                   | 2      |
| `sender-defaults-worker.module.ts`                                      | Import shared Amazon account access                                                            | 2      |
| `sender-defaults.worker.ts`                                             | Gate historical Amazon sender-refresh logins during recovery                                   | 2      |
| `.env.example`                                                          | Session/key settings and separate opt-in API/worker socket setting                             | 1, 2   |
| `README.md`                                                             | Recovery capability, local limitations and setup links                                         | 1, 2   |
| `docs/v1/shipping-quotes.md`                                            | Approved persisted-session and staff-verification behavior                                     | 1, 2   |
| `docs/v1/frontend-handoff.md`                                           | Verification reason, strict staff API and retry contract                                       | 1, 2   |
| `docs/v1/amazon-session-recovery.md`                                    | Operator fallback plus staff steps, runtime mounts and restrictions                            | 1, 2   |
| `docs/v1/implementation-summary/SQ-V1-004-amazon-session-recovery.md`   | Historical persistence evidence; staff scope supersession note                                 | 1, 2   |
| `docs/v1/implementation-summary/SQ-V1-004-staff-amazon-verification.md` | Current evidence, review inventory, risks and commit split                                     | 2      |

Frontend paths are relative to `../grd-dashboard-fe/`. All belong to commit 3.

| Frontend file                                                      | Purpose                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `src/features/shipping-quotes/api.ts`                              | Typed verification request/response and safe error mapping           |
| `src/features/shipping-quotes/amazon-verification-dialog.tsx`      | Challenge image, human controls, polling, cancellation and one retry |
| `src/features/shipping-quotes/amazon-verification-dialog.test.tsx` | UI/control, error handling, cancellation and retry regressions       |
| `src/features/shipping-quotes/quote-progress.tsx`                  | Staff-friendly verification message/button for Amazon failures       |
| `src/features/shipping-quotes/quote-progress.test.tsx`             | Eligibility, verification action and other-provider display          |
| `src/features/shipping-quotes/pages/quote-detail-page.tsx`         | Dialog lifecycle and original attempt retry                          |
| `e2e/amazon-verification.spec.ts`                                  | Desktop/mobile browser flow and fixture screenshots                  |

## Verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed for the final backend source.
- `pnpm test`: 337 passed in the final full unit run (37 files).
- `pnpm exec vitest run --project unit src/modules/shipping-quotes/amazon-verification.manager.spec.ts src/modules/shipping-quotes/amazon-account-access.spec.ts`:
  11 passed after final navigation/input changes.
- `pnpm exec vitest run --project integration src/modules/shipping-quotes/amazon-verification.integration.spec.ts src/modules/shipping-quotes/amazon-verification.controller.integration.spec.ts src/modules/shipping-quotes/amazon-verification.worker.integration.spec.ts`:
  9 passed. Browser contexts are offline, with intercepted fixture responses and
  no real account credentials. Real HTTP/Unix sockets test transport boundaries.
- `pnpm test:container`: 6 passed in 77 seconds using disposable containers. This
  covers default opt-out runtime/image behavior; enabled private-socket behavior
  is covered separately by the worker integration test above.
- `pnpm test:cov:all`: **657 passed, 10 failed (81 files passed, 2 failed)** in
  593.43 seconds. All ten failures are the same readiness/nine execution cases
  previously reproduced on unchanged backend HEAD `850890f`; see the historical
  session milestone evidence. This full-suite snapshot was launched before the last
  worker-lifecycle/navigation regression additions. Final-source tests for those
  changes and the final full unit run are reported above. No green whole-backend
  coverage result is claimed. Log: `/tmp/grd-staff-verification-coverage.log`.
- Frontend `pnpm build`: passed, including typechecking. Existing route-generator
  circular-property and >500 kB chunk warnings remain.
- Frontend `pnpm exec vitest run src/features/shipping-quotes`: 49 passed.
- Frontend `pnpm exec playwright test e2e/amazon-verification.spec.ts`: 2 passed,
  desktop/mobile, including preparing-to-verified and one original retry. Fixture
  screenshots were visually reviewed; no horizontal overflow in the dialog.
- Frontend `pnpm typecheck`, `pnpm knip`, and `pnpm exec biome check` for the seven
  source/test paths listed above: passed. Both repositories' `git diff --check`
  passed. Final diff reviewed against the approved scope and pre-existing files.
- Local frontend `http://localhost:5173/` and backend
  `http://localhost:3013/api/v1/health/ready`: HTTP 200, left running with disposable
  PostgreSQL and simulated quote providers. Live staff CAPTCHA is not enabled in
  this fixture server.
- Actual Amazon challenge compatibility, live successful rates and VM deployment:
  not performed. Full frontend acceptance was not run; the feature browser tests,
  quote tests, build/types and changed-file checks were run.

## Review Notes

No new production dependencies. Approved custom code is limited to provider mappings,
challenge restrictions and the application ownership/lifecycle rules. Installed Zod
owns validation, Playwright owns browser/session/input/screenshot operations, NestJS
owns authenticated routing, TanStack Query owns transient UI requests, MUI owns the
UI and Node built-ins own encrypted file storage/private IPC.

The single-worker topology is required. API and worker need the same private Unix
socket mount and UID, but **only the worker** receives session/key mounts and Amazon
credentials. Staff mode needs writable worker session storage; operator-only mode
may keep worker snapshots read-only. A previous worker's stale socket requires
cleanup only after confirming that worker is stopped. The operator CLI must not run
concurrently with staff recovery because it is a separate process outside the lock.

Unsupported challenge markup, audio-only or drag-only challenges fail closed and
need operator recovery. Staff need authorized access to any OTP destination. Actual
Amazon selectors/domains remain a live rollout check; known fixtures are not proof
of every provider challenge. There is no guarantee Amazon stops asking for CAPTCHA.

The earlier separate repository changes were preserved. Remaining unrelated backend
untracked paths are `docs/v1/amazon-api-access-proposal.md`,
`docs/v1/implementation-summary/SQ-V1-010-manual-rate-card-investigation.md`, and `work/`.
Frontend shipment work present in the prior milestone is now committed by the user;
this task did not modify it.

References checked for implementation details:
[Playwright screenshots](https://playwright.dev/docs/api/class-page#page-screenshot),
[Playwright routing and redirects](https://playwright.dev/docs/network),
[Arkose iframe/domain guidance](https://developer.arkoselabs.com/docs/domain-policy).
These explain the mechanics, not verified Amazon account compatibility.

## Remaining Issues

- Combined backend gate has the existing ten quote readiness/execution failures;
  release readiness is not established by the passing feature checks.
- Deployment, private mounts/key initialization, real staff verification and a live
  returned Amazon quote still need rollout validation. None were silently performed.
- Commit and deployment approval received; live rollout evidence is reported separately.

## Suggested Review Order

1. Session store/CLI and browser authentication verification.
2. Challenge browser, manager, account lock, private transport and worker wiring.
3. Authenticated controller, frontend API/dialog and original retry binding.
4. Fixture tests, operations guide and final verification evidence.

Approved commits, in dependency order:

1. Backend: `feat(shipping-quotes): SQ-V1-004 persist verified Amazon sessions`
   — commit-1 rows/hunks above: encrypted session foundation, operator fallback,
   verification-required reason, quote/readiness restoration and persistence tests/docs.
2. Backend: `feat(shipping-quotes): SQ-V1-004 enable staff Amazon verification`
   — commit-2 rows/hunks above: private worker bridge, challenge interaction,
   access/lifetime controls, shared account exclusion, API and staff docs/tests.
3. Frontend: `feat(shipping-quotes): SQ-V1-004 add staff verification dialog`
   — the seven frontend files above: verification UI and original quote retry,
   component regressions and desktop/mobile browser coverage.

Do not stage shared files wholesale into commit 1: split persistence and staff hunks.
Use only the listed task files/hunks. The user separately authorized deployment.
