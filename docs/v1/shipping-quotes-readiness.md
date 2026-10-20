# SQ-V1-009 quote readiness

## Release status

Offline verification results are recorded in the
[implementation summary](implementation-summary/SQ-V1-009-implementation-summary.md).
A sanitized live myUnishippers browser smoke returned seven USD services for a
quantity-two shipment with calculated totals. Amazon and the configured request
mode were not rerun against live providers after this change. Production deployment
and hosting approval are separate.

## Acceptance evidence

| Requirement                                                                     | Executable evidence                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty PostgreSQL migration, reverse/reapply, independent API/worker             | `test/integration/database.spec.ts`, `schema.spec.ts`, `runtime.spec.ts`, `test/container/runtime.test.ts`                                                                                                        |
| Staff create/history, immutable inputs, contacts, duplicate submissions         | `test/e2e/shipping-quotes.spec.ts`, frontend `e2e-backend/quotes.spec.ts`, `quote-readiness.spec.ts`                                                                                                              |
| Partial SSE results, reconnect snapshot refetch, authenticated/isolated streams | Backend shipping-quotes e2e; frontend `quote-live.test.ts`, `e2e-backend/quote-readiness.spec.ts`                                                                                                                 |
| Retry, stale/expiry, admin delete/restore                                       | `test/integration/quote-execution.spec.ts`, frontend `e2e-backend/quote-history.spec.ts`                                                                                                                          |
| Admin mode test/save, maintenance, stale policy, defaults                       | `test/e2e/provider-admin.spec.ts`, frontend `e2e-backend/provider-settings.spec.ts`                                                                                                                               |
| Both provider modes, multiple groups, correlation and mutation guards           | `amazon-quote.adapter.spec.ts`, `unishippers-quote.adapter.integration.spec.ts`, `test/integration/shipping-quotes-contracts.spec.ts`                                                                             |
| Real worker crash and restart; account exclusion; cross-provider parallelism    | `test/integration/quote-readiness.spec.ts`: two providers running together, later same-account work queued, SIGKILL, new worker, natural 120-second lease expiry, exactly one recovery, subsequent work completes |
| Repeated recovery exhaustion, stale owner fencing, bounded relogin              | `quote-execution.spec.ts`, `quote-executor.spec.ts`                                                                                                                                                               |
| Calculated Amazon and calculated myUnishippers Quick Quote totals               | Adapter fixtures and frontend `e2e-backend/quote-readiness.spec.ts` with two groups                                                                                                                               |
| International/options fail closed while original units remain visible           | API shipping-quotes e2e, adapter/schema tests, frontend readiness browser test                                                                                                                                    |
| Privacy                                                                         | Raw-error canary through executor/persistence/API, allowlisted SSE keys, worker log exclusions, logging e2e, manual review of changed fixtures and live output                                                    |
| No purchase/label/booking/pickup/address-save/shipment action                   | Frontend readiness browser assertions, provider write guards, manual quote UI review                                                                                                                              |

Provider fixtures substitute only external provider I/O. Full-stack readiness
fixtures exercise real PostgreSQL, authenticated API, worker execution, SSE, and UI,
but do not prove live provider capability.

## Commands

Run from the backend with the pinned Node/pnpm versions and installed dependencies:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:cov:all
pnpm test:container
pnpm exec vitest run --project integration test/integration/quote-readiness.spec.ts
pnpm exec tsc --ignoreConfig --noEmit --module nodenext --moduleResolution nodenext --target ES2023 --types node --strict --esModuleInterop --skipLibCheck test/support/shipping-quotes/live-adapter-smoke.mts
```

The combined coverage command builds and executes unit, integration and e2e projects.
PostgreSQL tests require Docker; the real lease test takes about 130 seconds. Container
checks are opt-in through their separate package scripts.

Run from the frontend:

```sh
pnpm run ci
VITE_API_ORIGIN=http://localhost:3000 pnpm build
pnpm exec playwright test --config playwright.backend.config.ts
VITE_API_ORIGIN=http://localhost:3016 pnpm build
FE_TEST_API_PORT=3016 FE_TEST_QUOTE_DEMO=true FE_TEST_QUOTE_RETRY=true pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/quote-history.spec.ts
FE_TEST_API_PORT=3016 FE_TEST_PROVIDER_ADMIN=true pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/provider-settings.spec.ts
FE_TEST_API_PORT=3016 FE_TEST_QUOTE_DEMO=true pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/quotes.spec.ts
FE_TEST_API_PORT=3016 FE_TEST_QUOTE_READINESS=true pnpm exec playwright test --config playwright.backend.config.ts e2e-backend/quote-readiness.spec.ts
pnpm test:container
pnpm test:container:http
```

The complete legacy backend browser suite requires port 3000; selected quote
suites support `FE_TEST_API_PORT`. Run each browser command sequentially: the harness reserves ports 4175/4176.
Run admin and history scenarios in separate harnesses: the admin scenario intentionally
leaves a provider disabled. The default backend suite skips opt-in worker scenarios; the following targeted
commands explicitly execute those scenarios. Readiness fixture mode changes only
its disposable database's myUnishippers mode and uses synthetic rates.

## Startup and operational limits

The root README owns complete environment configuration, fresh database setup and
bootstrap instructions. Run `pnpm migration:run` against the intended empty local
database, then start `pnpm start:prod` and `pnpm start:worker:prod` in separate
processes. Build first with `pnpm build`. Start the frontend separately with
`VITE_API_ORIGIN=http://localhost:3013 pnpm dev --host localhost --port 5173`.
Verify `/api/v1/health/ready` and the frontend URL.

