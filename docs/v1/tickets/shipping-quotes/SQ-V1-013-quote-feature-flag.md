# SQ-V1-013: Runtime quote comparison feature flag

Approved by the user on 2026-10-27 to allow a tracking-only deployment.

## Scope

Reuse installed NestJS Config, Zod, and TanStack Query. Add one strict backend
environment switch, `QUOTE_COMPARISON_ENABLED`, defaulting to `false`. Setting it
to `false` on both API and worker disables quote comparison without a frontend
rebuild. No dependency or database migration is required.

## Acceptance criteria

- Public `GET /api/v1/features` exposes only the flag with `Cache-Control: no-store`.
- When disabled, authenticated quote, quote event, and quote-provider admin
  routes return 404 before any quote service operation.
- Quote execution, provider readiness, and sender-default worker loops do not
  schedule or claim work, including direct `runOnce` calls.
- The frontend hides quote navigation and blocks all quote pages and provider
  settings before their contents mount. Missing/invalid feature metadata leaves
  quotes unavailable without preventing tracking access.
- Existing tracking, authentication, other administration, saved quote records,
  and queued quote work are preserved. Re-enabling requires a process restart.
- Development and LAN environment generators pass the same flag to API and worker.

## Delivery boundary

DigitalOcean provisioning is a separate deployment step. Earlier Amazon production
configuration changes and unrelated tracking test edits must remain distinct in
the commit handoff. Deployment is not considered successful until the updated
runtime has been activated and verified.
