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

Production deployment is automatic after a successful image publication on
`main`, including manual workflow runs on `main`. Pull requests and other
branches do not deploy. No deployment-enable repository variable is required.
Quality, container and secret checks, serialized deployments, and the
superseded-main check remain in place. Do not enable App Platform's independent
source/image autodeploy. A successful deployment does not replace the live
acceptance and data-cutover checks below.

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

## Sync production secrets from a local file

Run `pnpm sync:production-env --dry-run`, then `pnpm sync:production-env`.
The default source is `.env.production` in the repository root; use `--file PATH`
for another file. This local file is excluded from Git and Docker builds. Keep
its permissions at `0600` and never paste its contents into logs or chat.

Include the nine authentication/carrier secret names in the table above.
Use `AUTH_SECRET` (the LAN Compose environment calls its source `GRD_AUTH_SECRET`).
Quote values containing spaces or `#`. The script uses Node's built-in dotenv
parser, does not expand shell expressions, and sends each value to GitHub CLI
through standard input. Unknown names, missing required values, short auth
secrets, and oversized values fail before uploading.

`DIGITALOCEAN_ACCESS_TOKEN` and `GHCR_CREDENTIALS` are optional in this file:
blank or absent entries preserve their existing GitHub secrets. GitHub cannot
return existing secret values; paste those two tokens locally if you want this
file to contain all secrets. Project ID remains a GitHub environment variable
and is not synced by this command. Database bindings remain in the
App Platform spec, not this file.

Requires an authenticated `gh` CLI with access to this repository. Uploads target
only `jeffrey125/grd-dashboard-be` / `production`. Uploads are sequential, not
transactional; on failure, earlier settings may have been updated. Rerun after
correcting access. Syncing does not deploy or enable deployment.

Run `pnpm test:production-env` for fixture-only tests of the sync command.

## Runtime and database

The spec attaches the **existing** cluster/database/user; it does not request a new
database cluster. Database bindings supply port, password and CA; `DB_HOST`
selects the existing cluster's private DNS endpoint explicitly. Each
process writes the CA into a private file under `/tmp` before starting Node, using
`umask 077`; `DB_SSL_MODE=verify-full` verifies certificate and hostname. The
separate DB fields preserve literal passwords. The runtime remains non-root.
Startup commands use `printenv DB_CA_CERT` and reject blank certificate files
before starting Node. Do not reference `$DB_CA_CERT` in these commands: the
deployment action expands shell-style variables while rendering the spec,
before App Platform supplies runtime bindings, which would erase the value.

The spec selects the dedicated NYC1 VPC `d65699ce-4000-4c53-bb2c-ed7fe9e4fd49`
(`grd-nyc1`, `10.116.16.0/20`) and the cluster's verified private hostname.
The shared database remains in `default-nyc1`
(`aa46fc89-0a92-457d-be8f-0d88354918e5`, `10.116.0.0/20`). The approved peering
`grd-to-default-nyc1` (`c67d272f-8287-45d7-b91a-8f55f2fe6b66`) was verified
`ACTIVE` on 2026-10-28. Existing database trusted-source rules were preserved.
Peering enables routing between the networks;
database trusted-source restrictions still control database access. A separate
app VPC does not isolate the shared database's compute or connection capacity.
This uses native
App Platform configuration without changing application code or parsing a
connection URL. If the cluster is replaced, update this hostname and the
database attachment together. Live reachability from App Platform still needs
verification after app creation. Add only the app's VPC egress private IP to
the database trusted sources, preserving existing rules; do not disable
trusted-source restrictions. The egress IP becomes available after app creation;
the initial migration/deployment may need retrying after that rule is added.
Use the direct database endpoint, not a transaction pooler, because auth/SSE use
session connections. Each process has a ten-connection pool; each waiting or active worker also holds
one dedicated ownership connection. Include migration
and replacement processes when assessing the shared cluster's headroom.

The migration job runs the compiled TypeORM CLI with production dependencies;
no build tools or pnpm are required in the runtime image. It runs before new API
and worker instances. Changes must remain compatible with the old runtime during
rollout. The job must never be used to copy or overwrite existing production data.

One API and one worker are configured, with a 60-second termination grace period.
The provisional API/migration size is 1 GiB; worker size is 2 GiB for Chromium.
These are preparation defaults, not measured capacity or spending approval.
The worker has no HTTP health port; API health does not prove scheduler health.

## Required before accepting live traffic

1. **Ingress client IP:** the spec selects `AUTH_TRUST_PROXY=digitalocean`.
   Login limits use a validated `do-connecting-ip`, retaining Nest's IPv6 grouping.
   Other forwarded headers cannot select that counter. Missing/malformed client
   headers fail closed for login. Fixture HTTP tests cover limits and spoofed
   `X-Forwarded-For`; verify actual ingress header replacement and lack of a
   direct public bypass before accepting live traffic.
2. **Worker replacement:** the entrypoint obtains a database-local PostgreSQL
   session advisory lock before creating the Nest context. A contender waits
   without starting recovery, quote timers, or tracking. The old process keeps
   ownership through shutdown and releases it by exiting; total shutdown is
   bounded at 40 seconds. Connection errors/end or failed heartbeats terminate
   the holder immediately; a failed tracking scheduler also exits for restart.
   Logs distinguish `worker.ownership.waiting`, `.acquired`, `.lost`, and
   `worker.scheduler.failed`. Do not use a transaction pooler. Test actual App
   Platform replacement and restart behavior before enabling automatic rollout.
   The existing LAN image predates this lock and must be stopped at cutover.
   This prevents cooperative deployment overlap; it is not exactly-once delivery
   or database fencing. A partition/stalled event loop can delay loss detection
   (heartbeat every 2 seconds, query timeout 5 seconds), and already-sent carrier
   requests cannot be recalled. Never start workers via a different entrypoint
   that bypasses ownership. API composition does not acquire this lock. The
   ownership connection fails startup immediately if unavailable; platform
   restart handles retry. Once owned, the existing application pool keeps its
   three connection attempts. Graceful worker shutdown exits with code 0 after
   running Nest hooks; the API retains Nest signal forwarding.
3. **Database:** inspect source PostgreSQL version/size/extensions, destination
   permissions and existing contents, cluster CPU/RAM/storage/connection headroom,
   backups and restore access. On 2026-10-28, the approved resize completed:
   2 GiB RAM, 1 vCPU, 30 GiB storage, one node, and 47 non-reserved PostgreSQL
   connections (50 total minus 3 reserved), verified over TLS. Existing workload
   held 10 connections, plus one management connection, at verification time.
   This remains a shared primary-only cluster; do not
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

Private networking: [App Platform VPC configuration and database trusted sources](https://docs.digitalocean.com/products/app-platform/how-to/enable-vpc/).
