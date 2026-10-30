# SHIP-V1-002: shipment order details and reviewed backfill

## Approved behavior

- A Carrier/Tracking Reference remains one monitored Shipment. Repeated POs do not create duplicate Shipments; no PO is required.
- A Shipment can have several GRD POs; a GRD PO can be associated with several Shipments, including across Carriers. Preserve identifiers as text, including case and leading zeros.
- GRD PO `0` is the warehouse-stock marker. Preserve `0` under PO# and store the CSV's SO separately. A blank PO is not automatically warehouse stock.
- SO and Product are database-backed lists shown and edited in shipment details only. Do not add monitoring-table columns. Multiple matching CSV line items retain every distinct product and SO.
- Customer and Vendor remain the existing optional shipment-wide text fields. A backfill must reject conflicting customer/vendor matches rather than selecting one line item.

## API and persistence

POST/PATCH support optional `poNumbers`, `soNumbers`, and `products` string arrays. Each array is bounded to 100 inputs; each entry is trimmed, nonempty, NUL-free and at most 255 characters. Deduplicate and sort lists without changing identifier case. Omission preserves values on PATCH; `[]` clears a list. Null arrays are rejected. Do not split product names on commas.

All Shipment projections return `poNumbers`, `soNumbers`, and `products`. Keep `poNumber` as the existing PO# display summary and legacy single-reference input. A request containing both PO input forms is invalid. Legacy `poNumber: null` clears associations; a legacy value replaces them with exactly that opaque reference. Existing values are never parsed on punctuation.

Migration `1793750400000-ShipmentOrderDetails` adds `shipments.so_numbers` and `shipments.products` as non-null varchar(255) arrays defaulting to empty, and widens the PO display summary to text. It adds `purchase_orders` (natural key `po_number`) and `shipment_purchase_orders` (unique shipment/PO pair, reverse PO index). Both foreign keys explicitly use ON DELETE NO ACTION in the migration and mappings. The value `0` is a reserved warehouse marker, not an actual vendor PO record with customer/vendor ownership. No order-directory editing API is introduced.

Existing populated PO values seed associations, including soft-deleted shipments, without changing their spelling or original audit attribution. Repository writes atomically maintain both associations and the display summary while locking the owning Shipment. Deleted shipments retain their links. Shared order references are not deleted when unlinked from one shipment. Customer, Vendor, tracking history, worker eligibility and existing permissions are preserved.

Rollback removes the new lists and relation tables and restores the old display column width. It refuses rollback when a PO display summary exceeds the old 255-character limit. Rollback drops SO/product data; back up and review before any production rollback.

## Details UI and Help

Use existing Material UI free-text multiple-value inputs and React Hook Form/Zod validation. Enter adds a reference/product; removing a chip removes that association. Input blur also accepts a pending value. Existing dirty-form protection, live query refresh and assignment-save behavior remain intact. SO/Product do not appear in the creation form or monitoring grid; staff can edit them after creating a shipment.

Update Help's shipment-details guide, its fictional screenshot and marker coordinates. Preserve Admin-only Help visibility and other guides/screenshots.

## Reviewed source-data backfill

The supplied CSV and all production-derived plans stay Git-ignored under `tmp/`, outside the Docker build context. No live customer/vendor/product values belong in this spec, tests or PR text. The private matching report records shipment UUIDs, source logical CSV rows, exact expected values and proposed values.

The prepared plan contains 37 shipments / 185 missing-field changes: 37 each for Customer, Vendor, PO list, SO list and Product list. These correspond to 39 PO associations, 39 SO values and 47 product values. Thirty-four shipments match exact alphanumeric-bounded tracking tokens (including multiple tokens in one CSV cell); three use GRD PO references corroborated by customer/product/vendor in notes. Eight unresolved shipments remain excluded. The counts describe the inspected snapshot and must be revalidated before applying.

`node scripts/backfill-shipment-order-details.ts --plan PATH --csv PATH` defaults to a read-only preview. Build first and provide the target DB settings through environment variables; production requires verified TLS. The source file SHA-256 must match the reviewed plan. `--apply` is a separately approved production write after deployment/migration.

The transaction checks each exact UUID, carrier ID, tracking reference and all expected business fields before any write. Changed, populated, missing or deleted records abort the complete plan. Plans may fill only empty fields. Apply preserves notes, monitoring status, current snapshots and next-check scheduling, updates system edit attribution/version, re-reads every affected row and commits only if all values agree. A repeated application is rejected as stale rather than overwriting populated data.

No migration, API startup or worker startup runs the backfill automatically. This PR does not deploy or mutate production.
