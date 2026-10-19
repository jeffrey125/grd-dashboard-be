# SQ-V1-006: Add international inputs, units, and provider options

## Status

- Depends on: SQ-V1-004, SQ-V1-005
- State: ready-for-agent
- Repositories: `grd-dashboard-be`, `grd-dashboard-fe`

## What to build

Complete the shared international and package-option slice using only capabilities
verified by SQ-V1-001. Preserve imperial/metric input, map per-box customs items, and
make signature, insurance, declared value, native currencies, and duty/tax status
explicit for each provider.

## Required reading

- [Unified shipment quote calculator](../../shipping-quotes.md)
- [SQ-V1-001](SQ-V1-001-provider-contracts.md) capability matrix
- [SQ-V1-004](SQ-V1-004-amazon.md)
- [SQ-V1-005](SQ-V1-005-unishippers.md)

## Acceptance criteria

- The form accepts domestic and international destinations, while origins remain US
  only. Provider eligibility is evaluated before queueing and displayed per provider.
- International groups collect per-box description, quantity, unit value/currency,
  country of manufacture, item weight, and HS code only when required by the verified
  route/provider contract.
- Group quantity expands totals correctly: customs quantity and value semantics are
  never confused with one consolidated box.
- Imperial and metric inputs round-trip exactly in history. Provider conversions use a
  documented precision/rounding policy and are included in the attempt snapshot.
- Signature and insurance controls appear only for selected providers that use them and
  are labelled with that platform. Customs value is distinct from insurance coverage.
- Every result says whether each requested option is included, unsupported, or
  unverified; an omitted provider field is not treated as included.
- Non-USD results show the native amount and currency and are not converted or ranked
  against USD. USD remains the primary display currency.
- Duty/tax/clearance status is `included`, `excluded`, or `unknown`. V1 does not estimate
  landed cost, and unknown amounts are not displayed as zero.
- A provider that cannot quote a requested international route returns an explicit
  unsupported result while other eligible providers continue.

## Verification

- Run backend validation/property coverage for unit conversions, rounding, quantities,
  currencies, customs expansion, and provider eligibility.
- Run provider fixture tests for verified international and positive-option mappings,
  plus unsupported/unverified behavior.
- Run frontend tests for conditional fields, unit round-trip, native currency, option
  coverage, and duty/tax status.
- Run both repositories' format, lint, typecheck, test, and build commands.
