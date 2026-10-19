# SQ-V1-001 implementation summary

## Summary

Implemented the provider-contract research harness for Amazon Shipping and
myUnishippers with authentication before every action. Both request and browser
modes have returned live domestic quotes. This ticket adds tests, fixtures, and
evidence only; production quote API, worker, database, and frontend work remains in
the later SQ-V1 tickets. Existing Playwright, Zod, Vitest, TypeScript, and Node
built-ins were sufficient; no dependencies were added.

## Changes Made

- Public quote methods check the protected page and fresh bootstrap context first,
  reuse valid sessions, authenticate when expired, and permit one relogin/replay on
  a quote-time 401/403. Missing context, unavailable pages, and human verification
  stop explicitly. There is no cross-mode fallback or transport-error retry.
- Amazon now follows View → Calculate rates, waits for rendered controls after
  redirects, and resolves current merchant/proposal/XSRF context from the native
  proposal bootstrap. Request mode uses in-page HTTP; browser mode fills the native
  estimator and captures its response.
- myUnishippers uses the real Auth0 flow and QUICK QUOTE readiness signal, avoiding
  the shipping form's contact Email. It resolves namespace from the profile and
  authentication headers from native requests. ESTIMATE submits one explicit unit
  per box; the native whole-shipment total is used unchanged. No company override
  or saved account/address mutation is required.
- The live CLI supports provider selection and optional visible-browser human
  verification in the same session. Each mode reports separately; safe output
  contains only an allowlisted rate summary. Unknown or failed responses cannot
  become successful quotes.
- Sanitized fixtures and intercepted Chromium tests cover real page layouts,
  authentication ordering/reuse/revocation, bounded replay, missing bootstrap,
  quantities, validation, verification, and safe result projection.

## Files Changed

- `test/support/shipping-quotes/provider-contracts.ts` — schemas, credential env
  names, diagnostics, quote inputs/results, and provider errors.
- `test/support/shipping-quotes/playwright-harness.ts` — both native bootstrap,
  login, guarded request/browser, and bounded authentication replay paths.
- `test/support/shipping-quotes/live-session.ts` — allowlisted quote projection
  and same-page human-verification resume/timeout.
- `test/support/shipping-quotes/live-contract-smoke.mts` — opt-in quote-only CLI,
  provider selection, interactive verification, per-mode output/exit status.
- `test/fixtures/shipping-quotes/contracts.ts` — ten sanitized contract scenarios.
- `test/integration/shipping-quotes-contracts.spec.ts` — intercepted browser
  contracts and behavioral regression coverage, using no local provider credentials.
- `package.json` — deterministic and opt-in live quote commands.
- `docs/v1/tickets/shipping-quotes/SQ-V1-001-contract-matrix.md` — current evidence,
  reproduction, capabilities, bootstrap details, and remaining research gates.
- `docs/v1/tickets/shipping-quotes/SQ-V1-001-provider-contracts.md` and `README.md`
  in that directory — ticket status and evidence links.
- This implementation summary — review and verification handoff.

Pre-existing planning changes to `docs/v1/README.md`, `docs/v1/TODO.md`,
`docs/v1/tickets/README.md`, `docs/v1/shipping-quotes.md`, and other SQ ticket
specifications remain separate. No tracked source outside `package.json` changed.

## Verification

- `pnpm test:shipping-quotes` — passed: 50 tests, including allowlisted output
  that strips extra account/contact fields for both providers.
- `pnpm check` — passed: formatting, lint, typecheck, 27 unit-test files /
  275 tests, and Nest build.
- `pnpm test:shipping-quotes:live -- --provider unishippers` — passed, exit zero:
  request mode returned seven services for two boxes (UPS Ground USD 24.16);
  browser mode returned seven services for one box (Ground USD 12.08). Optional
  Canada input returned 422 and no quotes.
- `pnpm test:shipping-quotes:live -- --provider amazon --interactive` — final
  run passed, exit zero: both domestic modes returned 200 / USD 13.81 for one box.
  Canada was explicitly skipped because country/customs support is unverified.
  An earlier run exited one with request mode 500 / browser mode 200; that
  historical intermittent failure remains a documented reliability limit.
- Subsequent guarded request-mode refreshes in existing browser contexts — both
  returned 200: Amazon USD 13.81 for one box; myUnishippers Ground USD 24.16 for
  two boxes. No manual human verification was needed in those successful runs.
- `git diff --check` and `git diff --no-index --check /dev/null <file>` for
  all new artifacts — passed. Local evidence links exist; no provider credential
  values or debug markers were found in the reviewed artifacts. Raw provider
  bodies and session values were not persisted. Temporary diagnostic browsers
  were closed and their screenshot/probe scripts removed.
- Database, full integration/e2e, container, deployment, and combined coverage
  checks were not run: this test-only ticket changes no production composition,
  schema, or packaging. No full-stack servers were started for this harness task.

## Review Notes

- Live observations are dated 2026-10-19, not guaranteed current prices. Amazon is
  a single-package estimate; application multiplication is not a native shipment
  quote. myUnishippers returns the whole-shipment total without multiplication.
- Each action reloads the protected page to reject stale DOM/cookies and refresh
  dynamic context. This adds page-load latency. Context is reused in-process only;
  no cookie/token persistence or export is implemented.
- myUnishippers ESTIMATE ignores a quantity property on one handling unit; explicit
  entries are required. Its native browser Quick Quote supports one domestic box,
  so unsupported browser inputs raise a blocker rather than change mode.
- Headless Amazon can require CVF; interactive mode waits for the user in the same
  window. Earlier intermittent HTTP 500 has no proven cause and is not hidden by
  an automatic retry. Later success does not prove reliability is resolved.
- Synthetic unsupported/validation cases establish harness behavior only. Complete
  sender defaults, international and positive options require further evidence;
  provider expiry text must not be assigned an invented timezone.

## Remaining Issues

Amazon intermittent HTTP 500 and possible verification challenges remain external
reliability limits. Complete safe sender refresh, international/customs, signature,
insurance, transit mapping, and expiry semantics remain unverified. The harness is
ready for domestic quote-only checks; production API/worker/frontend integration is
outside SQ-V1-001 and is not claimed complete.

## Suggested Review Order

1. Provider contracts and capability matrix.
2. Authentication/bootstrap and request/browser harness.
3. Safe live-session projection and CLI.
4. Fixtures and intercepted regression tests.
5. Package scripts, ticket status, and this summary.