Core environment names: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DB_HOST`, `DB_PORT`,
`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_MODE`, `DB_SSL_CA_FILE`, `AUTH_SECRET`, `AUTH_BASE_URL`,
`AUTH_TRUSTED_ORIGINS`. Production TLS uses `verify-full` and the documented CA
configuration. Existing tracking adapter requirements still apply to the complete
worker; disable tracking carriers in disposable acceptance databases.

Provider credentials are environment-only: `AMAZON_SHIPPING_EMAIL`,
`AMAZON_SHIPPING_PASSWORD`, `MYUNISHIPPERS_EMAIL`, `MYUNISHIPPERS_PASSWORD`.
`QUOTE_DEMO_MODE`, `QUOTE_DEMO_AMAZON`, and `QUOTE_DEMO_UNISHIPPERS` are local-only;
demo mode is rejected in production and does not disable tracking or live default
refresh. Use the isolated frontend harness for demonstrations without provider I/O.

One API and one worker are supported. Accounts serialize quote/default/readiness
work; distinct providers can run together. Attempts have a 90-second execution
deadline and a 120-second lease; recovery is allowed once. Authentication expiry
allows one relogin/replay. There is no automatic mode fallback. Defaults/readiness
expire after 15 minutes; stale-rate policy is 1–168 hours, default 1 hour.

Amazon international/options remain unsupported. myUnishippers Quick Quote supports
domestic US shipments dated today in America/New_York without signature or insurance
options. A myUnishippers-only comparison may omit all dimensions; partial dimensions
and Amazon-inclusive comparisons remain invalid. Weight is always required. Rate
output retains native currency; no currency or landed-cost conversion occurs. Unknown
duty/tax/clearance remains unknown.

## Privacy decision

Required sender/recipient addresses and contact details remain in authenticated
comparison snapshots and sender-default records. This preserves immutable history
and retries. Internal relational IDs and employee audit identities are expected
business data; external provider-account identifiers, credentials, cookies, tokens,
browser storage and raw payloads are forbidden persisted diagnostics.

Logs, SSE, errors and live captures exclude personal contacts. Tracked contact
fixtures are synthetic. Live smoke output includes no provider free-text service
names, raw exceptions, addresses or account context. Browser traces/screenshots
remain disabled for authenticated acceptance.

## Live smoke and troubleshooting

```sh
pnpm test:shipping-quotes:adapter:live
pnpm test:shipping-quotes:adapter:live -- --provider amazon --mode browser
```

These opt-in commands transmit the account origin and synthetic shipment/contact
data to providers. They never purchase, book, schedule pickups or save addresses.
They read `.env`; ordinary tests do not. Do not paste credentials into terminal
arguments or store raw errors to investigate a failed run.

Current observed outcomes:

| Provider      | Mode    | Outcome                                                               |
| ------------- | ------- | --------------------------------------------------------------------- |
| Amazon        | request | Not rerun after the Quick Quote change                                |
| Amazon        | browser | Not rerun after the Quick Quote change                                |
| myUnishippers | request | Not rerun after both configured modes adopted Quick Quote             |
| myUnishippers | browser | Success: seven USD services; quantity two; calculated estimate totals |

`credentials_missing` means the selected credential pair is absent. Safe failure
summaries do not distinguish every provider, browser or network cause; do not infer
more than the reported outcome. Authentication failure after one relogin is terminal;
do not add automatic retries. Docker permission failures and occupied test ports are
environment failures, not proof of product defects. Never disable database TLS
verification to bypass a failure.

## Deferred scope

Purchase, labels, booking, pickup ordering, provider-address persistence, shipment
creation, freight, other providers, automatic FX/landed cost, permanent purge,
cancellation, external queues and multi-replica scaling remain deferred. This
ticket does not deploy, change CI/CD, choose hosting, or publish artifacts.
