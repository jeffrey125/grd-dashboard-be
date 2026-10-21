# Amazon SP-API library evaluation

Evaluated: 2026-10-22

## Decision

Use the modular TypeScript packages
`@sp-api-sdk/shipping-api-v2@3.1.7` and `@sp-api-sdk/auth@3.1.6` for the Amazon
Shipping API v2 integration. `@sp-api-sdk/common@4.0.6` will be installed
transitively by the Shipping client.

Keep the existing application-owned Zod schemas and quote normalization around
the SDK boundary. The SDK should own the Amazon protocol concerns: Login with
Amazon (LWA) access-token retrieval, Amazon request construction, generated
Shipping v2 models and operation rate limiting. GRD should continue to own
package-by-package orchestration, money normalization, sandbox warnings and
provider failure semantics.

This adds a production dependency and therefore still requires explicit
approval before installation.

## Why the modular TypeScript SDK fits

- The Shipping-only package exposes a fully typed `ShippingApiClient.getRates`
  operation, request and response models, plus the typed
  `AmazonShipping_US` business identifier. See its
  [generated Shipping API source](https://github.com/bizon/selling-partner-api-sdk/blob/master/clients/shipping-api-v2/src/api-model/api/shipping-api.ts)
  and Amazon's authoritative
  [Shipping v2 OpenAPI model](https://github.com/amzn/selling-partner-api-models/blob/main/models/shipping-api-model/shippingV2.json).
- `SellingPartnerApiAuth` performs the LWA refresh-token exchange and caches
  the access token for its lifetime. See the package's
  [authentication documentation](https://github.com/bizon/selling-partner-api-sdk/tree/master/packages/auth).
- `sandbox: true` selects Amazon's sandbox endpoint, and `region: 'na'`
  selects North America. No GRD-owned endpoint rewriting is required.
- The packages publish explicit ESM and CommonJS exports with corresponding
  declaration files. They support Node 20 or later and therefore align with
  this ESM, Node 24, strict-TypeScript NestJS backend.
- The Shipping client is generated from Amazon's official model. The
  [repository](https://github.com/bizon/selling-partner-api-sdk) says its model
  synchronization runs twice daily. The current packages were published on
  2026-10-08, and the repository was active on 2026-10-18.
- Axios `1.20` and Axios Retry `4.5` are already direct dependencies of this
  repository. The new transitive runtime utilities are principally
  `read-pkg-up` and `axios-logger`.

## Tradeoffs and dependency footprint

The recommended packages are third-party code that handles Amazon credentials.
That ownership risk is the main tradeoff for their narrow footprint and strong
TypeScript contract. Pin the exact versions, retain the pnpm lockfile, inspect
the resolved graph and keep Zod validation at GRD's inbound boundary.

| Option                                                                                    | Shipping v2 `getRates`                     | LWA refresh token           | TypeScript                                                                                             | Current maintenance                                 | Published footprint                                                                                     | Security and dependency notes                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bizon modular SDK** (`@sp-api-sdk/shipping-api-v2@3.1.7` plus `@sp-api-sdk/auth@3.1.6`) | Fully typed generated operation            | Built in, with token cache  | Strongest TypeScript ergonomics; ESM and CJS exports                                                   | Published 2026-10-08; repo active 2026-10-18        | Shipping client about 1.34 MB plus approximately 113 KB for common/auth, before transitive dependencies | Third-party MIT packages with npm provenance. Reuses the repo's Axios and Axios Retry versions, but adds `read-pkg-up` and `axios-logger`. Smaller surface, lower provider ownership trust.                                         |
| **Amazon official SDK `1.13.0`**                                                          | Generated operation and models             | Built in, with token cache  | Per-API declarations exist, but the package root is untyped under this repo's TypeScript configuration | Published 2026-10-02; Amazon repo active 2026-10-15 | 6,640 files, about 17.4 MB unpacked                                                                     | Amazon-owned, Apache-2.0 and npm provenance attestation. Four direct dependencies: `superagent`, `yaml`, `bottleneck` and `@babel/cli`. `@babel/cli` is an unusual runtime dependency and the package contains every SP-API client. |
| **`amazon-sp-api@1.2.1`**                                                                 | Operation exists through generic `callAPI` | Built in                    | Declaration entry exists, but the published operation typings do not include Shipping                  | Published and repo updated 2026-03-30               | 147 files, about 451 KB unpacked                                                                        | Third-party MIT package. Adds CSV, XML, encoding and query-string packages that this quote-only path does not need; no npm provenance attestation appeared in the inspected release metadata.                                       |
| **Existing Axios stack**                                                                  | Must be implemented locally                | Must be implemented locally | Application types and Zod validation                                                                   | Maintained by GRD                                   | No new package                                                                                          | Smallest supply-chain footprint, but GRD must maintain token expiry/caching, Amazon headers, throttling and model drift.                                                                                                            |

Package metadata was inspected from the npm registry and each package's source
manifest. The official SDK's
[`package.json`](https://github.com/amzn/selling-partner-api-sdk/blob/main/javascript/sdk/package.json)
shows its runtime dependencies. The modular alternative's
[`shipping-api-v2` manifest](https://github.com/bizon/selling-partner-api-sdk/blob/master/clients/shipping-api-v2/package.json),
[`ShippingApiClient`](https://github.com/bizon/selling-partner-api-sdk/blob/master/clients/shipping-api-v2/src/client.ts)
and
[`auth` documentation](https://github.com/bizon/selling-partner-api-sdk/tree/master/packages/auth)
show its narrower client and LWA implementation. The generic client's
[`shipping_v2.js`](https://github.com/jrl84/amazon-sp-api/blob/master/lib/resources/versions/shipping/shipping_v2.js)
shows `getRates`, while its
[`typings` directory](https://github.com/jrl84/amazon-sp-api/tree/master/lib/typings/operations)
does not contain a Shipping operation type module.

The official package ships generated per-API declarations, but its root package
manifest does not declare a `types` field and its archive has no root
`index.d.ts`. A clean TypeScript 6 compile against the extracted `1.13.0`
package failed at the root import with `TS7016: Could not find a declaration
file for module '@amazon-sp-api-release/amazon-sp-api-sdk-js'`. Its runtime
coverage is valid, but using it here would require accepting `any` at the
provider boundary or maintaining a local declaration shim.

No candidate was installed and no dependency audit was run during this
evaluation. After approval, install with the repository's pinned pnpm workflow,
then run `pnpm audit`, typecheck and the Amazon sandbox contract test against the
resolved dependency graph.

## Alternatives considered

### Amazon official SDK

Amazon's
[`@amazon-sp-api-release/amazon-sp-api-sdk-js`](https://www.npmjs.com/package/@amazon-sp-api-release/amazon-sp-api-sdk-js)
is the strongest ownership alternative. It directly supports Shipping v2,
automatic LWA token retrieval and rate limiting. It is not recommended for this
strict-TypeScript, one-operation adapter because the current package's root
import is untyped and its full-SP-API archive is about thirteen times larger
than the Shipping-only client. Reconsider it if Amazon adds a typed root export
or publishes per-API packages.

### Generate a Shipping-only client

Amazon publishes the authoritative OpenAPI model, so a client can be generated
locally. This would reduce the runtime surface but add Java/OpenAPI generator
tooling, generated-code ownership and a recurring regeneration process. It is
not justified for one operation while Amazon publishes a maintained SDK.

### Keep direct Axios calls

The repository already has Axios, Axios Retry, Bottleneck and Zod. Direct calls
would add no dependency and remain a reasonable fallback if the modular SDK's
resolved dependency audit or sandbox contract fails. They are not preferred
because LWA token management, Amazon headers, throttling and API-model updates
are standard provider concerns already handled by the SDK.

## Installation gate

If approved, add exactly these production dependencies:

```text
@sp-api-sdk/auth@3.1.6
@sp-api-sdk/shipping-api-v2@3.1.7
```

Then typecheck a small `ShippingApiClient` construction and run the existing
successful Amazon dynamic-sandbox `getRates` contract through the library
before replacing the adapter. Do not remove the existing Zod response
validation merely because the SDK supplies compile-time types.
