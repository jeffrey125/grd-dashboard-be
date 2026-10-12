# V1-003: Add runtime composition, configuration, and health

## Status

Depends on V1-002.

Implemented; see the [implementation summary](../implementation-summary/V1-003-implementation-summary.md) for the configuration contract, verification, and deferred integrations.

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
- Replace the V1-001 sample `GET /` controller, service, and unit test with the
  health module, controller, and health tests. The `Hello World!` route must not
  remain after this ticket.
- Replace V1-002's `test/e2e/app.spec.ts` greeting assertion with health HTTP coverage through the existing Supertest helper.
- `worker.ts` starts a Nest standalone application context and `WorkerModule`; it does not expose the API controllers.
- Validate required configuration at startup and report safe, actionable errors.
- Add `.env.example` with PostgreSQL plus future Carrier variable names, including `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, and `ECHOSHIP_PASSWORD`, but no secrets.
- Enable graceful shutdown for both composition roots.
- Add liveness and readiness; readiness must be structured to include database/worker dependencies when later tickets add them.

## Acceptance criteria

- API and worker start independently through separate scripts.
- The V1-001 sample `GET /` route and its supporting controller, service, and test are removed.
- Starting the API does not instantiate worker/scheduler providers.
- Invalid configuration fails before accepting work and never logs secrets.
- SIGINT/SIGTERM close each application context cleanly.
- Health tests cover healthy and failed dependency states.
- No polling, Carrier adapter, or deployment configuration is implemented.

## Verification

Run unit tests, start/stop both entry points, exercise health, typecheck, and build.
