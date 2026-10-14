---
status: accepted
---

# Admin-managed employee authentication

GRD requires employee-only access to a shared Shipment dashboard. Use the
admin-managed account pattern studied in `/home/jeff/apps/tom-automation`, adapted
to email/password login, separate first and last names, and mandatory replacement
of every admin-issued password. This decision covers V1-009 and V1-010; dependency
and implementation approval was granted in the current session. This ADR and
`docs/v1/auth-api.md` supersede the unresolved decisions in `docs/v1/auth-plan.md`.

## Settled product decisions

- One GRD employee dashboard; browser clients only. The worker uses PostgreSQL
  internally, not an employee session. External machine credentials are outside v1.
- The login page is reachable over the internet. Business data and operations
  require an active Employee Account; no VPN is required.
- Email/password only. Google Workspace login and public signup are excluded.
  Admins create accounts with required first name, last name, email, and a role
  of exactly `admin` or `staff`. Any valid email domain is allowed.
- Staff can read Carriers and use the full Shipment workflow, including soft
  deletion. Account management, Carrier configuration, and diagnostic source-data
  access are admin-only. Admins can also use the Staff workflow.
- Admins issue initial and reset passwords. Employees can change their own
  passwords. Every issued password must be replaced before business access.
  Completion revokes all sessions and requires a fresh login.
- Sessions have an absolute 24-hour lifetime with no rolling renewal.
- Accounts are deactivated, never deleted. Deactivation immediately revokes all
  sessions and blocks new login. Reactivation restores eligibility to log in.
- Prevent admin self-deactivation and self-demotion; concurrent account changes
  must preserve at least one active admin.
- Dashboard and API use HTTPS subdomains of one company domain. Browser cookies
  use `HttpOnly`, production `Secure`, and `SameSite=Lax` with CSRF protection.

## Approved dependency and integration approach

Use pinned `better-auth@1.7.7` and `@nestjs/throttler@6.7.1`
for HTTP rate limiting, using the existing pnpm lockfile. Reuse Better Auth's password hashing,
verification, session creation, cookie signing, and session verification. Use its
built-in PostgreSQL adapter with the installed `pg` driver. Keep TypeORM as the
owner of reviewed migrations, application repositories, and ORM mappings; do not
add Drizzle, Prisma, or a custom Better Auth database adapter.

Use Better Auth's server API behind a narrow Nest auth facade. Expose only the
approved application endpoints and response projections, not its entire generic
handler. Nest's built-in guard infrastructure will enforce authentication,
fresh active-account state, mandatory password replacement, and explicit route
permissions. This is application policy glue, not a replacement credential or
session implementation.

The community `@thallesp/nestjs-better-auth` wrapper was evaluated: its current
source declares Nest 12 compatibility, but its generic route mounting still needs
restriction for our lifecycle. Direct integration keeps the public protocol and
required policy in one application-owned facade. The tradeoff is maintaining the
Nest HTTP adapter and policy guards ourselves.

Google OIDC with `openid-client` was considered before email/password-only was
selected. Passport is viable but requires more separate account/session workflow
assembly. A hosted auth provider would add another service and ownership model.

## Approved account and password rules

- Store email in trimmed lowercase form, enforce uniqueness in PostgreSQL, and
  reject duplicates rather than silently linking identities. Preserve passwords
  exactly as entered; permit 12–128 characters and reject reusing the current
  password when replacing an issued password. Trim names, require both, and limit
  each to 100 characters.
- Admins can list/read accounts, edit names/email, change roles, reset passwords,
  and deactivate/reactivate accounts. Employees can read their own profile and
  change their own password after supplying the current password. Profile edits
  are admin-managed. Email changes revoke the target's sessions; role changes
  take effect through fresh authorization and revoke sessions as well.
- Forgotten-password recovery is admin-assisted; no email delivery, password-reset
  links, mailbox verification, public invitation flow, or MFA is introduced in
  this scope. Do not claim an admin-entered email is mailbox-verified. Admins
  communicate issued credentials through their existing employee channel.
- Supply an operator-only CLI to bootstrap the first admin and a local recovery
  command for an existing admin's forgotten password. Neither exposes a public
  bootstrap/recovery HTTP route. Password entry is hidden, never a CLI argument,
  and never printed. Recovery requires password replacement at the next login.
- Bootstrap is serialized and refuses a second initial admin. Operator recovery
  cannot create another account or promote Staff; ordinary account management
  stays in authenticated admin services.
- Multiple simultaneous sessions are permitted. Logout revokes the current
  session; password changes, password resets, deactivation, email changes, and
  role changes revoke all sessions for the target account.

## Schema and consistency rules

Add a new reviewed migration without rewriting the initial schema. Define
`auth_users`, `auth_accounts`, `auth_sessions`, and `auth_verifications` using
Better Auth's required core fields and explicit snake_case mappings. Use numeric
database-generated IDs through Better Auth's supported serial-ID configuration.

