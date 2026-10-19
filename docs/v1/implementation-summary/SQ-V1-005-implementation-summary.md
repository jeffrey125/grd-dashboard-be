# SQ-V1-005 implementation summary

## Summary

Implemented quote-only myUnishippers request and full small-package browser modes,
including native multi-package totals and sender/receiver contact inputs. There is
no automatic mode fallback, shipment booking, or provider address-book write.

## Changes Made

- Playwright resolves authenticated profile, namespace, billing, and default-origin
  context dynamically; session material remains in worker memory.
- Request mode submits native estimates. Browser mode fills addresses, contacts,
  selected ship date, package groups and native quantities, retaining entered
  addresses through confirmation prompts. Quick Quote is not used. Masked numeric
  inputs are read back and fail closed if the provider changes their values.
- myUnishippers-only request comparisons may leave all three package dimensions
  blank. The native payload omits `billedDimension`; partial dimensions and every
  browser, Amazon, or mixed-provider comparison still require all three.
- Provider discovery now returns `executionMode` so the React Hook Form/Zod form can
  apply the same rule before submit. Blank dimensions persist as immutable empty
  input strings, nullable normalized dimension columns, and no canonical dimension keys.
- Optional contact name/phone fields survive comparison save/reopen. Browser
  attempts lacking receiver or explicit-sender contacts return
  `contact_details_required`; sender names exceeding the provider limit return
  `sender_company_too_long`, without truncation or account changes.
- Normalization preserves whole-shipment totals and separates platform from the
  delivering carrier. Browser non-GET writes are denied except exact verified
  read-only endpoints; the guard stays active through page teardown. Native
  pickup-offer lookup is allowed, but ordering a pickup or shipment is not.
- Browser responses must match the comparison's account namespace, product/mode,
  full addresses, applicable contacts, date and expanded package measurements.
  The listener is registered before form changes can auto-trigger a quote.
- Login readiness recognizes Auth0's username control only; the fixture includes
  an authenticated shipping-contact field with `id="email"` to prevent regression.
  The account-default refresh boundary and reusable provider harness apply the same
  selector rule.
- Fixed ORM JSONB default metadata without DDL changes. Replaced an FFE test's
  competing interception with a real loopback HTTP fixture; production FFE code is
  unchanged.

## Files Changed

- `src/modules/shipping-quotes/unishippers-quote.contract.ts` and its spec:
  provider payload/validation/normalization and sanitized two-box evidence.
- `test/fixtures/shipping-quotes/unishippers-success-evidence.json`: tracked,
  credential-free provider response shape used by the contract test in clean CI.
- `src/modules/shipping-quotes/unishippers-quote.adapter.ts` and its integration
  spec: production request/full-form browser execution and safety regressions.
- `quote-worker.module.ts`, `quote-executor.ts`, and
  `quote-execution.repository.ts`: adapter registration and public reason codes.
- `quote.schemas.ts`, `test/e2e/shipping-quotes.spec.ts`, and
  `test/integration/quote-execution.spec.ts`: contact save/reopen/phone validation
  and immutable sender-error persistence.
- `typeorm-quote.repository.ts`, `quote.repository.ts`, `quote.entity.ts`, and
  migration `1792800000000-OptionalPackageDimensions.ts`: expose provider mode and
  persist omitted dimensions without inventing numeric values.
- `test/container/runtime.test.ts`: verify all 12 migrations reverse and reapply in
  the production image.
- `quote.entity.ts`: nullable normalized dimensions plus the existing JSONB default
  represented correctly in ORM metadata.
- `test/integration/ffe-browser.spec.ts`: deterministic HTTP login/expiry fixture.
- `test/support/shipping-quotes/live-adapter-smoke.mts` and `package.json`:
  opt-in production-adapter smoke with normalized output only.
- `src/modules/shipping-quotes/browser-sender-defaults.ts`,
  `test/integration/sender-defaults.spec.ts`, and the reusable Playwright harness:
  Auth0-only username detection with an authenticated contact-email regression.
- Frontend `src/features/shipping-quotes/schemas.ts`, `quote-form.tsx`,
  `quote-form.test.tsx`, `quote-progress.tsx`, `quote-progress.test.tsx`: contact
  inputs, mode-aware dimension validation/display, native-total disclosure, and
  actionable validation guidance.
- Backend README, handoff, database schema notes, ticket, this summary, and
  frontend `docs/v1/api-contracts.md`: aligned runtime/API documentation.

## Verification

- Frontend `pnpm check` and `pnpm build`: passed formatting, lint, typechecks, Knip,
  193 tests in 32 files, and production build. Existing chunk-size warning remains.
- Backend `pnpm check`: final formatting, lint, typecheck, 301 unit tests and build
  passed. Earlier restricted-sandbox loopback `EPERM` failures were resolved by
  rerunning with the required test-server permissions, not code changes.
- Final `pnpm test:integration`: 30 files / 237 tests passed (437.24 seconds).
- Targeted optional-dimension API, migration, schema, and provider contract checks:
  41 tests passed; the corrected provider/migration regression set passed 74 tests.
- Final full-form browser fixture: 10 passed after hardening, including multiple
  groups, quantities, requested date, complete sender/receiver contacts, stale
  request rejection, two address prompts and attempted unknown-write blocking.
  Command: `pnpm exec vitest run --project integration
src/modules/shipping-quotes/unishippers-quote.adapter.integration.spec.ts`.
- Sender-default and adapter browser regression run: 2 files / 13 tests passed,
  including the authenticated `id="email"` contact-field cases.
