# Employee authentication contract

Approved under V1-009; implemented by V1-010. See
[`../adr/0001-employee-authentication.md`](../adr/0001-employee-authentication.md).

## HTTP

All inputs are strict JSON objects. UUID route parameters are UUIDv4. Public
account records are `{ externalId, firstName, lastName, email, role, active,
mustChangePassword, createdAt, updatedAt }`. Passwords and internal numeric IDs
are never returned. Dates serialize to ISO timestamps. Responses use no-store.

| Method/path                                        | Input                                                             | Policy / success                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| POST `/api/v1/auth/sign-in`                        | `{ email, password }`                                             | Public, trusted Origin; 200 profile and Set-Cookie                                            |
| GET `/api/v1/auth/me`                              | none                                                              | Active session, including restricted; 200 profile                                             |
| POST `/api/v1/auth/sign-out`                       | empty                                                             | Active session, including restricted; 204, revoke current session                             |
| POST `/api/v1/auth/change-password`                | `{ currentPassword, newPassword }`                                | Active session, including restricted; 204, clear replacement requirement, revoke all sessions |
| GET `/api/v1/admin/accounts`                       | none                                                              | Unrestricted Admin; 200 array                                                                 |
| GET `/api/v1/admin/accounts/:externalId`           | none                                                              | Unrestricted Admin; 200 profile                                                               |
| POST `/api/v1/admin/accounts`                      | `{ firstName, lastName, email, password, role }`                  | Unrestricted Admin; 201, active with required password replacement                            |
| PATCH `/api/v1/admin/accounts/:externalId`         | nonempty subset of `{ firstName, lastName, email, role, active }` | Unrestricted Admin; 200 profile                                                               |
| POST `/api/v1/admin/accounts/:externalId/password` | `{ password }`                                                    | Unrestricted Admin; 204, require replacement and revoke all sessions                          |

GET Carrier routes, every Shipment route including search and history, and
`GET /api/v1/dashboard/overview` require unrestricted Staff or Admin; Carrier PATCH
requires Admin. Minimal health GETs and `GET /api/v1/features` are public. The feature endpoint
returns only `{ quoteComparisonEnabled: boolean }` with `Cache-Control: no-store`. Other controller handlers require
an explicit policy; absence denies access. Manual refresh and live events require
unrestricted Staff/Admin; diagnostic source-data access requires Admin. No machine
API credentials in v1.

Use 400 for invalid input, 401 for missing/expired/revoked/inactive sessions and
generic login failures, 403 for role/origin/password-replacement restrictions,
404 for missing account UUID, 409 for duplicate email or protected admin changes,
and 429 for throttling. Wrong current password is a generic 400. Unhandled errors
use the existing safe error boundary without serializing library errors.

## Schema

All auth IDs are integer GENERATED ALWAYS AS IDENTITY. Timestamps are timestamptz
with created/updated defaults of now(); updates explicitly maintain updated_at.
Every FK uses ON DELETE NO ACTION. Auth users have no deletion column.

| Table              | Columns and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth_users         | id PK; external_id uuid UNIQUE DEFAULT gen_random_uuid(), immutable; name text NOT NULL (derived); first_name/last_name varchar(100) NOT NULL; email varchar(254) UNIQUE NOT NULL, lowercase/trimmed; email_verified boolean DEFAULT false; image text NULL; role varchar(5) CHECK admin/staff DEFAULT staff; active boolean DEFAULT true; must_change_password boolean DEFAULT true; created_at/updated_at; created_by_id/updated_by_id integer NULL FK self |
| auth_accounts      | id PK; user_id integer NOT NULL FK users; account_id text NOT NULL; provider_id text NOT NULL; password text NULL; access_token/refresh_token/id_token/scope text NULL; access_token_expires_at/refresh_token_expires_at timestamptz NULL; created_at/updated_at; UNIQUE(provider_id, account_id)                                                                                                                                                             |
| auth_sessions      | id PK; user_id integer NOT NULL FK users; token text UNIQUE NOT NULL; expires_at timestamptz NOT NULL; ip_address/user_agent text NULL; created_at/updated_at                                                                                                                                                                                                                                                                                                 |
| auth_verifications | id PK; identifier/value text NOT NULL; expires_at timestamptz NOT NULL; created_at/updated_at                                                                                                                                                                                                                                                                                                                                                                 |

Indexes cover all FK columns, session expiry, and verification identifier/expiry.
Existing Carrier/Shipment created_by_id, updated_by_id, deleted_by_id and tracking
run requested_by_id gain indexed auth_users FKs. Initial migration remains intact.

