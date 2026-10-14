# Follow-up work

See [release-readiness.md](release-readiness.md) for rollout gates.

- Choose hosting; App Platform is a candidate, not a selected deployment target.
  Caddy and production Compose are deferred by user decision.
- Create deployment/CI/CD separately; preserve the current workflow in V1-018.
- Agree a normalized Tracking Snapshot read projection for frontend status/dates.
- Add observability/worker operational alerting and evaluate MCP separately.

V1-018 adds verified PostgreSQL TLS with optional provider CA, local API/database
Compose, portable image, frontend handoff and repository instructions. Managed DB
CA/network configuration and production verification still require operator work.
