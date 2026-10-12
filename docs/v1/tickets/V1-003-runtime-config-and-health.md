# V1-003: Add runtime composition, configuration, and health

## Status

Depends on V1-002.

## Objective

Create independent API and worker composition roots with validated environment configuration, graceful shutdown, and health behavior.

## Required reading

- [`../architecture.md`](../architecture.md)
- [`../decisions.md`](../decisions.md)
- [`../folder-structure.md`](../folder-structure.md)

## Dependency gate

Evaluate `@nestjs/config`, Zod with compatible Nest validation, and `@nestjs/terminus` against the scaffold. Obtain explicit approval before installing any new production dependency. If built-in behavior is sufficient, document that choice before implementation.

## Scope

- `main.ts` starts the HTTP API and `AppModule`.
- `worker.ts` starts a Nest standalone application context and `WorkerModule`; it does not expose the API controllers.
- Validate required configuration at startup and report safe, actionable errors.
- Add `.env.example` with PostgreSQL plus future Carrier variable names, including `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, and `ECHOSHIP_PASSWORD`, but no secrets.
- Enable graceful shutdown for both composition roots.
- Add liveness and readiness; readiness must be structured to include database/worker dependencies when later tickets add them.

## Acceptance criteria

- API and worker start independently through separate scripts.
- Starting the API does not instantiate worker/scheduler providers.
- Invalid configuration fails before accepting work and never logs secrets.
- SIGINT/SIGTERM close each application context cleanly.
- Health tests cover healthy and failed dependency states.
- No polling, Carrier adapter, or deployment configuration is implemented.

## Verification

Run unit tests, start/stop both entry points, exercise health, typecheck, and build.