`auth_users` additionally has an immutable unique public UUID, first and last
names, role, active state, mandatory-password-change state, and nullable creator
and updater references. The Better Auth display name is derived from the two
name fields. Required timestamps have database defaults; every update maintains
its update timestamp. Public application responses expose the UUID rather than
the internal numeric ID. Account rows retain Better Auth's credential provider
mapping; public projections never include hashes, session tokens, or internal
credential records.

Credentials and sessions reference `auth_users.id`. Existing Carrier/Shipment
actor columns and `tracking_runs.requested_by_id` also reference that numeric
key. Every new foreign key explicitly uses `ON DELETE NO ACTION` in both SQL and
ORM mappings. Add indexes for foreign-key lookups, normalized-email uniqueness,
public UUID uniqueness, unique session tokens, and session expiry cleanup.

User creation with credentials, reset/change with session revocation, and admin
protection checks must have transactionally safe behavior. Verify races including
concurrent bootstrap, conflicting admin changes, and login/password reset so a
stale password or previously issued session cannot restore revoked access.

Business application services receive trusted principals and supply actor IDs
inside writes/transactions. Public bodies reject actor IDs. Historical null
actors remain null; worker/system writes use null rather than impersonating an
employee. Manual tracking requests retain their authenticated requester's ID.

The exact columns, constraints, endpoint bodies, status codes, and index names
are recorded in [`../v1/auth-api.md`](../v1/auth-api.md).

## HTTP and security contract

- Public: minimal health checks and email/password login. Session/profile lookup
  and logout are allowed for a valid restricted session; password change is the
  only account mutation available while replacement is required. All business
  routes require an active, unrestricted principal and explicit role policy.
- Default-deny unclassified controller routes. Unexposed Better Auth endpoints,
  including registration and self-service role changes, remain unavailable.
- The cookie is host-only on the API domain, never shared across all subdomains.
  The frontend uses credentialed requests. CORS allows only exact configured
  frontend origins and credentials; it never uses a wildcard origin.
- Require an exact allowed `Origin` on unsafe browser requests, including login,
  password change, logout, and admin mutations. Missing/untrusted origins are
  rejected. SameSite and CORS are additional controls, not substitutes for this
  check. Local development has separately configured loopback origins.
- Disable session cookie caching and rolling renewal. Never return session tokens
  in application JSON or store them in browser local storage. Prevent caching of
  authenticated responses and credential exchanges.
- Better Auth's server API explicitly bypasses its HTTP rate limiter. Apply
  `@nestjs/throttler` guards to the Nest HTTP facade rather than assuming those
  server calls are protected. Start with login limits of 5 requests/minute per
  normalized email and 60/minute per client address; password changes/resets
  allow 5/minute per actor. Use the package's storage/guard primitives, not a
  custom counter implementation. In-memory counters fit the approved single API
  process, reset on restart, and must be replaced with shared storage before
  multiple API replicas. Trust forwarded addresses only from configured proxies.
- Validate a strong configured auth secret and HTTPS public URLs at startup;
  no development fallback secret in production. Auth configuration belongs to
  the API/CLI, not the worker. Secret changes intentionally invalidate sessions.
- Return generic login failures without distinguishing nonexistent email,
  deactivation, and incorrect password. Redact credentials and cookie headers,
  suppress request bodies and raw provider/library errors, and emit safe account
  lifecycle events without secret values.
- V1-016 still owns manual-refresh/SSE routes. This ticket specifies their Staff
  policy and audit seam without implementing the deferred tracking HTTP feature.

## Verification and scope

V1-009 requires consistency review across this ADR, auth plan, schema, topology,
and Carrier/Shipment/tracking contracts. V1-010 requires meaningful unit tests,
real PostgreSQL migration and concurrency integration tests, authenticated
Carrier/Shipment e2e regression, CSRF/CORS/cookie/redaction checks, typecheck,
lint, formatting, and production build. Use disposable databases, not production
migration execution.

This is backend-only under the existing v1 scope; frontend screens and deployment
are deferred. Preserve the pre-existing untracked `sample.txt`. The design and
implementation will have separate ticket summaries and coherent commit proposals;
committing requires explicit final approval.

## Primary references checked

- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Core schema, custom fields, and numeric IDs](https://better-auth.com/docs/concepts/database)
- [Email/password authentication](https://better-auth.com/docs/authentication/email-password)
- [Nest integration](https://better-auth.com/docs/integrations/nestjs)
- [Nest integration compatibility declaration](https://github.com/ThallesP/nestjs-better-auth/blob/master/package.json)
- [Better Auth rate-limit boundary](https://better-auth.com/docs/concepts/rate-limit)
- [Nest rate limiting](https://docs.nestjs.com/security/rate-limiting)
