# V1-007: Implement the Carriers module

## Status

Depends on V1-005.

## Objective

Implement Carrier persistence and application behavior, including immutable slug codes and safe configuration updates.

## Required reading

- [`../database-schema.md`](../database-schema.md), Carrier section
- [`../architecture.md`](../architecture.md), module seams
- [`../decisions.md`](../decisions.md), approved `slugify` dependency

## Scope

- Implement the Carrier entity mapping, repository contract, TypeORM adapter, service, schemas, controller behavior, and tests.
- Generate `code` only on creation with `slugify` and the approved options.
- Reject empty, overlength, or colliding codes and keep code immutable when the display name changes.
- Support reading/updating active state, name, not-found threshold, poll interval, and nullable rate limit through external UUIDs.
- Keep credentials, endpoints, protocol timeouts, and deferred future columns outside the database/API.

## Acceptance criteria

- Services depend on the Carrier repository contract, not TypeORM repositories.
- Internal IDs never appear in responses or request schemas.
- Validation matches every Carrier database check before persistence while the database remains the final guard.
- Disabling a Carrier prevents new scheduled work without deleting its Shipment relationships.
- Unit tests cover slug options, empty/collision behavior, immutability, configuration validation, and soft deletion.
- PostgreSQL integration tests cover uniqueness and update behavior.

## Verification

Run Carrier unit, repository integration, and HTTP e2e tests plus typecheck and build.
