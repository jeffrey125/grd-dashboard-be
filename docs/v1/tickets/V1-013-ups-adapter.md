# V1-013: Implement the UPS adapter

## Status

Depends on V1-006 and V1-012.

## Objective

Implement UPS OAuth, tracking lookup, validation/mapping, bounded retries, token caching, and request throttling behind the Carrier adapter interface.

## Required reading

- [`../tracking-behavior.md`](../tracking-behavior.md), UPS and rate limiting
- [`../cache-design.md`](../cache-design.md)
- [`../tracking-source-data-policy.md`](../tracking-source-data-policy.md), UPS allowlist

## Dependency gate

Evaluate `@nestjs/axios`, `axios`, `axios-retry`, and `bottleneck` against current Nest/Node built-ins and maintenance. Explain the chosen combination and obtain explicit approval before installation.

## Scope

- Validate UPS environment and credentials without logging secrets.
- Implement OAuth token acquisition and `UpsTokenProvider` using worker in-memory cache, provider expiry safety margin, and an in-flight refresh promise.
- Validate tracking references and responses before mapping normalized results/source data.
- Apply production/CIE hard limits, database rate configuration, bounded timeouts, retry conditions/backoff, valid `Retry-After`, and unique transaction IDs for retries.
- Distinguish not-found, retryable technical failure, and invalid response.

## Acceptance criteria

- Production never exceeds the stricter of configured RPM and provider hard maximum; CIE never exceeds 5 RPM.
- Every physical retry consumes limiter capacity.
- Concurrent token requests produce one refresh; expired/invalid tokens refresh safely; cache loss only causes a new token request.
- Response mapping covers simplified/detail status and RDD/SDD/DEL date rules.
- Persisted `source_data` contains only the approved allowlist.
- No live Carrier call runs in ordinary CI.
- Unit/integration tests mock time and HTTP for token, limit, retry, 429/Retry-After, timeout, not-found, malformed response, and mapping behavior.

## Verification

Run UPS unit/integration tests, tracking integration with a mocked UPS client, typecheck, and build. Keep any live smoke command opt-in and credential-gated.
