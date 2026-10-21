# GRD Dashboard backend

Employee-only Shipment monitoring with a Nest API, one separate tracking worker,
and PostgreSQL. UPS, EchoShip and FFE tracking are implemented; Carrier I/O is
fixture-driven in automated tests.

## Start here

- [Frontend handoff](docs/v1/frontend-handoff.md): actual routes, browser auth,
  events, screen behavior and missing response fields.
- [Release readiness](docs/v1/release-readiness.md): acceptance audit, security
  boundaries, test evidence and rollout gates.
- [V1 specifications](docs/v1/README.md), [domain glossary](CONTEXT.md).

## Prerequisites

Use Node **24.21.0** (`.nvmrc`) and pnpm **12.11.2** (`packageManager`). Install
Docker Engine with Compose v2+ for containers and Testcontainers. Tests use
PostgreSQL 18.3; the managed server's exact version must be verified before rollout.
TLS integration fixtures also require the `openssl` executable.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
```

The second command installs browser fixtures/OS libraries and may need elevated
OS-package permissions. The Docker image installs its own matching Chromium.
Do not run concurrent builds while process tests use `dist/`.

## Local Docker: API + database

1. Copy `.env.docker.example` to `.env.docker` and set `AUTH_SECRET` using
   `openssl rand -hex 32`. This file is Git-ignored. Never copy real production
   database settings into the local Compose file.
2. Start the API. The database becomes healthy, the one-shot migration exits
   successfully, and only then does the API start:

   ```sh
   docker compose --env-file .env.docker -f docker-compose.dev.yml up --build -d api
   curl --fail http://localhost:3000/api/v1/health/ready
   ```

3. Bootstrap the initial Admin in an interactive terminal:

   ```sh
   docker compose --env-file .env.docker -f docker-compose.dev.yml exec api node dist/auth-cli.js bootstrap
   ```

   Password entry is hidden. Replace the issued password after sign-in, then sign
   in again. Use `recover` instead of `bootstrap` only for an existing Admin.

4. The worker is opt-in. Fresh seeds enable all three Carriers, so supply their
   credentials or disable unused Carriers through the authenticated Admin API
   before starting it. **Starting a configured worker permits live Carrier I/O.**

   ```sh
   docker compose --env-file .env.docker -f docker-compose.dev.yml --profile worker up -d worker
   docker compose --env-file .env.docker -f docker-compose.dev.yml logs -f worker
   ```

5. Stop without deleting database data:

   ```sh
   docker compose --env-file .env.docker -f docker-compose.dev.yml --profile worker down
   ```

API origin: `http://localhost:3000`; API base path: `/api/v1`; intended local frontend origin:
`http://localhost:5173` (frontend is not included). Bindings are loopback-only;
PostgreSQL has no published host port. `GRD_API_PORT` changes the API host port;
update `AUTH_BASE_URL` to match. Use `localhost` consistently in browser URLs.
The named database volume survives `down`; `down --volumes` permanently removes
that local database and is not a normal shutdown command.

The image defaults to production, but local Compose explicitly uses development
for HTTP browser cookies. It is **not production deployment configuration**.
The worker has no HTTP listener: observe `application.ready`, scheduler state and
safe logs. Never scale it beyond one replica.

## Native development

Configure `.env` from `.env.example` with a separately provisioned local database.
Compose's database is private to its network; do not assume a host port exists.

```sh
pnpm migration:run
pnpm auth:bootstrap
pnpm start:dev
# In another terminal, after configuring enabled Carriers:
pnpm start:worker:dev
```

`start:dev:pretty` and `start:worker:dev:pretty` opt into local pretty logs.
`pnpm build`, `pnpm start:prod` and `pnpm start:worker:prod` run compiled code;
set `NODE_ENV=production` explicitly for native production processes.

## Environment

Use `.env.example` for the complete native template and `.env.docker.example`
only for local Compose interpolation. Neither template contains real secrets.
Values injected by the host take precedence over dotenv configuration.

