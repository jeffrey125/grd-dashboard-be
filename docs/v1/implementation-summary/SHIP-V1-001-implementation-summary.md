# SHIP-V1-001: shipment business fields

## Summary

Implemented optional PO#, Customer and Vendor text on shipments across PostgreSQL,
the API and the sibling frontend. PO# is the second desktop column after Sales Rep.
The user approved the feature and reuse of TypeORM/PostgreSQL, Zod, React Hook Form
and MUI DataGrid. No dependency was added.

## Changes Made

- Nullable varchar(255) columns `po_number`, `customer`, `vendor`; existing rows
  remain null. One PO value per shipment, with duplicate PO values permitted.
- POST/PATCH trim surrounding whitespace, preserve case/punctuation/leading zeros,
  turn blanks into null and reject NUL or values over 255 UTF-16 code units.
  Omitted PATCH properties preserve existing values. Responses always include the
  three nullable fields, including dashboard panels.
- Staff/Admin retain existing permissions. Metadata changes update record edit
  attribution. Duplicate carrier/reference creation and carrier refreshes preserve
  saved metadata.
- Literal case-insensitive partial search includes all three fields before counts
  and pagination. Sorts use database text order, NULLS LAST in either direction,
  and shipment-ID tie-breaking.
- Creation and detail forms expose all fields; detail saves submit only dirty
  fields. Desktop begins Sales Rep, PO#, Customer, Vendor, Tracking Number even
  on narrow desktops, with internal horizontal scrolling as needed. Mobile cards
  show populated values in PO#, Customer, Vendor order.

## Files Changed

Backend paths below form the proposed backend commit:

| File                                                                             | Purpose                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/infrastructure/database/migrations/1793664000000-ShipmentBusinessFields.ts` | Add/reverse the three nullable columns.                                         |
| `src/modules/shipments/shipment.entity.ts`                                       | Map the columns in TypeORM.                                                     |
| `src/modules/shipments/shipments.schemas.ts`                                     | Input normalization, response contract, sort fields and validation field names. |
| `src/modules/shipments/shipments.service.ts`                                     | Return field-specific creation errors.                                          |
| `src/modules/shipments/typeorm-shipments.repository.ts`                          | Persist insert/patch values and record-edit attribution.                        |
| `src/modules/shipments/typeorm-shipment-read.ts`                                 | Project fields in direct/list reads.                                            |
| `src/modules/shipments/typeorm-shipment-record.ts`                               | Project fields in shared SQL JSON.                                              |
| `src/modules/shipments/typeorm-shipment-search.ts`                               | Search, sorting and paginated projections.                                      |
| `src/modules/dashboard/typeorm-dashboard.repository.ts`                          | Supply fields to shared dashboard projections.                                  |
| `src/modules/shipments/shipment-business-fields.spec.ts`                         | Boundary and normalization tests.                                               |
| `test/integration/shipment-business-fields.spec.ts`                              | Persisted reads, duplicate handling, search and null-last sorting.              |
| `test/support/shipment-database.ts`                                              | Include migration in disposable fixtures.                                       |
| `test/integration/database.spec.ts`                                              | Include migration in full rollback/reapply and drift checks.                    |
| `test/integration/schema.spec.ts`                                                | Update exact schema inventory.                                                  |
| `test/e2e/shipments.spec.ts`                                                     | Authenticated create, response contract, Staff patch and refresh preservation.  |
| `docs/v1/database-schema.md`                                                     | Document schema and business rules.                                             |
| `docs/v1/frontend-handoff.md`                                                    | Document request/response/search contract.                                      |
| `docs/v1/implementation-summary/SHIP-V1-001-implementation-summary.md`           | This review handoff.                                                            |

Frontend file inventory is in the sibling repository's
`docs/v1/implementation-summary/SHIP-V1-001-implementation-summary.md`.

## Verification

Commands used installed package binaries; no dependency or lockfile changes.

- `node_modules/.bin/nest build` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.
- `node_modules/.bin/oxlint src test` — passed.
- `node_modules/.bin/vitest run --project unit` — 383 passed. An initial sandboxed
  run could not bind notification-test HTTP listeners; rerun with local networking
  permitted passed.
- `node_modules/.bin/vitest run --project integration test/integration/shipment-business-fields.spec.ts test/integration/shipment-search.spec.ts test/integration/shipments.spec.ts test/integration/schema.spec.ts`
  — business fields, search and repository suites passed (19 tests). The schema
  inventory initially failed because its expected list omitted the new columns;
  corrected and verified in the next run.
- `node_modules/.bin/vitest run --project integration test/integration/schema.spec.ts test/integration/database.spec.ts test/integration/dashboard.spec.ts --project e2e test/e2e/shipments.spec.ts`
  — schema and migration suites passed (28 tests), including CLI rollback/reapply
  and ORM drift. No file named `dashboard.spec.ts` exists; the actual dashboard
  suite was run separately below. HTTP projection assertions initially omitted
  the new response fields and were corrected before their successful rerun.
- `node_modules/.bin/vitest run --project integration test/integration/dashboard-overview.spec.ts`
  — 8 passed.
- `node_modules/.bin/vitest run --project e2e test/e2e/shipments.spec.ts`
  — final 16 passed, including Admin/Staff behavior and carrier refresh preservation.
- Scoped `node_modules/.bin/prettier --check` and `git diff --check` — passed.
- Frontend typechecks, build, lint and unit tests passed; browser and live local
  checks are recorded in the frontend summary.

Full backend integration suite, combined coverage and container release checks
were not run: this is a scoped feature verification, not a release verification.
Production migrations and deployment were not performed.

## Review Notes

Apply the migration before the updated API; deploy the API before the frontend,
whose response schema expects the new nullable fields. Rolling the migration back
drops these fields and their data. No foreign keys or uniqueness constraints are
introduced. API validation owns trimming/blank normalization; direct SQL imports
must normalize independently. PO text sorting is lexical (`PO-10` before `PO-2`).

The frontend's pre-existing `e2e-backend/tracking-review.spec.ts` changes are
unrelated and excluded from this task's proposed commits. Backend started clean.
Final diff reviewed; no custom replacement for approved library functionality.

## Remaining Issues

No known feature blockers. Airtable import, managed customer/vendor directories,
future PO uniqueness and production rollout are deferred. No commit has been made.

Local frontend: http://localhost:5173
Local isolated API: http://localhost:3000/api/v1
Both use disposable local test data; carrier workers are disabled.

## Suggested Review Order

1. Migration/entity and schema/API docs.
2. Validation, persistence, search and dashboard projections.
3. Backend regression tests, then frontend forms/grid and browser tests.

Proposed backend commit:
`feat(shipments): SHIP-V1-001 persist searchable shipment business fields`

Proposed frontend commit:
`feat(shipments): SHIP-V1-001 add PO customer and vendor fields`

Each commit includes its repository's feature files, tests and documentation.
Explicit final approval is required before staging/committing under AGENTS.md.
