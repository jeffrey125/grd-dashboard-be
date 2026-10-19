# SQ-V1-002: Save immutable quote comparisons

## Status

- Depends on: SQ-V1-001
- State: ready-for-agent
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Add the persistence foundation and authenticated form workflow that saves an immutable
quote comparison without executing a provider. Staff can choose providers, sender
mode, destination, package groups, units, customs inputs, and requested options, then
save and reopen exactly what they submitted.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [Database schema](../../database-schema.md)
- [Architecture](../../architecture.md)
- [Auth plan](../../auth-plan.md)
- [SQ-V1-001](SQ-V1-001-provider-contracts.md) and its resulting contract evidence

## Acceptance criteria

- Reviewed migrations add the eight approved quote tables with explicit constraints,
  indexes, exact monetary types, timestamps, and `ON DELETE NO ACTION` on every new FK.
- One `shipping_accounts` row per provider is enforced for v1. Credentials and session
  material cannot be stored in any quote table.
- The authenticated create API validates a US origin, domestic/international destination,
  future-or-current ship date, at least one enabled selected provider, positive package
  quantities/dimensions/weights, customs data when applicable, and original units.
- An idempotency key returns the original comparison for an accidental duplicate and
  does not collapse deliberate refreshes that use a new key.
- Input and audit fields are immutable after creation. Provider/account configuration
  changes cannot rewrite comparison snapshots.
- Staff can list and read all non-deleted comparison records using existing authorization
  conventions; admin-only lifecycle actions are not added in this ticket.
- The frontend form supports provider selection, account-default versus explicit sender,
  multiple package groups, imperial/metric entry, international customs items, and
  provider-labelled option fields.
- Saving and reopening the form preserves the original values and units exactly. The
  response makes clear that no rates have run yet.
- No `shipments` monitoring row is created and no **Use this rate** action appears.

## Verification

- Run migrations up/down/up against a real empty PostgreSQL database.
- Run backend unit/integration/e2e coverage for validation, authorization, idempotency,
  snapshots, constraints, and no-action foreign keys.
- Run frontend component tests for provider visibility, package groups, units, customs,
  save, and reopen.
- Run both repositories' format, lint, typecheck, test, and build commands.
