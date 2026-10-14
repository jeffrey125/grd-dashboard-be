# V1-009 implementation summary

## Summary

The employee authentication design is approved. GRD uses admin-managed
email/password accounts with Admin and Staff roles. The decision is recorded in
[ADR 0001](../../adr/0001-employee-authentication.md); V1-010 implements it.

## Changes Made

- Studied the original shipment-monitoring application and tom-automation's
  admin-managed account pattern. Selected first/last name, any valid normalized
  email, admin-issued passwords, mandatory replacement, and deactivation.
- Approved Better Auth 1.7.7 plus Nest throttler 6.7.1, with the existing pg,
  TypeORM, Nest, Zod, and Bottleneck dependencies. The server facade exposes only
  the approved routes; TypeORM retains schema ownership.
- Specified fixed 24-hour cookie sessions, multiple sessions, current-session
  logout, all-session revocation, protected admin changes, exact Origin/CORS,
  default-deny guards, operator bootstrap/recovery, and safe lifecycle logging.
- Specified four auth tables and indexed NO ACTION foreign keys for credentials,
  sessions, and existing business actor columns. No public signup, SSO, email
  delivery, MFA, or machine credentials in this scope.

## Files Changed

| File                                              | Review purpose                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CONTEXT.md`                                      | Employee/account vocabulary.                                                                        |
| `docs/adr/0001-employee-authentication.md`        | Accepted decisions, alternatives, tradeoffs, approval, and references.                              |
| `docs/v1/auth-api.md`                             | Exact schema, endpoints, route policy, session lifecycle, configuration, and operator instructions. |
| `docs/v1/auth-plan.md`                            | Points to the approved authoritative decision.                                                      |
| `docs/v1/database-schema.md`                      | Records the auth extension and actor foreign keys.                                                  |
| `docs/v1/architecture.md`                         | API-only AuthModule and current actor behavior.                                                     |
| `docs/v1/tickets/V1-009-authentication-design.md` | Completion status and summary link.                                                                 |
| This summary                                      | Review and verification evidence.                                                                   |

## Verification

Documentation consistency review completed against the original behavior,
existing schema, single-API/worker topology, Carrier/Shipment permissions, and
future V1-016 refresh/events seam. No source-code tests are required by V1-009;
implementation checks are recorded in the V1-010 summary. Final formatting and
diff checks are shared with that handoff.

## Review Notes

The final email/password decision supersedes earlier Google Workspace options.
The user approved dependencies and the application facade/guard approach before
implementation. The login page remains internet-reachable; business data requires
an active unrestricted session. Frontend screens and deployment remain separate.
The unrelated pre-existing `sample.txt` is untouched. The user approved the four local commits; no push or merge is authorized.

## Remaining Issues

None for the design gate. Production setup, frontend integration, and V1-016
implementation remain separate work as explicitly scoped in the ADR.

## Suggested Review Order

ADR → auth API/schema contract → architecture/schema links → V1-010 summary.