- API save/reopen and durable execution suites: 15 passed with disposable PostgreSQL.
- Final combined API/execution/provider-contract verification: 65 passed using
  `pnpm exec vitest run --project e2e test/e2e/shipping-quotes.spec.ts
--project integration test/integration/quote-execution.spec.ts
test/integration/shipping-quotes-contracts.spec.ts`.
- FFE expiry cases passed 16 executions each; schema/CLI checks passed.
- Frontend real-backend quote E2E: 3 passed with
  `VITE_API_ORIGIN=http://localhost:3014 pnpm build` followed by
  `FE_TEST_API_PORT=3014 FE_TEST_QUOTE_DEMO=true pnpm exec playwright test
--config playwright.backend.config.ts e2e-backend/quotes.spec.ts`.
  Contact values survive save/reopen/copy; partial results survive reload; and a
  six-box, 51 lb myUnishippers-only request saves/reopens with dimensions omitted.
- Live authenticated request and production full-form browser modes independently
  returned seven UPS services for two packages, including Ground USD 24.16. The
  browser test used a valid account origin held in memory with comparison-only
  test company/contact values and a public destination. No raw provider data,
  order, label, or account address write was persisted.
- A live authenticated request-mode smoke using the supplied 60139 to 04901 route,
  quantity 6, weight 51 lb, and blank dimensions returned seven UPS services. Ground
  was USD 324.96; the request omitted `billedDimension` and performed no booking.
- A subsequent opt-in production-adapter smoke again passed request mode, but
  browser sign-in failed before form entry. A diagnostic fresh browser stalled on
  `/callback` waiting for the authenticated quote page. Therefore the final
  stricter correlation/write-guard revision is fixture-verified, not live-verified.
- Both repositories pass `git diff --check`. The standalone live smoke entry point
  passes its explicit NodeNext TypeScript check. No combined coverage was run.
- `pnpm test:container`: 6 passed in 178.91 seconds. The production image ran
  non-root with Chromium, the worker lifecycle checks passed, and all 12 migrations
  fully reverted and reapplied using production-only dependencies.
- Refreshed fixture-only manual servers remain running: frontend
  `http://localhost:5173/` (HTTP 200), API `http://localhost:3013/api/v1`
  (`health/live` and `health/ready` OK, including database). The disposable demo
  database was reset when restarting its task-owned API for the updated schema.

## Review Notes

- Reused approved installed Playwright, Zod, React Hook Form and MUI. No new
  production dependency, deployment, or commit. One additive migration makes only
  the normalized dimension columns nullable.
- The debugging workflow found and fixed a stale test login fixture that still used
  `#email`; production intentionally recognizes only Auth0's username control so a
  shipping contact-email field cannot be mistaken for a login prompt.
- Existing comparisons remain readable without contacts; Copy to new can add them.
- The provider sender-dialog SAVE only closes its local editor. Address-book
  selectors stay unselected. `schedulePickupFlow` retrieves pickup offers;
  `orderFlow` performs booking and is blocked.
- Native totals are never multiplied again. Unknown option/duty/tax/clearance
  values stay explicit; expiry without an unambiguous timezone stays null.
- Fixture tests never load credentials. Opt-in live smoke reads the account origin
  in memory, uses comparison-only test company/contact values, and prints only
  normalized rates.

## Remaining Issues

Live re-verification of the final hardened browser adapter remains blocked by the
provider sign-in failure described above. Earlier native two-package live success
does not prove the final guard/correlation revision. The new request-mode blank-
dimension path is live-verified. No staging or commit performed.

## Suggested Review Order

1. Contact schemas/frontend form and save/reopen tests.
2. Provider contract/adapter, fixtures and opt-in smoke.
3. Worker/persistence integration, JSONB default and FFE fixture correction.

## Proposed commit partition (approval required)

1. Backend provider contract/adapter and specs, contact schemas/API tests,
   worker/executor/repository wiring, live smoke/package script, README/handoff,
   ticket/summary, and contact-snapshot database note:
   `feat(shipping-quotes): SQ-V1-005 implement full-form myUnishippers quotes`.
2. Backend optional-dimension schema/service/repository/adapter hunks, migration,
   API/provider/migration tests, and matching documentation:
   `feat(shipping-quotes): SQ-V1-005 allow request quotes without dimensions`.
3. Backend `quote.entity.ts` and the JSONB-default database note hunk:
   `fix(shipping-quotes): SQ-V1-005 align JSONB default metadata`.
4. Backend myUnishippers Auth0 fixture correction only:
   `test(shipping-quotes): SQ-V1-005 align Auth0 login fixture`.
5. Backend `test/integration/ffe-browser.spec.ts` only:
   `test(ffe): SQ-V1-005 stabilize browser redirect fixtures`.
6. Frontend contact/progress form/schema files and tests, the contact E2E hunks, and
   `docs/v1/api-contracts.md`:
   `feat(shipping-quotes): SQ-V1-005 add myUnishippers contact inputs`.
7. Frontend mode/dimension schema, form/detail, tests, E2E, API contract, and summary
   hunks: `feat(shipping-quotes): SQ-V1-005 allow request quotes without dimensions`.

Existing SQ-V1-005 work was continued; unrelated files were not changed. Nothing
is staged. Each proposed commit remains single-purpose and requires final approval.
