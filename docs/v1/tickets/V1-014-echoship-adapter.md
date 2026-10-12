# V1-014: Implement the EchoShip adapter

## Status

Depends on V1-012.

## Objective

Implement EchoShip browser authentication, sequential Shipment lookup, safe not-found classification, normalized mapping, and bounded Playwright lifecycle.

## Required reading

- [`../tracking-behavior.md`](../tracking-behavior.md), EchoShip section
- [`../tracking-source-data-policy.md`](../tracking-source-data-policy.md), EchoShip allowlist

## Dependency gate

Evaluate the current stable Playwright package against the pinned Node/Nest environment and obtain explicit production-dependency approval before installation.

## Scope

- Validate `ECHOSHIP_URL`, `ECHOSHIP_USERNAME`, and `ECHOSHIP_PASSWORD` at worker startup.
- Launch headless Chromium, log in once per run/session, and close browser resources on completion, error, cancellation, and shutdown.
- Navigate to a fresh Shipment search for each sequential lookup.
- Extract status, EDI/detail, pickup, estimated-delivery, and delivered text and map to normalized values.
- Return `not_found` only for a confirmed absent search result; classify navigation/login/selector/parsing failures as technical failures.

## Acceptance criteria

- Generic `USERNAME`/`PASSWORD` environment names are absent.
- Credentials, cookies, HTML, and screenshots never enter logs or `source_data`.
- Timeouts are explicit and bounded.
- Missing optional fields do not discard other valid values.
- Browser/session resources close in every tested terminal path.
- Tests use mocked/local Playwright pages or fixtures; ordinary CI makes no live EchoShip call.
- Mapping and source data exactly match the approved allowlist.

## Verification

Run adapter unit/browser fixture tests, tracking integration with a fake session, cancellation/resource-leak checks, typecheck, and build. Keep live smoke testing opt-in.
