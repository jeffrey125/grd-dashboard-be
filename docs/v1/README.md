# GRD Dashboard backend v1

This directory is the authoritative implementation plan for the fresh `grd-dashboard-be` backend. Build it as a NestJS and PostgreSQL modular monolith. The previous Bun/Hono/SQLite application is behavioral reference material only: do not migrate its database or preserve its internal architecture.

## Start here

1. Read this file and the ticket assigned to you.
2. Read every document named by that ticket under **Required reading**.
3. Inspect the repository, its current dependencies, and any repository instructions before editing.
4. Implement only the assigned ticket and meet every acceptance criterion.
5. Run the ticket's verification and provide the structured implementation and commit handoffs required by repository instructions.

Each ticket is intended for one branch and one implementation agent. A ticket may start only after every item in its **Depends on** section is complete.

## Authoritative documents

| Document                                                           | Use it for                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [`decisions.md`](decisions.md)                                     | Fixed architecture, stack, dependency approval, and deferred choices.                            |
| [`architecture.md`](architecture.md)                               | Runtime roles, module seams, request/worker flows, and v1 scaling boundary.                      |
| [`folder-structure.md`](folder-structure.md)                       | Target feature-first project layout and composition roots.                                       |
| [`database-schema.md`](database-schema.md)                         | Exact initial PostgreSQL tables, constraints, indexes, transactions, and migration order.        |
| [`tracking-behavior.md`](tracking-behavior.md)                     | Polling, outcomes, Carrier adapters, bulk insertion, refresh, errors, and notification behavior. |
| [`cache-design.md`](cache-design.md)                               | In-memory cache module, abstract cache service, feature ownership, and sample tests.             |
| [`tracking-source-data-policy.md`](tracking-source-data-policy.md) | Approved sanitized `source_data` and deferred raw-artifact policy.                               |
| [`auth-plan.md`](auth-plan.md)                                     | Auth sequencing, current schema seams, decision gate, and production requirement.                |
| [`shipping-quotes.md`](shipping-quotes.md)                         | Approved unified shipment quote calculator behavior, persistence, execution, and UI contract.    |
| [`tickets/README.md`](tickets/README.md)                           | Ticket dependency graph and execution order.                                                     |

When documents appear to conflict, the narrowest authoritative document wins: database schema over general architecture, cache design over the stack summary, and the assigned ticket over its summary in the ticket index. Surface any unresolved conflict before implementation.

## Approved monitoring extension

[MON-V1-002: delivered follow-up monitoring](delivered-follow-up-monitoring.md)
permits delivered shipments to remain active until a future follow-up date and
adds the Staff Monitor again workflow.

## Fixed v1 scope

- Backend only; the frontend is deferred.
- One repository, one pnpm package, and no Nx, Turborepo, or pnpm workspace.
- One codebase and image with an API entry point and worker entry point.
- V1 runs one API process and exactly one worker process; production hosting/topology remains undecided.
- PostgreSQL is authoritative. Redis, an external message broker, and a durable queue are deferred.
- API and worker logs use the same project-owned Pino wrapper and production JSON format.
- The worker begins scheduling automatically when its process becomes ready; there is no v1 Start/Stop API.
- Authentication is designed after the Nest/database foundation and must be implemented before the API is publicly deployed.
- Production deployment manifests and a `deploy/` directory are outside this rebuild; V1-018 adds portable packaging and local-only Compose.

## Completion definition

V1-018's approved scope adds a portable Docker image and **local-only** Compose,
verified PostgreSQL TLS and release/frontend documentation. Production Compose,
Caddy, App Platform specifications, deployment and new CI/CD workflows remain
deferred; these are not implicitly selected by adding the image.
Read [release-readiness.md](release-readiness.md) for evidence and open rollout
gates, [frontend-handoff.md](frontend-handoff.md) for current API integration and
[../../README.md](../../README.md) for executable setup/verification commands.

V1 is complete only when Ticket V1-018 passes: migrations work on an empty PostgreSQL database, the API and worker start independently, authenticated Shipment workflows pass, all three Carrier adapters pass mocked integration coverage, scheduled and manual tracking persist correct run/attempt/snapshot state, structured logs redact sensitive values, and every CI gate succeeds.
