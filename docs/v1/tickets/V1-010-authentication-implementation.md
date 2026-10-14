# V1-010: Implement authentication and authorization

## Status

Complete in the working tree; implementation and verification are recorded in
[the V1-010 summary](../implementation-summary/V1-010-implementation-summary.md).

Depends on V1-008 and V1-009.

## Objective

Implement the approved auth ADR, protect the API, and populate audit actors at the application-service seam.

## Required reading

- [`../auth-plan.md`](../auth-plan.md)
- The ADR produced by V1-009
- [`../database-schema.md`](../database-schema.md)
- [`V1-008-shipments-module.md`](V1-008-shipments-module.md)

## Scope

- Install only dependencies approved by V1-009.
- Add reviewed User/auth migrations and relationships without rewriting the initial migration.
- Implement authentication, current-principal extraction, authorization policy, and safe error responses.
- Protect Carrier and Shipment routes according to the ADR.
- Populate `created_by_id`, `updated_by_id`, and `deleted_by_id` from the principal inside application services/transactions.
- Keep worker/system actor behavior aligned with the ADR.

## Acceptance criteria

- Credentials/tokens are never logged or returned outside the approved protocol.
- Every non-health route has an explicit policy and default-deny behavior.
- Clients cannot spoof actor IDs.
- Authorized and forbidden paths are covered for each role/capability.
- Session/token expiry, revocation/logout, CSRF/CORS, recovery, and secret handling match the ADR.
- User deletion/suspension and audit history follow the approved schema semantics.
- Existing Carrier/Shipment tests remain green with authenticated test helpers.

## Verification

Run auth unit/integration/e2e tests, Carrier/Shipment e2e regression, migration tests, security-relevant manual checks, typecheck, and build.
