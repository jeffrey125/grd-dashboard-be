# Unified shipment quote calculator

## Status

Approved product and architecture specification. Implementation is split across the
[`SQ-V1` ticket set](tickets/shipping-quotes/README.md). This is an extension to the
completed tracking baseline; it does not change the original backend-only V1 scope.

The calculator is part of the planned shipment application. It compares rates before
a shipment exists. It must not create a row in `shipments` until a future purchase or
tracking workflow produces a real shipment/tracking reference.

## Product boundary

V1 supports Amazon Shipping and myUnishippers small-package rates. Freight, additional
platforms, shipment purchase, labels, bookings, pickups, and automated landed-cost or
currency conversion are deferred. The UI must not show a **Use this rate** action.

Both providers are selected by default. A staff user may deselect either provider,
submit comparisons, view all quote history, and retry eligible failed providers. Only
an admin may change provider automation, provider availability, stale-rate settings,
or delete and restore quote history.

## Shared quote input

One immutable comparison contains:

- a ship date;
- a US sender choice for each provider: refreshed account default or an explicit
  comparison-only sender;
- a domestic or international destination, subject to provider capability;
- one or more package groups, where every box in a group has identical dimensions
  when supplied, weight, contents, and a positive quantity;
- input in imperial or metric units, preserving the original values and provider
  conversions; and
- requested provider-specific signature or insurance options.

International shipments contain a label description and total customs value/currency.
Users may keep that shipment summary or enter detailed per-box customs items:
description, quantity, unit value and currency, country of manufacture, item weight,
and HS code when the provider or route requires it. Detailed totals multiply item
quantity and unit value by the package-group box quantity. All items use the shipment
currency. V1 compares transportation charges. Duty,
tax, clearance, and landed-cost status must be `included`, `excluded`, or `unknown`;
unknown values are never displayed as zero.

Provider-specific fields are visible only while their provider is selected and must
say which platform uses them. The result records whether every requested option was
included, unsupported, or unverified.

## Account defaults

Opening the form refreshes each selected provider's default sender. The UI displays
the full available default details and retrieval time before submission: name/company,
street, city, state/division, postal code, and country. A cached last successful value
may be displayed with a stale marker, but submission using the default requires a
current successful refresh or an explicit sender.

The actual resolved sender is snapshotted on each provider attempt. Provider defaults
may differ. When they do, results display each origin and a different-origin warning;
the UI does not name an overall cheapest result across those origins.

If a provider rejects its default sender, the user may enter a correction for this
comparison. The application must not silently truncate data or save the correction to
the provider account.

## Provider execution

Each provider has one configured account and an admin-controlled execution mode:
`request` or `browser`. Staff cannot override it. Saving a mode first runs a connection
test; an admin may explicitly save after a failed test with a visible warning.

Playwright performs login and controlled relogin for both modes. Request mode calls the
observed quote endpoint from inside the authenticated browser page so the provider's
cookies, tokens, and browser-generated session context remain available. It does not
require transferring the session to a standalone Axios client. Browser mode operates
the quote form and captures the matching response or validated visible result. There is
no automatic cross-mode fallback. New attempts and user retries use the mode that is
current when they start, and every attempt records the actual mode.

Credentials remain environment-only:

- `AMAZON_SHIPPING_EMAIL` and `AMAZON_SHIPPING_PASSWORD`
- `MYUNISHIPPERS_EMAIL` and `MYUNISHIPPERS_PASSWORD`

Browser cookies and tokens stay in worker memory. A worker restart logs in again.
Authentication failure permits one relogin and one replay. Other provider errors and
timeouts remain failed until a user chooses Retry.

The admin may disable a provider with a maintenance message. Disabled providers are
omitted from new comparisons, remain visible in history, and cannot be retried while
disabled.

## Multiple packages

Amazon's observed estimator accepts one package. Quote each distinct package/rating
signature once, multiply compatible per-package transportation charges by the group
quantity, and sum the groups. Mark the total as a **calculated estimate**. Never
multiply shipment-level or pickup-level fees. Package signatures must include every
input that can change a rate, including origin, destination, ship date, dimensions,
weight, contents/customs, and requested options where supported.

myUnishippers supports native package quantities. Submit all groups in one shipment
request and use the returned whole-shipment total. Do not multiply that total again.
When myUnishippers request mode is the only selected provider, all three dimensions
may be blank and `billedDimension` is omitted. Dimensions remain all-or-none, and
Amazon, mixed-provider comparisons, and myUnishippers browser mode require them.
Weight is always required.

## Async lifecycle and retry

The authenticated API saves a comparison and its provider attempts immediately. The
worker leases and executes attempts. Amazon and myUnishippers may run in parallel, but
only one active attempt is allowed per provider account. Attempts are the durable work
queue; no external queue is introduced.

The frontend subscribes to an authenticated, comparison-specific SSE endpoint and
renders partial results. On reconnect it refetches the comparison snapshot. A worker
restart recovers an expired lease once; repeated recovery failure becomes a visible
failed attempt.

