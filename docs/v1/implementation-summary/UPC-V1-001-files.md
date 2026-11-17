# UPC-V1-001: Shipment DOCS attachments

## Summary

Added DOCS file viewing to upcoming shipment details. File bytes remain in Airtable;
the application does not persist files in its database or backend storage.

## Changes Made

Authenticated GET `/upcoming-shipments/:orderId/files` reads current Airtable DOCS,
REQ SHIP, Test and REP fields. It validates IDs and HTTPS Airtable attachment hosts,
rechecks local permissions after the provider response, and rejects excluded,
past, out-of-window or foreign orders. Responses are no-store. PDF Quote is excluded.

The frontend reads filenames/type/size when details open and refetches before each
Preview/Download. PDF and supported raster images open in a MUI dialog; other types
can be downloaded. Direct links open in a separate browser tab for download, where
browser settings may display the file with native Save controls instead. Errors,
empty files and retries are explicit. No new dependencies or migrations.

Approved Help update adds a Files guide, fictional screenshot and three markers.

## Files Changed

Backend:

- `src/modules/upcoming-shipments/upcoming.contracts.ts`: file source contract.
- `airtable-upcoming.source.ts`: fresh limited DOCS reads and URL validation.
- `upcoming.service.ts`: current order eligibility and permission checks.
- `upcoming.controller.ts`: authenticated no-store endpoint.
- `airtable-upcoming.source.spec.ts`, `upcoming.service.spec.ts`: source and security regressions.
- `test/e2e/upcoming-shipments.spec.ts`: real authenticated HTTP access and no-store checks.
- `docs/v1/frontend-handoff.md`, `docs/v1/upcoming-shipments.md`: API and approved requirements.

Frontend:

- `src/features/upcoming-shipments/shipment-files.tsx`: file list, preview and download.
- `src/features/upcoming-shipments/order-panel.tsx`: include Files in details.
- `e2e/upcoming-fixture.ts`, `e2e/shipment-files.spec.ts`: fresh link, preview, download, error, empty and screenshot checks.
- `src/features/help/content.ts`, `src/features/help/captures.json`, `public/help/screenshots/upcoming-files.png`: guide and verified markers.

## Verification

- Backend `pnpm typecheck`, `pnpm build`: passed.
- Backend `pnpm test`: 402 passed across 45 files.
- `pnpm exec oxlint --deny-warnings src/modules/upcoming-shipments`: passed.
- `pnpm exec vitest run --project unit src/modules/upcoming-shipments`: 18 passed.
- `pnpm exec vitest run --project e2e test/e2e/upcoming-shipments.spec.ts`: 1 passed with disposable PostgreSQL and authenticated HTTP requests.
- Frontend `pnpm check`: passed, including 267 tests across 39 files.
- Frontend `pnpm build`: passed; existing bundle-size warnings remain.
- `UPDATE_HELP_SCREENSHOTS=true pnpm exec playwright test e2e/shipment-files.spec.ts e2e/upcoming-shipments.spec.ts --workers=2`: 8 passed, fictional screenshot generated.
- Rebuild, then `pnpm exec playwright test e2e/help.spec.ts --workers=2`: 8 passed.
- Screenshot inspected; numbered markers target Files, Preview and Download.
- Both repositories `git diff --check`: passed.
- Live local DOCS endpoint and Airtable PDF: HTTP 200, no-store; Chrome's embedded PDF viewer rendered one page from the Airtable URL.
- Local frontend http://localhost:5173 and API http://localhost:3000/api/v1/health/ready verified reachable and left running.
- Full production/container acceptance and deployment were not run.

## Review Notes

Temporary URLs are bearer links after issuance and expire upstream; already issued
links cannot be revoked by the dashboard. Access is checked before each issuance.
No attachment URL is stored as a durable database record. Existing motion, calendar,
overview and skeleton edits and the unrelated tracking test remain separate work.
The earlier standalone prototype used a temporary local copy; this feature does not.

## Remaining Issues

Uncommitted and not deployed. Native PDF preview/save behavior depends on browser
settings; the Download action opens a fresh link and the browser's Save control is
available for inline PDFs. Previously proposed broader upcoming/assignment Help
guides remain outside this approved Files-guide update.

## Suggested Review Order

Source contract/validation, service permissions, endpoint tests, frontend Files,
Help screenshot and browser tests.

Proposed commits (require approval):

- `feat(upcoming-shipments): UPC-V1-001 add authorized DOCS access`
- `feat(upcoming-shipments): UPC-V1-001 add file previews and Help guide`
