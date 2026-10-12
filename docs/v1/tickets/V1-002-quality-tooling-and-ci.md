# V1-002: Add quality tooling and CI

## Status

Depends on V1-001.

## Objective

Install the approved development tooling and make local/CI quality checks deterministic without adding deployment behavior.

## Required reading

- [`../decisions.md`](../decisions.md)
- [`../folder-structure.md`](../folder-structure.md)

## Scope

- Configure Oxlint and Prettier without overlapping formatter/linter responsibilities.
- Configure Vitest unit, integration, and e2e projects plus V8 coverage reporting.
- Configure Supertest and PostgreSQL Testcontainers support.
- Add Husky and lint-staged; staged JS/TS receives safe Oxlint fixes and Prettier-supported files are formatted.
- Add GitHub Actions for pull requests and pushes to `main`: frozen install, format check, lint, typecheck, unit tests, PostgreSQL integration/migration tests, and build.

## Required scripts

Provide `format`, `format:check`, `lint`, `lint:fix`, `typecheck`, `test`, `test:watch`, `test:cov`, `test:integration`, `test:e2e`, `build`, `prepare`, and `check`. Adapt exact config paths to the selected scaffold.

## Acceptance criteria

- `pnpm check` runs the fast deterministic local gates.
- The pre-commit hook runs lint-staged, typecheck, and unit tests in that order.
- PostgreSQL suites are separate from the default unit command.
- CI uses a real container runtime for Testcontainers and fails visibly if it is unavailable.
- CI contains no publish or deployment job.
- A deliberately malformed temporary fixture proves each relevant gate detects failure; remove the fixture before completion.

## Verification

Run format check, lint, typecheck, unit tests, a minimal Testcontainers smoke test, and build locally. Validate the workflow syntax.