An idempotency key deduplicates an accidental repeated submission. Deliberately getting
updated rates creates a new comparison. Retry creates a new attempt under the same
comparison, preserves earlier attempts and successful quotes, and uses the original
immutable input. Retry is rejected when the provider is disabled, the ship date is in
the past, or current validation no longer accepts the input; the user must create a new
comparison instead.

SQ-V1-007 decisions: only the latest failed technical outcome (`timeout`,
`authentication_failed`, or `failed`) is retryable. Validation and unsupported
outcomes require Copy to new comparison. Staff can retry one provider while the
other is running, but at most one attempt per provider/comparison may be active.
Eligibility is rechecked at execution time, and no current sender-default refresh
replaces the original resolved sender.

## Results and ranking

Each service result displays:

- platform, delivering carrier, service, and provider origin;
- transportation total and native currency;
- estimated delivery or transit time;
- charge breakdown without invented or double-counted lines;
- retrieval time, provider expiry when available, and option coverage; and
- duty/tax/clearance status for international quotes.

Missing provider values display **Not provided**. USD is the primary comparison
currency. Non-USD results remain in their native currency for manual conversion.
Equivalent results may sort by transportation total and show **Lowest price** only
when origin, currency, packages, destination, ship date, and requested options match.

Provider expiry is authoritative. If no expiry is returned, an admin-configurable
stale period applies, defaulting to 24 hours. Expired or stale quotes remain in history.
They do not qualify for Lowest price. Equivalent fresh ties share the badge; when
every rate is stale or expired there is no winner. Requested options must have
confirmed coverage before ranking; mixed simulated and real quotes are not ranked.

## Persistence model

The implementation adds these tables through reviewed migrations:

| Table                     | Purpose                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shipping_providers`      | Stable platform adapter, enabled and international-carriage state, maintenance message, execution mode, and stale policy.             |
| `shipping_accounts`       | One configured account per provider and safe account/default metadata; never credentials or session secrets.                          |
| `quote_requests`          | Immutable comparison input, actor, idempotency key, timestamps, and soft-delete lifecycle.                                            |
| `quote_package_groups`    | Identical-box group, quantity, original units/values, and normalized provider conversion data.                                        |
| `quote_customs_items`     | Per-box international item snapshots belonging to a package group.                                                                    |
| `quote_provider_attempts` | Durable work item, account/provider, resolved sender and unit-conversion snapshots, mode, lease/recovery, outcome, and diagnostics.   |
| `shipping_quotes`         | Normalized service result, money, timing, estimate method, option coverage, international status, and calculated group contributions. |
| `shipping_quote_items`    | Provider charge lines with scope and optional package-group association.                                                              |

Every new foreign key explicitly uses `ON DELETE NO ACTION`. Quote input, senders,
results, and attempts are snapshots; later account/configuration changes do not rewrite
history. Persist normalized values and a sanitized diagnostic summary only. Full raw
provider payloads, browser storage, cookies, tokens, and credentials do not enter the
database or tracked artifacts.

Admin deletion is soft deletion and supports restore. Active queued or running
comparisons cannot be deleted. Permanent purge and attempt cancellation are deferred.
Deleted lists and direct detail links are admin-only; Staff receives 404 for deleted
detail. Restoration restores visibility without enqueuing work. The latest deletion
and restoration timestamps remain readable after restoration.

## Authorization and interfaces

All endpoints use the existing authenticated employee/admin model. Staff may create
comparisons, list and view all quote history, refresh defaults, and retry eligible
failures. Admin-only endpoints manage provider settings, run connection tests, soft
delete comparisons, and restore them.

The API exposes create/list/detail/retry/default-refresh operations plus a
comparison-specific SSE stream. Exact routes and DTO names belong to implementation,
but the domain behaviors and authorization above are fixed.

## Approved technical approach

No new production dependency is approved or required. Use the existing backend stack:
NestJS, TypeORM/PostgreSQL, Zod, Bottleneck, Playwright, and Nest/RxJS SSE. Request mode
uses an in-page authenticated HTTP call through Playwright. Use the existing frontend
stack: React, MUI, React Hook Form, TanStack Query, Zod, and the browser `EventSource`
API.

## Evidence and open contract verification

Sanitized research is in [`artifacts/shipping-calculator-findings/`](../../artifacts/shipping-calculator-findings/).
It verifies both browser logins without a challenge in the observed session, an Amazon
domestic single-package quote, a myUnishippers native two-package quote, and the
myUnishippers default-company-name validation failure and request-only correction.

Absence of CAPTCHA/MFA in one session is not a guarantee. Request mode is approved as
an authenticated in-browser HTTP call; standalone request-client replay is outside the
required design. Reproducible Playwright login/replay, browser-mode success,
international routes, positive signature/insurance mappings, account-default contracts,
and precise expiry behavior remain research gates in SQ-V1-001. Unsupported provider
capabilities must produce an explicit provider result; the unified input model does not
imply that every provider supports every lane.
