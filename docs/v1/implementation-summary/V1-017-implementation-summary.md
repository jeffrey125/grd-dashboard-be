# V1-017 implementation summary

## Summary

Implemented one structured logging system for the API and worker. Production
records are newline-delimited JSON with a stable service identity, explicit
runtime and component fields, generated request correlation IDs, safe error
projection, centralized redaction, and controlled levels. Application modules
use the project-owned `ProjectLogger`; Pino imports remain inside logging
infrastructure.

The implementation is complete in the working tree. No ticket changes have been
staged, committed, merged, tagged, or pushed.

## Changes Made

### Approved dependencies and architecture

| Package       | Version | Role and tradeoff                                                                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pino`        | 10.4.0  | Fast JSON logger and redaction engine. Application code is insulated by the project interface.                                        |
| `pino-http`   | 11.0.0  | Generates request context and exactly one completion record. Its default request/response serializers are disabled.                   |
| `nestjs-pino` | 5.3.1   | Connects Pino request context and Nest's logger. This avoids a custom AsyncLocalStorage implementation but adds an integration layer. |
| `pino-pretty` | 13.2.0  | Development-only opt-in formatting. It is not loaded by either production entry point.                                                |

The pinned versions support the repository's Node 24 and Nest 12 versions.
`nestjs-cls`, Winston, file transports, and network transports were not added.
The API and worker remain separate processes from the same package/image; this
ticket does not introduce a new service or split feature code between runtimes.

### Record and level contract

Every project record includes `timestamp`, string `level`, `service`,
`environment`, `runtime`, `component`, `event`, and `message`. The service is
always `grd-dashboard-be`; runtime is `api` or `worker`. Pino's default `pid` and
`hostname` fields are omitted. Event names are typed as dot-separated strings
and validated at the facade as lowercase dot-separated identifiers.

The project facade supports `debug`, `info`, `warn`, `error`, `child`, and
controlled `setLevel`. Its allowlisted optional fields cover request metadata,
external run/shipment identity, Carrier context, outcomes, durations,
retryability, safe reason codes, aggregate counts, lifecycle data, and projected
error data. It deliberately has no field for internal database IDs, tracking
references, messages from arbitrary errors, or raw objects.

`LOG_LEVEL` accepts only `debug`, `info`, `warn`, `error`, or `silent`. Defaults
are `debug` in development, `silent` in tests, and `info` in production. An
explicit valid value overrides the default. Development does not suppress
project log levels; the default emits debug and above.

### API request contract

The backend always generates a UUIDv4 request ID. Incoming `X-Request-ID` values
are ignored, preventing clients from choosing log correlation values. The
generated ID is returned in `X-Request-ID` and is available to logs emitted in
the request context.

One `api.request.completed` record is emitted with `requestId`, `method`, route
template, `status`, and `durationMs`. Query values, headers, request/response
bodies, cookies, and the raw URL are not included. Unmatched routes use the
fixed route value `unmatched`.

Completion levels are:

- successful health checks: `debug`;
- failed health checks: `warn`;
- other 2xx/3xx responses: `info`;
- other 4xx responses: `warn`;
- 5xx responses: `error`.

### Nest, lifecycle, and error safety

Both composition roots buffer startup output, install the same Nest logger
adapter, flush buffered records after initialization, enable graceful shutdown,
and emit exactly one `application.ready` and one `application.stopped` record.
Startup failures use a standalone structured logger so invalid configuration and
listen failures are still valid JSON.

Production and test warning/error records use fixed summaries plus only safe
`errorName`, validated `errorCode`, valid HTTP `errorStatus`, and an
application-relative `errorLocation`. The original error, message, stack, cause,
response, request, headers, and arbitrary values are never retained. Normal Nest
lifecycle string messages are preserved in production because they describe
framework state rather than user/provider data.

As explicitly approved, development-only Nest framework diagnostics retain their
raw local messages/errors/stacks. This is an intentional deviation from the
ticket's stricter all-environment baseline so local framework diagnostics are
not suppressed. It does not widen the typed application logger or disable Pino
redaction. Nest's `verbose` calls are emitted at `debug` locally because
`nestjs-pino` otherwise maps them to `trace`, below the approved local default.

### Redaction and omission

Pino applies `[Redacted]` to exact and wildcard paths through six parent levels
for passwords; tokens; secrets/API keys; authorization/proxy authorization,
including dashed HTTP header keys; cookies/set-cookie; CSRF/session data;
credential objects; headers; bodies/payloads; tracking references/numbers;
contact/person/email/phone/name/address fields; `source_data`; raw provider
data/responses; and browser state/artifacts.

Omission remains the primary defense: HTTP serializers are disabled and the
typed application fields cannot accept these categories. Tests inject a distinct
canary in every category and scan serialized production output for each value.

### Commands and examples

Normal development commands keep JSON output. Pretty output is explicit:

```text
pnpm start:dev:pretty
pnpm start:worker:dev:pretty
```

Safe API example:

```json
{
  "level": "info",
  "timestamp": "2026-10-12T12:00:00.000Z",
  "service": "grd-dashboard-be",
  "environment": "production",
  "runtime": "api",
  "component": "http",
  "requestId": "a80a977d-6524-4a26-895d-24c45a755af9",
  "event": "api.request.completed",
  "method": "GET",
  "route": "/shipments/:externalId",
  "status": 200,
  "durationMs": 18,
  "message": "API request completed"
}
```

Safe future worker example using the implemented child-field contract:

```json
{
  "level": "info",
  "timestamp": "2026-10-12T12:00:00.000Z",
  "service": "grd-dashboard-be",
  "environment": "production",
  "runtime": "worker",
  "component": "scheduler",
  "carrierCode": "ups",
  "runExternalId": "e5283cf4-452e-443d-8f85-6d792766693d",
  "event": "tracking.run.completed",
  "outcome": "success",
  "durationMs": 412,
  "attemptedCount": 8,
  "succeededCount": 8,
  "failedCount": 0,
  "message": "Tracking run completed"
}
```

The worker example is a contract example; V1-012 and Carrier tickets own the
future scheduler/adapter event emission.

## Files Changed

| File or area                                                     | Purpose                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`                                 | Pin the approved logging stack and add opt-in API/worker pretty scripts.                                                    |
| `.env.example`                                                   | Document the local `LOG_LEVEL=debug` default explicitly.                                                                    |
| `src/constants.ts`                                               | Define the stable service name and request-ID header.                                                                       |
| `src/config/env.schema.ts`, `src/config/configuration.ts`, tests | Validate `LOG_LEVEL` and map environment-specific defaults.                                                                 |
| `src/infrastructure/logging/*`                                   | Project facade, Pino configuration, request policy, redaction, safe errors, Nest bridge, lifecycle logging, and unit tests. |
| `src/app.module.ts`, `src/worker.module.ts`                      | Install the global logger with the correct `api` or `worker` runtime.                                                       |
| `src/main.ts`, `src/worker.ts`, `src/runtime/startup-error.ts`   | Structured startup/ready/failure output and Nest adapter installation.                                                      |
| `src/modules/health/readiness.service.ts`                        | Remove the old unstructured shutdown output now owned by the lifecycle logger.                                              |
| `test/e2e/logging.spec.ts`                                       | Verify generated correlation IDs, async context, completion count/levels, safe routes, and canary omission.                 |
| `test/e2e/runtime.spec.ts`                                       | Parse production API/worker output as JSON and verify identity plus one shutdown record.                                    |
| `docs/v1/decisions.md`, ticket, this summary                     | Record dependency approval, implementation status, contracts, and review guidance.                                          |

