# SQ-V1-003 baseline test fixes

## Summary

Resolve the eight pre-existing backend failures reported during SQ-V1-003
verification. This follow-up uses the installed Vitest and Node capabilities;
no dependency, application behavior, schema, or lockfile change is required.

## Changes Made

- Update the exact Shipment response expectations for the existing Sales Rep,
  follow-up and public employee attribution fields. Retain the private-field
  exclusion assertion.
- Accept the supported delivery-date and undelivered filters. Reject malformed
  dates, reversed ranges and invalid boolean values.
- Disable automatic Console Ninja Nest instrumentation in this workspace and
  remove its existing hook from the local, ignored Nest dependency entry point.
  Keep strict JSON log parsing and original signal termination assertions.

## Files Changed

- `test/e2e/shipments.spec.ts`: current response and query contracts.
- `.vscode/settings.json`: prevent automatic Nest dependency instrumentation.
- This summary: verification evidence. The separate, uncommitted
  `SQ-V1-003-implementation-summary.md` is also updated for the implementation handoff.
- Local ignored `node_modules/@nestjs/core/index.js`: remove the injected hook.
  The original is backed up at `/tmp/grd-sq003-nest-index-with-console-ninja.js`
  with SHA-256 `9c87ff2bb01ddcbde859ca71a30fbf5513d601820bbfccd218a011224b6d98ef`.

## Verification

- `pnpm build && pnpm exec vitest run --project e2e test/e2e/shipments.spec.ts --project integration test/integration/runtime.spec.ts`:
  passed, 34 tests in two files. All API/worker SIGINT/SIGTERM checks pass without
  changing `test/integration/runtime.spec.ts`.
- `pnpm lint && pnpm typecheck && pnpm format:check`: passed.
- `pnpm test:cov:all`: passed, 563 tests in 65 files, zero failures, 494.97 seconds.
  Combined V8 coverage: statements 89.36%, branches 80%, functions 88.75%,
  lines 91.21%. Compiled child-process/CLI checks pass but are not measured by
  this V8 report. The existing pg concurrent-query deprecation warning remains.
- `git diff --check`: passed. Final baseline diff reviewed separately from the
  pre-existing SQ-V1-003 implementation changes before the approved commit.

## Review Notes

The clean signal exits observed earlier were instrumentation interference, not
evidence that the runtime contract should change. Ignoring arbitrary non-JSON
lines or accepting alternate shutdown results would weaken the logging/lifecycle
checks, so those assertions remain intact.

The workspace setting applies when this backend is opened as a VS Code workspace
or workspace folder. Console Ninja may need an editor reload to pick up settings.
If the parent directory is opened instead, configure the same setting there.
The local dependency cleanup remains intentionally applied; restoring its hook
would reintroduce the failures. A clean package reinstall also restores the
published dependency, provided the extension does not patch it again.

The pre-existing SQ-V1-003 implementation changes remain unstaged. These baseline
fixes form a separate, single-purpose user-approved commit:
`test(backend): SQ-V1-003 repair baseline test verification`.

## Remaining Issues

None. Live provider, deployment and container packaging checks were not run;
this follow-up changes tests and editor configuration only.

## Suggested Review Order

1. `test/e2e/shipments.spec.ts`.
2. `.vscode/settings.json` and this verification record.
