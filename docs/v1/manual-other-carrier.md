# MON-V1-004: manual Other carrier

Approved through the Other-carrier grilling workflow. This extends monitoring
without adding another automated provider adapter.

## Carrier and access

Migration `ManualOtherCarrier1793491200000` seeds enabled carrier code `other`,
name `Other`. Admins use the existing carrier settings page/API to change only
`isActive`; renaming and automated settings are rejected. Disabling blocks new
Other shipments but preserves read access, Staff edits, history and follow-up
attention for existing shipments. Existing duplicate protection remains scoped
to carrier plus tracking reference among non-deleted shipments.

Other never participates in worker adapter validation, scheduled scans, tracking
runs or manual Refresh. Pause/resume requests conflict; its lifecycle is controlled
by the manual carrier status. Polling fields in its carrier row are unused legacy
storage values and are not presented as configurable settings.

## Staff forms and API

Reuse Add shipment. Choosing Other reveals status, pickup and delivery controls;
tracking reference remains required. Notes, Sales Rep and follow-up reuse existing
fields. Manual controls are removed when another carrier is selected. After adding
Other, switch to the Other tab while retaining the current filters.

`POST /api/v1/shipments` and `PATCH /api/v1/shipments/:externalId` accept an optional
`manualTracking` object only for Other:

```ts
type ManualTracking = {
  carrierStatus:
    'Pending Pickup' | 'Pickedup' | 'Out for delivery' | 'Delivered';
  pickedUpOn: string | null;
  estimatedDeliveryOn: string | null;
};
```

Date strings must be real ISO calendar dates, excluding year zero. On creation,
omitted manualTracking defaults to Pending Pickup with blank dates. Dates are
optional; Pickup is the staff-entered pickup date and Delivery is the estimate,
matching the existing table. No additional delivered-date column is added.

The detail page's existing assignment/follow-up form becomes Manual shipment
details for Other and saves status, dates, assignment and follow-up together through
Save changes. Manual status/date changes append an immutable snapshot and update
record timestamp/editor attribution in the same database transaction. Identical
manual values do not append a snapshot. No fake provider lookup or run is created.

Entering Delivered records the database's current New York business date in the
internal `deliveredOn` field and sets monitoring to completed. Further edits while
Delivered preserve that actual date. Changing back to another status clears it,
sets monitoring to active, and preserves dates not changed by staff. Other's
nextCheckAt remains null, including after changes to follow-up dates or a worker
reconciliation. Prior snapshots remain intact after corrections.

Follow-up follows the existing contract: newly entered/changed values must be
today or later in America/New_York; an unchanged overdue value may remain. Clearing
is permitted. Future dates on delivered Other shipments never restart polling.

## Lists and overview

- `tab=other` and the Other count include all non-deleted Other shipments,
  regardless of status or carrier enablement.
- All Shipments includes Other; Active and Delivered exclude it.
- Needs attention includes Other when follow-up is today or earlier in New York,
  even when Delivered or the carrier is disabled. No follow-up means no due alert.
- `tabCounts.other` and overview `counts.other` are added. Other and Needs attention
  can overlap; these counts must not be added to calculate All Shipments.
- The homepage adds an Other count/link. Its attention panel includes due manual
  shipments. Manual ETA participates in the existing upcoming-delivery rules.
- Search, multi-rep filtering, pagination, sorting and date-only display continue
  to apply. Manual shipments remain editable by unrestricted Staff and Admin.

## Acceptance evidence

Verify the migration on disposable PostgreSQL, including safe rollback behavior;
worker startup with only Other enabled and no adapter; no scheduled/Refresh work;
Staff creation/edit/delivery/reopen/history; Admin disable and Staff edit while
disabled; strict manual fields rejected on automated carriers; due attention and
Other counts; conditional Add shipment fields; and desktop/mobile editing.
