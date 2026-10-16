# V1-008: Implement Shipment management and single creation

## Status

Depends on V1-007.

Implementation follows the approved decisions below. Verification and completion
evidence are recorded in
[`../implementation-summary/V1-008-implementation-summary.md`](../implementation-summary/V1-008-implementation-summary.md).

## Objective

Implement Shipment CRUD through external UUIDs, repository contracts, soft deletion,
and one-shipment-at-a-time public creation.

## Required reading

- [`../database-schema.md`](../database-schema.md), Shipment section
- [`../tracking-behavior.md`](../tracking-behavior.md), Shipment management
- [`../architecture.md`](../architecture.md), module seams

## Scope

- Implement Shipment entity mapping, repository contract, TypeORM implementation, service, request/response schemas, controller, and tests.
- List, create, read, update notes, and soft-delete Shipments without exposing internal IDs.
- Add manual pause/resume using the existing `monitoring_status` and
  `monitoring_reason` columns, as agreed during V1-007. Do not add a duplicate
  monitoring boolean. Settle permitted resume transitions and scheduling behavior
  during this ticket's interview; V1-007 does not implement Shipment operations.
- Generate verification URLs through the Carrier validation/interface seam.
- Implement strict single-item creation for one Carrier/reference pair.
- Return a created/existing outcome without modifying an already-active duplicate.

## Acceptance criteria

- Tracking references remain strings and are validated by the selected Carrier; no JSON-number coercion.
- Active duplicates are reported rather than inserted; soft-deleted pairs can be created again.
- Invalid input or an unexpected database failure inserts nothing.
- Status and response distinguish a new insertion from an existing pair.
- Audit actor input is absent from public schemas; actor columns remain null until auth implementation.
- Concurrent duplicate requests are proven safe by PostgreSQL integration coverage.
- Unit/integration/e2e tests cover validation, rollback, duplicates, soft deletion, external IDs, and notes limits.

## Verification

Run Shipment unit, repository integration, concurrent duplicate, and HTTP e2e suites plus typecheck and build.

## Approved implementation decisions

- Reuse installed Nest, Zod, TypeORM, PostgreSQL, Vitest, Supertest, and
  Testcontainers. Preserve feature-owned repository interfaces and Symbol tokens.
  No new dependency, schema migration, cache, or frontend is required.
- `POST /shipments` accepts one strict `{ carrierExternalId, trackingReference,
notes? }` object. It returns `{ outcome, shipment }`: 201/`created` for a new
  record and 200/`existing` for a nondeleted duplicate.
- Generic reference validation explicitly replaces provider-specific format
  checks for this ticket: trim, require a nonempty string of at most 255 UTF-16
  code units, reject NUL, and preserve casing, internal whitespace, and leading
  zeros. JSON numbers are rejected. The Carrier policy seam remains available.
- Notes are trimmed, nonempty when a string, at most 500 UTF-16 code units, and
  cannot contain NUL. Omission on creation means null; explicit null clears a note.
  Unknown fields and client-provided actor/identity/state fields are rejected.
- Existing non-deleted pairs are returned unchanged, including paused/completed
  Shipments; supplied notes never overwrite them. Missing, deleted, or disabled
  Carriers reject creation with field-specific errors. Recheck eligibility
  transactionally to cover concurrent Carrier changes.
  Existing Shipments remain readable/editable when their Carrier is disabled or
  soft-deleted.
- List all non-deleted Shipments newest first (creation time, then internal ID as
  a deterministic tie-breaker), initially without pagination. Read, PATCH notes,
  and DELETE use Shipment UUIDs. Deletion returns 204, preserves history, clears
  the schedule, and allows fresh creation with a new UUID. Missing/deleted UUIDs
  return 404. Public records include a Carrier UUID/code/name/active summary,
  reference, notes, URL, monitoring fields, scheduling fields, counter, and audit
  timestamps; internal IDs, actor IDs, snapshot pointers, and versions are absent.
- Creation starts active with `nextCheckAt` immediately due and a null verification
  URL. Pure Carrier URL builders preserve the original templates; V1-011 and
  adapter integration persist the URL only after the first successful lookup.
- `POST /shipments/:externalId/pause` permits active → paused/manual and clears
  `nextCheckAt`. `POST /shipments/:externalId/resume` permits only paused/manual →
  active, clears the reason, and makes the Shipment immediately due. Both preserve
  the not-found counter and tracking history. Repeated/invalid transitions return
  409; missing/deleted UUIDs return 404. Commands accept an empty or absent body.
  Threshold-paused Shipments need successful manual refresh in V1-016; delivered
  Shipments cannot resume. Carrier eligibility still governs future scheduling.
