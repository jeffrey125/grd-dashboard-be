# UPC-V1-001: Upcoming shipments

Approved conversation requirements and implementation contract.

- Source is Airtable `GRD SALES ORDERS` in base `appxyP3yY5YF9plDO`, table
  `tbl7X5ROha1PzgGZt`; `REP` links to `Reps` (`tblMqeGvgg4McO2hB`). Read only.
- Include nonblank `REQ SHIP >= today`; exclude `Test`. Actual ship dates do not
  determine eligibility. Use America/Chicago for today; preserve date-only values.
- Overview: today through Sunday inclusive, total plus first five orders. The week
  may cross a month boundary. Calendar/dispatch: today through current month end.
  No previous/future month browsing. Airtable request covers only the union of
  those two windows, with pagination and no silent partial results.
- Staff own rep link and sales-assistant multiple rep assignments use Airtable
  record IDs saved in PostgreSQL. Email matching only suggests an own-rep link;
  Admin confirms/saves. Unconfigured Staff do not see the feature. Admin sees all,
  including unassigned; staff scope is the union of own and assigned reps.
- Admin → Accounts manages access. Assignments are many-to-many and may be cleared.
  All server reads, counts and details are scoped before sending to the browser.
- The weekly, calendar and dispatch Sales rep dropdowns show Vinnie, Ryan, Tom,
  Brendan, Daniel, Andrew, Don, Jake, Heidi, Milly and Ryan - Ali in that order.
  Each account sees only its permitted reps, matched by Airtable record ID.
  **All permitted reps** includes authorized orders for former reps. Admins can
  also choose **Unassigned**. Account assignments and order details use the full
  permitted directory.
- Existing five-minute Nest cache, explicit refresh, last-updated timestamp and
  warning with last-successful data on failures. No initial-data failure as empty
  results. Reads recheck assignment permissions even on cached/stale data.
- Read-only operational details: customer, SO, PO, product/vendor, requested date,
  rep, pounds/units, origin, pallets, tracking, notes, and Open in Airtable.
  Preserve PO 0; request no pricing/profit/commission fields.
- Read GRD POs from the order's linked `Product Price` rows in
  `GRD SALES ORDERS - Line Items`. Match product record IDs and, when a product
  repeats, vendor record IDs. A unique match supplies the line PO. A numbered
  header PO remains available as a fallback. Show any other linked PO with its
  own product and vendor in order details and include it on the calendar card.
- Overview mobile and desktop: date navigator above a stable-height order list.
- Monthly mobile: date navigator, inline day orders, centered details modal.
  Monthly desktop: compact calendar with three events plus more, date opens the
  right drawer with every order for that day. Events open the day list, not direct
  details. Details animate inside the same drawer; Back restores list/scroll/focus.
  No persistent selected-day highlight on desktop. Outside click, Close and Escape
  dismiss overlays.
- Admin mobile: dispatch board grouped by reps. Desktop: date navigator.
- Subtle 320 ms MUI motion, system reduced-motion support, desktop/mobile checks.
- Approved dependencies: existing MUI, TanStack Query/Router, Axios, Zod, TypeORM,
  Nest cache, Bottleneck, axios-retry; add Day.js backend and FullCalendar frontend.
  FullCalendar 6.1.22 packages use the same version and support React 19.
- No production migration, deployment, Airtable writes, webhook/DB order sync or
  unrelated commit is authorized by this implementation task.

- Approved DOCS extension: Files in order details, on-demand fresh links, native
  PDF/image preview and direct browser downloads. No backend/DB file storage;
  PDF Quote excluded. Help guide and fictional screenshot approved.
