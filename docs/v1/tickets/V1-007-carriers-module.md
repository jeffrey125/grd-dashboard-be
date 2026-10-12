# V1-007: Implement the Carriers module

## Status

Depends on V1-005. Scope revised by explicit user approval during implementation:
Carrier creation is migration-only, and deletion APIs are deferred.
The user confirmed that `carriers.repository.ts` should be restored after its
removal resulted from a misunderstood clarification.

## Objective

Implement Carrier reads and safe configuration updates through external UUIDs,
with immutable adapter codes and a production repository contract.

## Required reading

- [`../database-schema.md`](../database-schema.md), Carrier section
- [`../architecture.md`](../architecture.md), module seams
- [`../decisions.md`](../decisions.md), existing dependency approach

## Approved scope

- Replace and remove V1-005's temporary `test/support/carrier-repository.ts`
  contract, provider, and consuming service with the production Carrier repository.
  Preserve repository-DI, UUID, audit, uniqueness, and soft-deletion assertions
  against that production seam. Test fixtures provision rows directly, as migrations do.
- Implement the Carrier entity mapping, repository contract, TypeORM adapter,
  service, validation schemas, controller, and tests.
- Keep `CarrierRecord`, `CarriersRepository`, and the `CARRIERS_REPOSITORY` Symbol
  in `carriers.repository.ts`. Bind the TypeORM implementation through the provider.
- Expose `GET /carriers`, `GET /carriers/:externalId`, and
  `PATCH /carriers/:externalId`. Use UUIDv4 identifiers and camelCase JSON fields.
- List all non-deleted Carriers, including disabled ones, ordered by code.
  Return a plain array; the migration-managed catalog is small.
- Allow partial updates of name, active state, not-found threshold, poll interval,
  and nullable rate limit. Reject unknown fields, empty updates, coercion, immutable
  identifiers/codes, and client-supplied audit actors. Trim names and reject blanks.
- Carrier creation belongs exclusively to reviewed migrations accompanying an
  implemented adapter. Keep explicit stable adapter codes in migrations. Automatic
  slug generation, `slugify` installation, and application creation operations are
  deferred. Preserve the initial migration and its seed codes.
- No create, soft-delete, hard-delete, or restore API. Administrators use
  `isActive` for reversible stops. Existing soft-deleted rows remain hidden and
  cannot be updated through this API; their codes remain reserved.
- Regular authenticated users may read Carriers; only admins may change settings.
  V1-009/V1-010 own actual authentication and authorization before public deployment.
- Keep credentials, endpoints, protocol timeouts, and deferred columns outside
  the database/API. Reuse TypeORM, Zod, Nest, and the existing test stack; no new dependency.

## Acceptance criteria

- Services depend on the Carrier repository contract, not TypeORM repositories.
- Internal IDs and audit actor IDs never appear in responses or request schemas.
- Configuration validation enforces numeric database checks and the `smallint`
  upper bound before persistence; PostgreSQL remains the final guard.
- Rename/settings updates preserve code and UUID. Explicit null clears the rate
  limit; omitted fields retain their values. Unknown or invalid fields reject the whole update.
- Disabling excludes a Carrier from the repository's active selection without
  changing Shipment relationships. V1-012 must use this eligibility policy when
  creating scheduled work; the scheduler is outside this ticket.
- Unit tests cover configuration validation, immutable input rejection, and missing/deleted behavior.
- Real PostgreSQL integration tests preserve uniqueness (including deleted rows),
  UUID generation, audit timestamps, soft-deletion exclusions, updates, concurrent
  independent changes, and Shipment relationships.
- HTTP e2e tests cover read/update behavior, response projection, invalid inputs,
  missing/deleted UUIDs, and absent creation/deletion/restoration routes.

## Verification

Run Carrier unit, repository integration, and HTTP e2e tests plus the repository
format, lint, typecheck, and build checks. Record the exact results in
`docs/v1/implementation-summary/V1-007-implementation-summary.md`.