## Verification

| Exact command/check                                                                                                                                                                                                               | Result                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                                                                                                                                                                                                                  | Passed.                                                                                                                        |
| `pnpm build`                                                                                                                                                                                                                      | Passed; API and worker entry points compiled.                                                                                  |
| `pnpm vitest run --project unit src/config/env.schema.spec.ts src/infrastructure/logging/safe-error-fields.spec.ts src/infrastructure/logging/pino-logger.service.spec.ts src/infrastructure/logging/nest-logger.adapter.spec.ts` | Passed: 17 tests in 4 files.                                                                                                   |
| `pnpm vitest run --project e2e test/e2e/logging.spec.ts test/e2e/runtime.spec.ts`                                                                                                                                                 | Passed outside the sandbox: 12 tests in 2 files.                                                                               |
| `pnpm check`                                                                                                                                                                                                                      | Passed format check, Oxlint, typecheck, 26 unit tests, and production build.                                                   |
| `pnpm test:cov`                                                                                                                                                                                                                   | Passed: 26 unit tests; 76.38% statements and 76.47% lines. Request/startup paths are principally covered by E2E process tests. |
| `pnpm test:integration`                                                                                                                                                                                                           | Passed outside the sandbox: 1 PostgreSQL container test. The first sandboxed attempt could not access a container runtime.     |
| `pnpm test:e2e`                                                                                                                                                                                                                   | Passed outside the sandbox: 14 tests in 3 files after a production build.                                                      |
| `pnpm install --frozen-lockfile`                                                                                                                                                                                                  | Passed outside the sandbox; the sandboxed attempt could not open pnpm's shared read-only store lock.                           |
| `printf ... \| pnpm exec pino-pretty --colorize --levelFirst --messageKey message --timestampKey timestamp`                                                                                                                       | Passed; a representative JSON debug record rendered through the optional local formatter.                                      |
| `pnpm lint`, `pnpm format:check`, `git diff --check`                                                                                                                                                                              | Passed.                                                                                                                        |

## Review Notes

- `pino-http` owns async request propagation and automatic completion timing;
  the project controls the serialized object and does not expose its default
  request, response, or error serializers.
- A child logger's bound fields override per-call fields so stable context cannot
  be accidentally replaced at an individual call site.
- Request IDs are backend-generated only. If trusted proxy tracing is needed
  later, it should be a separately validated trace-header policy rather than
  silently trusting `X-Request-ID`.
- `PinoLogger.root` is used only inside logging infrastructure for runtime level
  control and an explicit final flush.
- The concrete Pino logger service is not exported from the global module;
  application consumers receive only the project facade.
- The local raw Nest diagnostic exception is limited to `NODE_ENV=development`;
  production and test follow the safe projection path.

## Remaining Issues

- Scheduler, Carrier adapter, tracking-run, and shipment events are contracts for
  later tickets; only application lifecycle and HTTP completion events are
  emitted by the current scaffold.
- No commit, merge, semantic version tag, or push has been performed. These wait
  for explicit commit approval and the repository's eventual main-branch flow.

## Suggested Review Order

1. `logging.types.ts`, `logging.options.ts`, and `safe-error-fields.ts` for the
   public contract and safety boundary.
2. `pino-logger.service.ts`, `nest-logger.adapter.ts`, and `logging.module.ts` for
   integration behavior.
3. `main.ts`, `worker.ts`, and the lifecycle/startup loggers.
4. Unit/E2E tests, dependency/configuration changes, then documentation.

## Proposed Commits

1. `feat(logging): V1-017 add structured API and worker logging` — dependencies,
   configuration, logging infrastructure, composition-root integration, and tests.
2. `docs(v1): document V1-017 structured logging` — dependency decision, ticket
   status, and this implementation summary.

Explicit final approval is required before staging or committing either change.
