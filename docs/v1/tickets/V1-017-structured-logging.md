# V1-017: Add structured Pino logging

## Status

Depends on V1-003. Execute before V1-004 so database and feature work use the approved logger from the start.

## Objective

Provide one production-safe structured logger for the API and worker, patterned after `/home/jeff/apps/tom-automation/src/modules/logger/index.ts`, while adapting its fields, service name, and redaction policy to this backend.

## Required reading

- [`../architecture.md`](../architecture.md), especially structured logging and composition roots
- [`../decisions.md`](../decisions.md)
- [`../folder-structure.md`](../folder-structure.md)
- `/home/jeff/apps/tom-automation/src/modules/logger/index.ts` as the behavioral reference; do not copy its application-specific names unchanged

## Dependency decision

Use the approved `pino` production dependency directly behind a project-owned logger interface. Do not add Winston or make application modules import Pino. `pino-pretty` is development-only and may be added for a dedicated local pretty-print script; production always emits newline-delimited JSON.

Before installation, verify current Pino and Node compatibility from Pino's official documentation, pin a compatible version through pnpm, and record the selected versions. Adding `nestjs-pino` or another transport requires separate justification and explicit approval because it is not needed for the approved baseline.

## Scope

1. Add `src/constants.ts` and define the stable application/service name plus other genuine cross-module compile-time constants there. Environment values, secrets, mutable state, and database-owned settings are forbidden. Feature-private protocol constants remain with their owning feature until they become a shared contract.
2. Add a globally available logging module under `src/infrastructure/logging`. Expose a typed project logger with `info`, `warn`, `error`, `debug`, `child`, and controlled log-level behavior. Only this infrastructure may import Pino.
3. Configure Pino with ISO timestamps, string levels, `message` as the message key, a stable service field, environment-controlled level validation, and centralized redaction. Write JSON to stdout/stderr; do not create application-managed log files.
4. Add safe error projection based on the reference implementation. Never serialize the original `Error`, stack, cause, provider response, request options/configuration, headers, browser state, or arbitrary nested error values.
5. Add API request logging with a validated or generated request correlation ID, method, route template, status, and duration. Do not log query values, request/response bodies, authorization material, cookies, tracking references, or internal database IDs.
6. Add worker child-logger conventions for component, Carrier code, run/shipment external IDs, trigger, outcome, duration, retryability, safe reason code, and aggregate counts. Never log `source_data`, raw Carrier responses, credentials, or browser artifacts.
7. Bridge Nest framework lifecycle/error logs into the same logger for both `AppModule` and `WorkerModule`, preserving graceful shutdown and avoiding duplicate records.

## Required redaction policy

At minimum, redact exact and wildcard forms of passwords, tokens, secrets, API keys, authorization/proxy-authorization headers, cookies/set-cookie, CSRF/session values, credential objects, request headers, request/response payloads, tracking references, contact/person fields, `source_data`, and raw provider data. Use `[Redacted]` as a consistent censor value.

Prefer omission over redaction for fields that should never be useful in logs. Redaction is the defense-in-depth layer, not permission to attach whole request, Shipment, configuration, or provider objects.

## Stable event conventions

- Event names are lowercase dot-separated identifiers such as `api.request.completed`, `worker.poll.completed`, `tracking.run.started`, and `carrier.request.failed`.
- Messages are readable summaries; dashboards and tests key on event names and fields, not message text.
- Child loggers carry stable context rather than repeating it manually on every call.
- Levels are purposeful: `debug` for local diagnostic detail, `info` for normal lifecycle/outcomes, `warn` for recoverable degradation, and `error` for failed work requiring attention.

## Acceptance criteria

- API and worker emit valid one-record-per-line JSON in production mode with stable service, environment, component, event, level, timestamp, and message fields.
- Application modules depend on the project logger interface and do not import Pino directly.
- Incoming API requests have one completion record and preserve a safe request correlation ID in response/context; health endpoints can use a quieter documented policy.
- Worker/run/Carrier logs carry enough external-ID context to trace an execution without exposing internal IDs or tracking references.
- Error logging is deterministic and safe for unknown thrown values; original errors and external response objects are not serialized.
- Automated tests prove level filtering, child context, JSON shape, request correlation, error projection, and redaction using an in-memory destination.
- Tests include canary secrets in nested objects and assert that neither the values nor disallowed field contents appear in serialized output.
- Local pretty output, if enabled, is opt-in and development-only. Production startup does not depend on `pino-pretty` or any network transport.
- Both Nest composition roots shut down cleanly without losing normal buffered output or producing duplicate startup/shutdown records.

## Verification

Run focused logging unit tests, API request-logging integration tests, worker bootstrap/shutdown tests, format check, Oxlint, typecheck, the normal unit suite, and production build. Parse captured production output line-by-line as JSON and scan it for every canary secret and forbidden payload value.

## Handoff

Document the final event/field contract, redaction paths, environment variables, local pretty command, and examples of safe API and worker records. Call out any intentional difference from the reference module. Propose the logging dependency/configuration as one coherent Conventional Commit and obtain approval before committing.
