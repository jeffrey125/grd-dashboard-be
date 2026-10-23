# SQ-V1-012 — Admin-configurable provider weight limits

Approved scope: the 2026-10-24 design interview, captured in
[shipping-quotes.md](../../shipping-quotes.md#configurable-per-box-weight-limits-sq-v1-012).
Extends the existing provider administration and quote execution implementations.

## Acceptance criteria

- Default actual per-box limits: Amazon 50 lb; Unishippers 150 lb. Admin-only
  persisted editing with revision conflicts and warning above published defaults.
- Inclusive boundaries in lb and kg; quantity does not multiply the weight used
  for eligibility. Use installed Zod, Math.js, Decimal.js and TypeORM.
- Skip a provider for the entire shipment if any group exceeds its limit. Show
  offending groups and the applied limit, and proceed with eligible providers.
- Reject all-overweight requests in the frontend and API before persistence.
- New attempts/retries and queued first execution use current limits. Running
  attempts/recovery and completed results preserve their recorded policy.
- Verify migration up/down and mapping alignment with disposable PostgreSQL;
  cover boundary, settings, queue/retry, frontend and real-browser behavior.

No production deployment, new dependency, commit or push is implied.