| Settings                                                          | Required behavior                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `LOG_LEVEL`, `PORT`                                   | Environment: development/test/production; log levels debug/info/warn/error/silent; port defaults 3000. Production logs default info and JSON.       |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`         | Required separate connection fields; port defaults 5432. Password is preserved literally. No database URL interpolation.                            |
| `DB_SSL_MODE`                                                     | `disable` (local default) or `verify-full`; no insecure TLS mode or plaintext fallback. Explicitly select verify-full for managed PostgreSQL.       |
| `DB_SSL_CA_FILE`                                                  | Optional readable PEM CA bundle, max 64 KiB, valid only with verify-full. Mount the provider CA read-only; when omitted Node's trusted roots apply. |
| `AUTH_SECRET`, `AUTH_BASE_URL`, `AUTH_TRUSTED_ORIGINS`            | API/CLI only: random secret ≥32 characters, API origin, comma-separated exact frontend origins. HTTPS required in production.                       |
| `AUTH_TRUST_PROXY`                                                | `false` by default, or `loopback` for a trusted local proxy only. No arbitrary forwarded-header trust.                                              |
| `UPS_ENVIRONMENT`, `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`           | Worker, enabled UPS only. CIE default; production must be explicit.                                                                                 |
| `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, `ECHOSHIP_PASSWORD`          | Worker, enabled EchoShip only. Use `https://echoship.com/login`.                                                                                    |
| `FFE_URL`, `FFE_USERNAME`, `FFE_PASSWORD`                         | Worker, enabled FFE only. Use `https://www.ffeinc.com/Customer/ShipmentTracking`.                                                                   |
| `ECHOSHIP_BROWSER_EXECUTABLE_PATH`, `FFE_BROWSER_EXECUTABLE_PATH` | Optional system Chromium overrides; normally omit and use the matching installed Playwright browser.                                                |
| `NTFY_URL`                                                        | Worker only, optional HTTP(S) topic without URL credentials/query/fragment. Use HTTPS for real alerts; blank disables publishing.                   |

