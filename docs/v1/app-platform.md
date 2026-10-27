# DEPLOY-V1-001: App Platform delivery

## Approved target

- Backend: `https://api.globalresourcesdirect.com`, App Platform app `grd-dashboard-be`, region `nyc`.
- Frontend: separate static-site app `grd-dashboard-fe` at `https://app.globalresourcesdirect.com`.
- Existing managed PostgreSQL cluster: `dbaas-db-4718274`, NYC1, PostgreSQL 18; database `grddb`, user `grdadmin`.
- Move existing GRD data after a successful test restore. UPS, EchoShip and FFE remain enabled. Quote comparison stays disabled in both backend processes.

This supersedes the earlier hosting deferral for configuration preparation only.
No infrastructure, DNS, credentials, database contents or running workers are
changed by this implementation. The existing LAN release remains available.

## Pipeline

`.github/workflows/ci.yml` copies the Tom applications' quality/secret gates,
immutable releases, serialized deployment, superseded-main check, and external
HTTP verification. GRD retains its Node/pnpm versions and fixture-based tests.
The backend runs combined coverage and a separate disposable container lifecycle
gate before publishing `ghcr.io/jeffrey125/grd-dashboard-be:<commit>`.
The API, worker and PRE_DEPLOY migration job all use the same image digest.

The production deployment job additionally requires the **repository variable**
`APP_PLATFORM_DEPLOY_ENABLED=true`. Leave it unset until the rollout blockers
below have been resolved. Defining it only as an environment variable is too late
for the job-level condition. Publishing an image on main does not deploy it.
Do not enable App Platform's independent source/image autodeploy.

Deployment uses the official `digitalocean/app_action/deploy` action. Its spec
substitution injects GitHub settings; database bindings resolve in App Platform.
Build/deploy logs are not copied into Actions. Only public HTTP outcomes and the
successful release digest are recorded. The spec is authoritative: dashboard-only
configuration changes must also be incorporated here before a subsequent release.

## GitHub settings

Create a `production` environment in each repository. Apply the desired branch
restriction to `main` and keep any environment approval rules explicit.

| Location            | Name                                                     | Value / purpose                                                                                                                       |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Repository variable | `APP_PLATFORM_DEPLOY_ENABLED`                            | Initially unset; `true` only after rollout approval and blockers are resolved.                                                        |
| Production variable | `DIGITALOCEAN_PROJECT_ID`                                | Intended GRD project UUID. The database may remain in its existing project.                                                           |
| Production secret   | `DIGITALOCEAN_ACCESS_TOKEN`                              | Token authorized to manage the intended App Platform app and attach its existing database. Confirm required scopes before creation.   |
| Production secret   | `GHCR_CREDENTIALS`                                       | Backend only: `username:read-package-token` for persistent private-image pulls. Do not use the expiring workflow `GITHUB_TOKEN` here. |
| Production secret   | `AUTH_SECRET`                                            | Backend only; retain the current value if preserving existing sessions is intended. Minimum 32 characters.                            |
| Production secrets  | `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`                     | Production UPS credentials. The spec selects production explicitly.                                                                   |
| Production secrets  | `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, `ECHOSHIP_PASSWORD` | Existing EchoShip tracking configuration.                                                                                             |
| Production secrets  | `FFE_URL`, `FFE_USERNAME`, `FFE_PASSWORD`                | Existing FFE tracking configuration.                                                                                                  |

Do not paste credentials into tickets, chat, committed files or build arguments.
No quote-provider credentials are needed while comparison is disabled. Optional
ntfy alerts are not enabled by this spec; add the approved destination if required.
The frontend has its own settings documented in its App Platform guide.

## Runtime and database

The spec attaches the **existing** cluster/database/user; it does not request a new
database cluster. Database bindings supply host, port, password and CA. Each
process writes the CA into a private file under `/tmp` before starting Node, using
`umask 077`; `DB_SSL_MODE=verify-full` verifies certificate and hostname. The
separate DB fields preserve literal passwords. The runtime remains non-root.

`db.HOSTNAME` is used as supplied by DigitalOcean. Do not claim private routing:
VPC selection and endpoint reachability still need verification. Add only the
approved app as a trusted source; do not disable trusted-source restrictions.
Use the direct database endpoint, not a transaction pooler, because auth/SSE use
session connections. Each process has a ten-connection pool; include migration
and replacement processes when assessing the shared cluster's headroom.

The migration job runs the compiled TypeORM CLI with production dependencies;
no build tools or pnpm are required in the runtime image. It runs before new API
and worker instances. Changes must remain compatible with the old runtime during
rollout. The job must never be used to copy or overwrite existing production data.

One API and one worker are configured, with a 60-second termination grace period.
The provisional API/migration size is 1 GiB; worker size is 2 GiB for Chromium.
These are preparation defaults, not measured capacity or spending approval.
The worker has no HTTP health port; API health does not prove scheduler health.

## Required before enabling deployment

1. **Ingress client IP:** adapt and verify login rate limiting for App Platform's
   `do-connecting-ip` header. Current `AUTH_TRUST_PROXY=false` is retained rather
   than trusting arbitrary forwarded headers. Public rollout is blocked until
   the ingress trust boundary is implemented and tested.
2. **Worker replacement:** prove that the rollout never runs two tracking workers
   against the same database. `instance_count: 1` is not proof of no deployment
   overlap. Select a supported stop/start procedure or implement reviewed
   database-backed singleton ownership before enabling automated backend rollout.
   Verify browser child-process cleanup and scheduler failure monitoring.
3. **Database:** inspect source PostgreSQL version/size/extensions, destination
   permissions and existing contents, cluster CPU/RAM/storage/connection headroom,
   backups and restore access. This is a shared 1 GiB primary-only cluster; do not
   alter other applications' users, databases or settings.
4. **Migration rehearsal and cutover:** restore a consistent dump to a disposable
   target first; check migrations, row counts, identities and representative
   shipments/accounts. For final cutover, pause writes and stop the LAN worker,
   take the final backup, restore only the approved target, apply pending
   migrations and verify before starting the new worker. Keep the source backup.
   Once new writes occur, switching back requires reconciliation, not just DNS.
5. **External acceptance:** verify secrets, registry access, app/project ownership,
   domains/TLS/DNS, actual-domain login/password change/logout, credentialed CORS
   and SSE, all enabled carriers, worker scheduling, image security and resource
   usage. Public smoke scripts are necessary but do not replace these checks.

## Rollback and evidence

The action waits for deployment completion; `scripts/check-app-platform.sh` then
requires readiness, quote comparison disabled and unauthenticated shipments denied.
A failed check fails CI. No automatic database rollback is attempted. Recover with
an explicitly reviewed compatible previous image/spec or a fix merged to main;
restoring old code does not reverse migrations.

Local schema validation checks field structure, not account permissions, plan
availability, credentials, DNS, private connectivity, or platform behavior.
Never pass rendered secret-bearing specs to commands that print them. Validate
only templates or disposable placeholders, and keep diagnostic captures outside
Git and the Docker context.

References: [deployment action](https://github.com/digitalocean/app_action),
[app specification](https://docs.digitalocean.com/products/app-platform/reference/app-spec/),
[client IP](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/),
[CA delivery](https://docs.digitalocean.com/support/can-i-inject-certificates-or-other-files-into-my-app-at-build-time/).
