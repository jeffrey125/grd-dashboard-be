# V1-001: Scaffold the NestJS project

## Status

Ready. No dependencies.

## Objective

Turn the placeholder repository into a stable, root-level NestJS TypeScript project managed by pnpm while preserving `docs/v1` unchanged.

## Required reading

- [`../README.md`](../README.md)
- [`../decisions.md`](../decisions.md)
- [`../folder-structure.md`](../folder-structure.md)

## Scope

1. Inspect the placeholder `package.json` and current stable Nest CLI requirements from official sources.
2. Select a supported active Node LTS, pin it using the repository's chosen version mechanism, and pin pnpm in `packageManager`.
3. Scaffold one root Nest project using the current default module format unless repository constraints justify another choice. Preserve `docs/v1` and Git history.
4. Keep the default Express adapter. Do not add Nest Observe, authentication, database, cache, Swagger, or feature packages in this ticket.
5. Establish `src/main.ts`, `src/app.module.ts`, Nest/TypeScript configuration, a minimal app test, and useful start/build/test scripts.

## Acceptance criteria

- `package.json` describes `grd-dashboard-be`, uses pnpm, and pins the package manager.
- The selected Node version satisfies both Nest runtime and CLI generation requirements.
- A fresh frozen-lockfile install succeeds.
- The application starts and responds through a minimal controller or bootstrap smoke path.
- Unit tests and production build succeed.
- No workspace, Nx, Turborepo, deployment files, database library, or unapproved production dependency is added.
- Every file already under `docs/v1` is preserved byte-for-byte except an intentional documentation correction reported in the handoff.

## Verification

Run the scaffold's install, unit test, and production build commands. Record the selected Node, pnpm, Nest, module format, and why they are compatible.

## Handoff

Report generated files separately from deliberate configuration changes. Propose a single Conventional Commit for the scaffold and obtain approval before committing.
