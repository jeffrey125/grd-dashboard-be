# V1-015: Implement the FFE adapter

## Status

Depends on V1-012.

## Objective

Implement FFE browser login, one bounded XML export per run, secure parsing, batch mapping, and per-Shipment failure isolation.

## Required reading

- [`../tracking-behavior.md`](../tracking-behavior.md), FFE section
- [`../tracking-source-data-policy.md`](../tracking-source-data-policy.md), FFE allowlist

## Dependency gate

Evaluate current stable Playwright and `fast-xml-parser` versions against the pinned runtime and obtain explicit production-dependency approval before installation.

## Scope

- Validate FFE credentials at worker startup.
- Authenticate through Playwright, download one account XML export per Carrier run, and close resources on every path.
- Stream/read with a 25 MiB hard bound; reject DTD/entity declarations and invalid/empty XML.
- Index valid records by order number and return results only for requested due Shipment references.
- Map approved dates/status, isolate malformed matching records, and store only the matching record as source data.

## Acceptance criteria

- A run with many FFE Shipments downloads once, not once per Shipment.
- Oversize content is aborted before unbounded allocation.
- Invalid XML, disallowed entities, duplicate order numbers, empty exports, session expiry, and partial malformed records have explicit tested behavior.
- The complete account export is never duplicated into attempt source data or logs.
- Ordinary CI uses XML/browser fixtures and performs no live FFE call.

## Verification

Run parser security/size tests, adapter browser-fixture tests, tracking batch integration, cancellation/resource-leak checks, typecheck, and build. Keep live smoke testing opt-in.
