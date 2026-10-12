# V1 decisions and dependency status

## Architecture decisions

| Area               | V1 decision                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Backend            | NestJS, TypeScript, PostgreSQL.                                                             |
| Shape              | Feature-first modular monolith.                                                             |
| Runtime            | One API entry point and one worker entry point from the same package/image.                 |
| Scale              | One worker process in v1; multi-worker coordination is deferred.                            |
| Package management | pnpm with one package; no workspace orchestrator.                                           |
| Persistence        | TypeORM with repository contracts and reviewed migrations; `synchronize` is disabled.       |
| Identifiers        | Internal identity integers plus immutable UUIDv4 `external_id` on API-addressable entities. |
| Cache              | Nest cache manager with process-local memory only.                                          |
| Logging            | Project-owned structured logging built directly on `pino`; JSON is the production format.   |
| Messaging          | No Redis, RabbitMQ, Kafka, BullMQ, or external message broker.                              |
| Deployment         | No deploy folder or infrastructure manifests in this scope.                                 |

Use a currently supported Node LTS release that satisfies the selected stable Nest CLI. Nest recommends an active LTS release, and production Node applications should use an LTS line. Pin Node, pnpm, Nest packages, and the lockfile during Ticket V1-001 rather than copying version numbers from this document. See [Nest first steps](https://docs.nestjs.com/first-steps) and [Node release status](https://nodejs.org/en/about/previous-releases).

## Approved production dependencies

| Package                                                      | Purpose                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | Framework and Express HTTP adapter.                                                                 |
| `reflect-metadata`, `rxjs`                                   | Required Nest runtime dependencies.                                                                 |
| `@nestjs/config`, `zod`                                      | Approved in V1-003 for environment loading and typed startup validation.                            |
| `@nestjs/terminus`                                           | Approved in V1-003 for readiness aggregation and future dependency checks.                          |
| `@nestjs/typeorm`, `typeorm`, `pg`                           | PostgreSQL persistence and migrations.                                                              |
| `@nestjs/cache-manager`, `cache-manager`                     | Per-process in-memory cache.                                                                        |
| `slugify`                                                    | Immutable Carrier code creation with `{ lower: true, strict: true, replacement: '-', trim: true }`. |
| `pino`                                                       | Structured JSON logging shared by the API and worker.                                               |

## Approved development dependencies

- Nest CLI and schematics, TypeScript, and Node/Express types.
- Vitest, Nest testing utilities, V8 coverage, and TypeScript path resolution.
- Supertest and its types.
- PostgreSQL Testcontainers for migration/repository/integration coverage.
- Oxlint, Prettier, Husky, and lint-staged.
- `pino-pretty` for an optional local-development output script; it is never used in production.

## Dependency approval gates

The following are recommended but are not blanket-approved by this plan. The implementing ticket must inspect current project capabilities, verify current maintenance/compatibility from primary sources, explain material tradeoffs, and obtain explicit approval before installation:

| Capability                     | Candidate                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Request validation integration | Evaluate compatible Nest built-ins with the installed Zod package; additional integrations require approval. |
| OpenAPI                        | `@nestjs/swagger`.                                                                                           |
| Scheduler                      | `@nestjs/schedule`.                                                                                          |
| UPS HTTP and retries           | `@nestjs/axios`, `axios`, `axios-retry`.                                                                     |
| Browser automation             | `playwright`.                                                                                                |
| FFE XML                        | `fast-xml-parser`.                                                                                           |
| Per-Carrier request throttling | `bottleneck`.                                                                                                |
| Authentication                 | Selected only after Ticket V1-009 resolves the auth model.                                                   |

Node built-in `fetch` is sufficient for simple ntfy calls. RxJS, already required by Nest, is sufficient for SSE. PostgreSQL generates UUIDv4-compatible random UUIDs with `gen_random_uuid()`.

## Explicitly deferred

- Nx, Turborepo, and pnpm workspaces.
- Redis/shared cache, durable job queue, multi-worker leases, and distributed rate limiting.
- Knip until the project has stable entry points and meaningful modules.
- Raw Carrier artifact/object storage and exact source-data retention.
- Frontend implementation and deployment infrastructure.

## Superseded choices

- SQLite, Drizzle, Hono, Bun runtime defaults, and the old directory layout are not rebuild targets.
- A single global `POLL_INTERVAL_MS` does not control Carrier cadence; PostgreSQL `carriers.poll_interval_minutes` does.
- One `not_found` result no longer disables a Shipment; the configured consecutive threshold does.
- The old process-local Start/Stop coordinator is replaced by an automatically running worker process and database-backed run state.
- Refresh-all is not part of v1; manual refresh targets one Shipment.
