# Shared US-only quote form

## Summary

Approved on 2026-10-22: replace repeated provider sender forms with one shared
sender, share supported options, and restrict new comparisons to US addresses.
Implemented, verified and deployed as LAN release `20261022-02`.

## Changes Made

- React Hook Form owns one sender independently of provider selection. Removing all
  providers and selecting them again retains entered values. Requests expand that
  sender into the existing per-provider snapshot format.
- Signature and insurance appear once when supported. The mapper applies each only
  to supporting selected providers and the UI identifies unsupported providers.
  Both current adapters advertise neither option, so controls remain absent today.
- Sender and destination countries are fixed to US in the new form. Backend
  submission validation rejects non-US destinations, customs data, and differing
  sender snapshots; historical response parsing is unchanged.
- Provider discovery exposes address requirements. The shared form uses the union
  of selected providers' required fields and each name limit. The same backend
  requirements definition drives discovery and submission validation.
- Existing React Hook Form, MUI, Zod, country-region-data, libphonenumber-js and
  decimal.js are reused. No new production dependency or database migration.

## Files Changed

Backend paths are relative to `grd-dashboard-be`:

| File                                                         | Purpose                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/modules/shipping-quotes/provider-input-requirements.ts` | Provider-owned address requirements, including myUnishippers' 35-character sender limit.                    |
| `src/modules/shipping-quotes/quote.schemas.ts`               | Enforce US-only inputs and identical senders on new submissions.                                            |
| `src/modules/shipping-quotes/quote.service.ts`               | Include requirements in provider discovery.                                                                 |
| `src/modules/shipping-quotes/quote.schemas.spec.ts`          | Regression coverage for US-only, shared sender and provider name limits.                                    |
| `test/e2e/shipping-quotes.spec.ts`                           | Verify discovery metadata and HTTP rejection of international input.                                        |
| `test/integration/quote-execution.spec.ts`                   | Repair stale future-date fixtures to exercise current Quick Quote execution and historical retry rejection. |
| `test/integration/quote-readiness.spec.ts`                   | Use today's Eastern date for the existing Quick Quote worker readiness fixture.                             |
| `docs/v1/shipping-quotes.md`                                 | Record the approved release scope and shared-form behavior.                                                 |
| `docs/v1/frontend-handoff.md`                                | Document API validation and discovery requirements.                                                         |
| `docs/v1/implementation-summary/shared-us-quote-form.md`     | Review and deployment evidence.                                                                             |

Frontend paths are relative to `grd-dashboard-fe`:

| File                                                    | Purpose                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/features/shipping-quotes/quote-form.tsx`           | Single sender form, shared options, US-only country fields and conditional required hints.   |
| `src/features/shipping-quotes/schemas.ts`               | Shared form schema, provider requirements and mapping to existing API input.                 |
| `src/features/shipping-quotes/quote-standards.ts`       | Keep now-internal helpers private after removing international form controls.                |
| `src/features/shipping-quotes/pages/new-quote-page.tsx` | Update copy guidance to refer to the shared sender.                                          |
| `src/features/shipping-quotes/quote-form.test.tsx`      | Shared sender persistence, option support, conditional requirements and US-only regressions. |
| `e2e/quote-form.spec.ts`                                | Desktop/mobile shared-field selectors and validation behavior.                               |
| `e2e-backend/quotes.spec.ts`                            | Real API save/copy through one sender form.                                                  |
| `e2e-backend/quote-readiness.spec.ts`                   | Expect HTTP rejection of international input.                                                |
| `docs/v1/api-contracts.md`                              | Document request mapping and discovery metadata.                                             |
| `docs/v1/ui-spec.md`                                    | Record shared form and US-only release behavior.                                             |

## Verification

- Frontend `pnpm test:acceptance`: passed. Format, lint, Knip, typecheck/build,
  228 unit tests, 134 desktop/mobile browser tests, 22 real-backend browser tests
  (5 opt-in tests skipped), 4 HTTPS container checks and 3 HTTP container checks.
- Frontend `FE_TEST_QUOTE_READINESS=true pnpm exec playwright test --config
playwright.backend.config.ts e2e-backend/quote-readiness.spec.ts`: 2 passed.
  The first opt-in attempt used an API port mismatching the built frontend and
  could not reach login; rerunning with the matching default port passed.
- Backend `pnpm test`: 340 passed across 37 files.
- Backend `pnpm exec vitest run --project unit src/modules/shipping-quotes/quote.schemas.spec.ts`:
  11 passed.
- Backend `pnpm exec vitest run --project integration test/integration/quote-execution.spec.ts`:
  final run 17 passed. Worker readiness passed separately in the preceding
  two-file run after correcting its same-day fixture.