TypeORM migrations and mappings own the schema; Better Auth uses the same
PostgreSQL database through its built-in adapter. No runtime auto-migration.
Admin mutations and credential/session lifecycle operations serialize with a
transaction-scoped PostgreSQL advisory lock and recheck authority under the lock.
An existing Bottleneck queue serializes entry before acquiring database clients,
so waiting auth transactions cannot exhaust the shared pool used by Better Auth.
This deliberately favors simple, deterministic revocation over concurrent login
throughput for the single-organization v1 deployment. Ordinary business requests
already authorized before a concurrent revocation may complete; subsequent
requests must fail. System writes retain null actors.

## Browser, configuration, and operations

The API issues a host-only HttpOnly cookie with SameSite=Lax, Secure in production,
and a maximum absolute lifetime of 24 hours. No rolling renewal or cookie cache.
Use credentialed frontend requests and an exact Origin allowlist. Every unsafe
browser method requires an allowed Origin, including authentication routes.
No wildcard CORS, subdomain-wide cookie, or bearer-token JSON response.

API/CLI require AUTH_SECRET (at least 32 characters), AUTH_BASE_URL (API origin),
and AUTH_TRUSTED_ORIGINS (comma-separated frontend origins). HTTPS is required
in production. The worker does not require auth configuration. Proxy trust is
explicit and defaults to disabled. Passwords are 12–128 characters and are never
trimmed; names are trimmed and 1–100 characters. Admins may use any valid email.

Admin/operator issues credentials out of band. No mailbox verification, public
signup, email reset/invitation delivery, or MFA is implemented. EmailVerified
remains false rather than misrepresenting mailbox ownership. Multiple sessions
are allowed. Current-session logout and all-session revocation follow the ADR.
Account/role/email/password changes and bootstrap emit safe lifecycle log events.

CLI bootstrap refuses an existing Admin. Operator recovery resets only an
existing Admin, does not promote/reactivate accounts, requires password change,
and revokes sessions. Hidden interactive password prompts accept no passwords
on command lines and never echo them.

Rate limiting uses Nest throttler storage/guards: sign-in 5/minute per normalized
email and 60/minute per client address; password mutations 5/minute per actor.
Counters are local to the approved single API process and reset on restart;
multiple replicas require shared storage first. Raw email is hashed in keys.

## Operator setup

1. Configure `.env` from `.env.example`, including a randomly generated auth secret
   and exact API/frontend origins. Use HTTPS and same-site subdomains in production.
2. Apply reviewed migrations with `pnpm migration:run` before starting the API.
3. Run `pnpm auth:bootstrap` in a local interactive terminal and supply the initial
   admin's name, email, and issued password. This refuses an existing Admin.
4. Sign in through the frontend/API, replace the issued password, and sign in again.
   For a forgotten existing admin password, run `pnpm auth:recover`; this neither
   creates accounts nor reactivates inactive admins.

The commands accept no credential arguments or piped password input. Limit local
shell/database access to trusted operators. `AUTH_TRUST_PROXY=loopback` is available
only for a trusted local proxy. Use `digitalocean` only as described below;
otherwise retain `false`. Expired sessions are
rejected on every request; expiration indexes support later operational cleanup.

## App Platform client IP mode

Set `AUTH_TRUST_PROXY=digitalocean` only when requests reach the API through
DigitalOcean App Platform ingress. Login throttling reads a single valid
`do-connecting-ip`; missing, malformed, comma-separated or scoped addresses return
400 before credential verification. `X-Forwarded-For` does not select the login
counter in this mode. The installed Nest throttler still normalizes addresses
and groups IPv6 by /64. Email and password-change counters retain their existing
rules. Health endpoints do not require the ingress header.

Express proxy trust remains false in this mode; this setting changes login IP
tracking, not other forwarded-header behavior. `false` and `loopback` retain their
previous behavior and ignore `do-connecting-ip`. This trusts the managed ingress,
not arbitrary direct clients: do not expose a bypass route to the API container.
Verify header replacement/spoof resistance through the actual deployed ingress
before enabling public traffic. No auth response schema or frontend change.

## Frontend diagnostics (OBS-V1-001)

`POST /api/v1/telemetry/frontend` requires an active session and trusted Origin,
including restricted sessions. It returns 204 and is limited to 20 reports per
minute per account. See [frontend-debugging.md](frontend-debugging.md) for strict
fields and privacy boundaries. CORS exposes the server-generated `X-Request-Id`
for correlating a failed API response with its backend request log.
