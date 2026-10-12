# V1-008: Implement Shipment management and bulk creation

## Status

Depends on V1-007.

## Objective

Implement Shipment CRUD through external UUIDs, repository contracts, soft deletion, and atomic bulk creation of 1-10 explicit records.

## Required reading

- [`../database-schema.md`](../database-schema.md), Shipment section
- [`../tracking-behavior.md`](../tracking-behavior.md), Shipment management
- [`../architecture.md`](../architecture.md), module seams

## Scope

- Implement Shipment entity mapping, repository contract, TypeORM implementation, service, request/response schemas, controller, and tests.
- List, create, read, update notes, and soft-delete Shipments without exposing internal IDs.
- Generate verification URLs through the Carrier validation/interface seam.
- Implement atomic bulk creation of 1-10 explicit Carrier/reference items.
- Validate the entire bulk request before writing; deduplicate normalized pairs and return inserted versus already-active duplicates.

## Acceptance criteria

- Tracking references remain strings and are validated by the selected Carrier; no JSON-number coercion.
- Active duplicates are reported rather than inserted; soft-deleted pairs can be created again.
- Any invalid item or unexpected database failure inserts nothing.
- Bulk status distinguishes at least one insertion from an all-duplicate result.
- Audit actor input is absent from public schemas; actor columns remain null until auth implementation.
- Concurrent duplicate requests are proven safe by PostgreSQL integration coverage.
- Unit/integration/e2e tests cover validation, atomicity, rollback, duplicates, soft deletion, external IDs, and notes limits.

## Verification

Run Shipment unit, repository integration, concurrent duplicate, and HTTP e2e suites plus typecheck and build.
