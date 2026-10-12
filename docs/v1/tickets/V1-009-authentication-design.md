# V1-009: Resolve the authentication design

## Status

Depends on V1-003 and V1-005. This is a design/approval gate, not an implementation ticket.

## Objective

Resolve the v1 identity, session/token, authorization, User schema, and dependency choices before authentication code is written.

## Required reading

- [`../auth-plan.md`](../auth-plan.md) in full
- [`../architecture.md`](../architecture.md), Authentication boundary
- [`../database-schema.md`](../database-schema.md), actor columns
- Current frontend requirements if they exist at execution time

## Scope

1. Gather answers to every decision in `auth-plan.md` from the product owner; do not infer multi-tenancy, SSO, or credential ownership.
2. Evaluate maintained libraries and Nest built-ins against the agreed flow using current primary documentation.
3. Propose the minimum User/auth schema and relationships, including actor foreign keys and deletion behavior.
4. Define route policy, roles/permissions, session/token lifecycle, CSRF/CORS/storage rules, recovery/invitation behavior, and machine-client support.
5. Record the choice in an ADR and update the schema/API documentation.
6. Request explicit approval for every new production dependency and custom security mechanism.

## Acceptance criteria

- The ADR records considered alternatives, threat-relevant tradeoffs, and the selected model.
- User/entity columns, constraints, indexes, migrations, and audit relationships are specified precisely enough to implement without guessing.
- Every planned endpoint category has a public/authenticated/role policy.
- Browser credential storage, CSRF, CORS, expiration, rotation/revocation, recovery, and secret management are explicit.
- Dependencies are approved or the ticket records the exact unresolved approval blocker.
- `auth-plan.md` is updated to point to the ADR as the new authoritative decision.

## Verification

Perform a documentation consistency review against the schema, runtime topology, and Shipment/manual-refresh requirements. No source-code tests are expected.