- Backend `pnpm test:container`: all 6 checks passed.
- Backend `pnpm lint` and `pnpm typecheck`: passed.
- Backend `pnpm check` stopped at an unrelated pre-existing formatting error in
  `work/quote-design-preview/staff-quote-options.html`; it was not changed.
  `git ls-files -z | xargs -0 pnpm exec prettier --check --ignore-unknown` passed,
  and the two new files also passed explicit Prettier checks. Remaining gates were
  run separately as listed here.
- Both repositories `git diff --check`: passed. Final diffs reviewed against the
  initial worktrees; unrelated files remain untouched.
- Backend final `pnpm test:cov:all`: 672 passed across 84 files (691.95 seconds).
  Combined coverage: 86.19% statements, 76.55% branches, 89.74% functions, 88.36%
  lines. The initial run exposed stale quote fixture assumptions and was stopped
  after those tests were corrected.
- Both release image builds passed: `grd-dashboard-be:20261022-02` and
  `grd-dashboard-fe:http-20261022-02`. Transfer checksum matched on both machines:
  `5538bfa65dc1358d24d1ac74e9d552a1fd0b7dbd024e3b57c16393b23dff7d8a`.
- Desktop validation screenshot inspected; single sender form, required-field
  errors and US-only country presentation verified. Browser tests cover mobile.
- Local fixture frontend `http://localhost:5173` and API
  `http://localhost:3012/api/v1/health/ready` verified reachable and left running.
  The API uses disposable test data with tracking and quote workers disabled.
- No real provider quote request was submitted by this verification.

## Review Notes

- New submissions retain the existing API shape and immutable per-provider history;
  no database conversion is required. Historical international records remain
  readable, but cannot be resubmitted as new international comparisons.
- Future providers still require an adapter and capability/requirements registration;
  their common addresses and options reuse this form. No speculative provider-only
  inputs were invented.
- Provider-only options can produce different requested options across providers;
  the existing ranking policy suppresses an overall lowest price in that case.
- Copying uses the existing first sender under the approved same-sender invariant.
- The approved custom code is limited to provider requirement definitions and form
  to API business mappings; reusable validation, forms and arithmetic remain backed
  by installed libraries.
- Pre-existing untracked `docs/v1/amazon-api-access-proposal.md`,
  `docs/v1/implementation-summary/SQ-V1-010-manual-rate-card-investigation.md` and
  `work/` are unrelated and untouched.
- The approved changes are committed in the final handoff. No push, merge or tag
  was performed.

## Remaining Issues

No implementation or deployment blockers remain. The live release is deployed and
the approved commits are complete. Real provider quotes were not requested; provider account readiness is outside this
UI/validation release. The unrelated pre-existing `work/` formatting failure remains.

## Suggested Review Order

1. Backend requirements and submission schema.
2. Frontend schema/mapping and shared form.
3. Regression tests, specification updates, then verification/deployment evidence.

## Deployment evidence

- Live form: `http://192.168.100.83/quotes/new`; opened in a new browser tab and kept
  available for manual testing. Verified both provider checkboxes selected, exactly
  one sender company/name input, and both US country inputs with the `readonly`
  attribute. No form was submitted to a real provider.
- API and single worker: `grd-dashboard-be:20261022-02`.
- Frontend: `grd-dashboard-fe:http-20261022-02`.
- Database, API and frontend healthy. Worker emitted `application.ready` / `Worker
ready` at `2026-10-21T19:11:33.798Z`. API, frontend and worker restart counts: zero.
- `/healthz` returned `ok`; `/api/v1/health/ready` reported application/database up.
- Pre-upgrade custom-format backup:
  `/home/jeff/app/grd-dashboard/backups/pre-20261022-02.dump`, 259361 bytes, mode 600;
  archive listing verified with `pg_restore --list` before rollout.
- Previous environment retained as `backups/env-before-20261022-02` (mode 600).
  Only application image keys changed in the live environment; existing secrets,
  remote Compose configuration, networking and persistent volumes were preserved.
- The initial SSH stdin script completed the backup but consumed subsequent script
  input before image switching. Verified the old image tags remained active, then
  resumed using a transferred script file. The final rollout completed successfully;
  rollback was not needed. Previous images remain available.

## Approved commits

1. Backend: `feat(shipping-quotes): enforce shared US-only quote inputs` — backend
   requirement/schema/service changes, their tests, and specification/handoff/summary.
2. Backend: `test(shipping-quotes): align execution fixtures with same-day quotes` —
   only `test/integration/quote-execution.spec.ts` and `test/integration/quote-readiness.spec.ts`.
3. Frontend: `feat(shipping-quotes): share sender inputs for US comparisons` — all
   frontend files listed above.

These are unticketed approved changes. Commit hashes are reported in the final
handoff; no push, merge or tag was performed.
