# V1 authentication plan

## Decision

Build the Nest/configuration/database foundation first. Then resolve and implement authentication before the API is publicly deployed. Do not ship temporary authentication that will be discarded later.

## Reserved schema seams

The initial business tables already reserve nullable actor columns:

- `created_by_id`
- `updated_by_id`
- `deleted_by_id`
- `tracking_runs.requested_by_id`

They have no User foreign keys in the initial migration. Clients never supply these values. Worker/system actions use null until the auth design defines a system actor.

## Ticket V1-009 decision gate

The V1-007 interview settled Carrier permissions: regular authenticated users may
list/read Carriers; only admins may update names, settings, or active state.
There are no Carrier creation/deletion/restoration routes to authorize. Creation
is migration-only and requires an implemented adapter. V1-010 must enforce this
policy before public deployment; V1-007 does not implement role guards.

Resolve these requirements before selecting auth dependencies or creating User tables:

1. First-party browser only, machine clients, or both.
2. Username/password, external identity provider, or organization SSO.
3. Secure cookie session versus access/refresh tokens.
4. Single organization versus multi-tenant ownership.
5. Required roles and permissions for Carrier configuration, Shipment mutation, manual refresh, and source-data access.
6. Account invitation, recovery, verification, suspension, and audit requirements.

Record the result as an ADR and update the schema plan through a reviewed migration. Dependency installation requires explicit approval after this decision.

## Production gate

Before public deployment:

- Every non-health HTTP route has an explicit public/authenticated policy.
- Actor IDs come from the authenticated principal at the application-service seam.
- Authorization tests cover Carrier administration, Shipment access/mutation, manual refresh, and sensitive source data.
- CORS, cookie/token storage, secrets, rate limits, and error responses match the selected model.

Local unauthenticated development before the auth ticket must bind to a private/local interface and must not be treated as production-ready.
