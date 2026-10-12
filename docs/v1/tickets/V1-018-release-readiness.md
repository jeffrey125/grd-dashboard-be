# V1-018: Complete release-readiness verification

## Status

Depends on V1-002, V1-010, V1-013, V1-014, V1-015, V1-016, and V1-017.

## Objective

Prove the complete backend v1 works from a fresh checkout and empty PostgreSQL database, close documentation gaps, and report any unresolved production blocker.

## Required reading

- Every authoritative document in `docs/v1`
- Every completed ticket handoff
- Repository instructions and CI configuration

## Scope

1. Audit the implementation against every v1 document and ticket acceptance criterion.
2. Perform a dependency/security/configuration review: supported versions, frozen lockfile, secret handling, production flags, `synchronize: false`, auth default-deny, safe structured logging, bounded timeouts/memory, and no unapproved packages.
3. Exercise a fresh database migration and seed, API startup, worker startup, authenticated Shipment creation, scheduled tracking with mocked Carriers, manual refresh, events, notifications, and clean shutdown.
4. Confirm API/worker separation and that exactly one worker is configured for v1.
5. Update the project README with prerequisites, environment variables, local commands, migration workflow, API/worker commands, tests, and known limitations.

## Acceptance criteria

- Frozen install, format check, Oxlint, typecheck, unit tests, coverage command, PostgreSQL integration tests, e2e tests, and production build all pass.
- Empty-database migrate and full revert/re-migrate pass.
- No API response exposes internal IDs, secrets, raw Carrier artifacts, or unsafe errors.
- Production logs are valid newline-delimited JSON and do not expose secrets, tracking references, source data, raw Carrier artifacts, request bodies, or unsafe errors.
- Every external dependency has bounded timeout/cancellation and deterministic mocked coverage.
- API and worker are independently reachable/startable; health/readiness correctly reflect dependencies.
- No Redis, external MQ, deploy folder, frontend code, or multi-worker mechanism has entered v1.
- Documentation links resolve and describe the actual scripts/files rather than planned names.
- Any unmet criterion is reported as a release blocker; v1 is not declared complete with hidden skips.

## Verification

Run every documented command from a fresh checkout. Record exact commands/results, local API URL, worker status, PostgreSQL/Testcontainers availability, and remaining risks.

## Final handoff

Provide the structured implementation handoff, separate pre-existing changes, propose coherent Conventional Commits, and request approval before committing. If changes are merged to `main`, follow repository instructions for the next annotated SemVer tag.