TLS uses the installed [node-postgres SSL support](https://node-postgres.com/features/ssl)
and Node certificate/hostname verification. The API, worker, migrations, auth CLI
and API event listener use the same database configuration. Download the actual
managed database's CA and use its matching DNS hostname, not an arbitrary IP.
Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable verification on errors.
Use a direct/session-capable PostgreSQL connection: SSE uses `LISTEN`, which must
not be routed through transaction pooling.

## Migrations and container commands

Native reviewed-schema workflow:

```sh
pnpm migration:show
pnpm migration:run
pnpm schema:log
```

`pnpm migration:create <path>` creates a blank migration; `pnpm migration:generate
<path>` compares against the configured DB. Review generated SQL before applying.
`pnpm migration:revert` undoes one migration and can remove data: use disposable
databases for full rollback testing. `synchronize`, `migrationsRun`, and
`dropSchema` remain false. Migration privileges are an operator responsibility.

```sh
docker build -t grd-dashboard-be:local .
# Commands inside the image (runtime environment must be supplied separately):
node dist/main.js
node dist/worker.js
node node_modules/typeorm/cli.js migration:run -d dist/infrastructure/database/data-source.js
node dist/auth-cli.js bootstrap
node dist/auth-cli.js recover
```

Run migrations once before API/worker rollout, never simultaneously in each
replica. The image contains production dependencies, matching Chromium and built
code, runs as non-root `node`, and excludes dotenv, source, tests and local
artifacts. It has no embedded credentials or default production settings. Use an
init process and at least 40 seconds stop grace; the worker allows 30 seconds for
cleanup. Chromium needs adequate shared memory (local Compose gives the worker
1 GiB); actual production resource sizing remains unmeasured.

## Verification and coverage

| Command                 | Scope                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`            | Format, zero-warning Oxlint, typecheck, unit tests, production build.                                                                  |
| `pnpm test:cov`         | Fast **unit-only** coverage; preserves existing CI semantics.                                                                          |
| `pnpm test:cov:all`     | Build + unit, integration and e2e with combined V8 coverage. Requires Docker, Chromium and OpenSSL.                                    |
| `pnpm test:integration` | Build + real PostgreSQL, native HTTP, browser and process tests.                                                                       |
| `pnpm test:e2e`         | Build + authenticated HTTP/SSE tests.                                                                                                  |
| `pnpm test:container`   | Opt-in image/Compose lifecycle check; creates and removes a uniquely named disposable DB volume and test image. No live Carrier calls. |
| `pnpm audit --prod`     | Published production dependency advisory check; not a complete security audit.                                                         |

Coverage HTML is `coverage/index.html`; the most recent coverage command replaces
the report. Unit coverage includes source principally exercised by integration
tests, explaining the lower unit-only number. Combined V8 still does not measure
compiled child-process/CLI/container execution; those have separate assertions.
No source was excluded merely to improve the score. See the release report for
measured results rather than treating any percentage as proof of correctness.

## Production status

Hosting is not selected. Caddy, production Compose, App Platform specifications,
deployment and new CI/CD workflows are deferred. The existing CI workflow is
unchanged. Intended origins remain `api.globalresourcesdirect.com` (BE) and
`dashboard.globalresourcesdirect.com` (FE), with DigitalOcean managed PostgreSQL.

One API and one worker are required for v1; memory-only auth throttles and provider
rate limits are not multi-replica-safe. See the [release gates](docs/v1/release-readiness.md)
before rollout, including trusted proxy/client-IP handling, TLS/CA mounting,
migration control, backups, monitoring, and remaining frontend API gaps.

### Quote comparisons (SQ-V1-003)

Apply the reviewed quote migration before using `/api/v1/quote-comparisons`.
Saving explicit senders needs only the API and PostgreSQL. Account-default refresh
also needs the existing worker process, Playwright Chromium, and environment-only
`AMAZON_SHIPPING_EMAIL`, `AMAZON_SHIPPING_PASSWORD`, `MYUNISHIPPERS_EMAIL`, and
`MYUNISHIPPERS_PASSWORD`. The worker refreshes sender details without requesting
rates. Authentication challenges or missing/default-address contracts require
explicit sender entry; no account address is modified. See the frontend handoff
for full input/response shapes, refresh lifetime, and failure behavior.

New comparisons now queue provider attempts in the save transaction. The single
worker scans every second, executes up to two different accounts concurrently,
and limits each attempt to 90 seconds within a 120-second lease. One expired
lease is recovered; the next expiry is terminal. Old `saved` comparisons remain
unchanged; use Copy to new to execute them. Apply migrations
`1792627200000-QuoteExecution`, `1792713600000-AmazonQuoteBreakdown`, and
`1792800000000-OptionalPackageDimensions` before starting the updated API/worker.

The Amazon and myUnishippers rate adapters are available through each provider's
selected execution mode. myUnishippers request mode uses the authenticated in-page
`/svc/shopFlow` estimate contract and supports native multi-package shipments. Browser
mode drives the full small-package form with native package quantities, addresses,
contact names/phone numbers, and the selected ship date. It does not use Quick Quote.
When request mode is the only selected provider, all three dimensions may be left
blank; the request omits `billedDimension`. Weight remains required, partial dimensions
are rejected, and browser, Amazon, or mixed-provider comparisons require dimensions.
Explicit sender and receiver contact details are required for browser mode; missing
details produce `contact_details_required`. Both
paths keep session material in worker memory, preserve the refreshed sender snapshot,
and never perform purchase, label, pickup booking, or address-book writes. The native
browser flow retrieves pickup offers but never orders one. For a local
demonstration only, set `QUOTE_DEMO_MODE=true`:
production configuration rejects it. Optional `QUOTE_DEMO_AMAZON` and
`QUOTE_DEMO_UNISHIPPERS` select `success`, `validation_failed`, `unsupported`,
`timeout`, `auth_replay`, `authentication_failed`, or `failed`. Defaults are
Amazon success and myUnishippers validation failure. Simulated results remain
labelled in saved history, even after demo mode is disabled. Demo mode replaces rate
execution only; account-default refresh and tracking retain their live behavior.
To opt in to a quote-only production-adapter smoke, configure the provider's two
credentials in `.env` and run `pnpm test:shipping-quotes:adapter:live`. It tests two
packages for both providers in each mode, reads the account origin in memory, and
prints only outcomes, relogin counts, totals, currencies, and estimate methods.
Use `-- --provider amazon --mode browser` to select one check. Missing credentials,
failed sender/login resolution, and unsuccessful rates exit nonzero; each mode is
reported independently. It uses comparison-only test company/contact values and never books.
The isolated harness below avoids provider I/O. Existing tracking-worker credential/enablement
requirements still apply when starting the complete worker.

An isolated full-stack demo (disposable PostgreSQL, no tracking/provider I/O) is
available through the frontend harness after `pnpm build` here:
`FE_TEST_QUOTE_DEMO=true FE_TEST_API_PORT=3013 node scripts/auth-backend.mjs`
from `../grd-dashboard-fe`. Start its UI with
`VITE_API_ORIGIN=http://localhost:3013 pnpm exec vite --host localhost --port 5173 --strictPort`.
The fixture account is `frontend-staff@example.test` / `staff fixture password`.

The [SQ-V1-009 readiness matrix](docs/v1/shipping-quotes-readiness.md) records
offline acceptance, real worker crash recovery, privacy scope, live-provider
blockers, and reproducible commands. Live checks are opt-in and never part of
ordinary offline CI.

### Quote history and retry (SQ-V1-007)

Apply `1792972800000-QuoteHistoryRetry` before starting the updated API/worker.
Staff can retry eligible technical failures with immutable original input; validation
and unsupported outcomes use Copy to new comparison. Admins can soft delete completed
or failed history and restore it from the Deleted history view. All attempts and
rates remain stored. No external provider call occurs during deletion/restoration.
Provider expiry or current configured stale hours determines freshness, and only
fresh equivalent rates receive Lowest price.

The isolated browser lifecycle check uses an immediate simulated technical failure:
from the frontend, build with `VITE_API_ORIGIN=http://localhost:3014 pnpm build`, then
run `FE_TEST_API_PORT=3014 FE_TEST_QUOTE_DEMO=true FE_TEST_QUOTE_RETRY=true pnpm exec
playwright test --config playwright.backend.config.ts e2e-backend/quote-history.spec.ts`.
No production worker, provider login, or credentials are used.

### Quote provider administration (SQ-V1-008)

Apply migration `1793059200000-ProviderAdministration` before starting the updated
API/worker. Admins use `/admin/shipping-providers` in the frontend for mode, availability,
maintenance, stale policy, readiness checks and default refresh. The existing worker
runs readiness jobs; the API never launches provider browsers. No new environment
variables or production dependencies are required. Demo mode fails readiness safely
rather than contacting providers. Live sample-rate tests belong to SQ-V1-009.

Stale policy now defaults to one hour (1–168 configurable), including existing quotes
without provider expiry. Default refresh and mode-test validity are 15 minutes.

### Amazon manual-session recovery

The opt-in [Amazon reconnection guide](docs/v1/amazon-session-recovery.md) describes
an operator-only SSH workflow to complete Amazon CAPTCHA/MFA and save encrypted
authentication state outside the checkout. Quote and readiness adapters restore it
across worker/browser restarts, while obtaining fresh request tokens per operation.
Missing, expired or rejected sessions return `verification_required` without
automatic password retries. There are no new dependencies or database migrations.
The saved session is valid for at most 12 hours; Amazon can require verification
sooner. Existing account-default refresh uses its separate legacy login flow.

Staff can complete supported Amazon challenges using **Verify Amazon & retry**
on a failed comparison. This needs the optional private API/worker Unix socket
and writable worker session storage described in the
[staff setup guide](docs/v1/amazon-session-recovery.md#staff-verification-in-the-dashboard).
The API does not receive Amazon credentials or saved cookies. The feature is not
enabled or deployed merely by building the code.
