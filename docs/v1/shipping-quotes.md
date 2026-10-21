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
- one explicit US sender shared by every selected provider;
- a US destination (international submissions are disabled for the v1 release);
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

## Senders

Every new comparison requires one explicit US sender shared by all selected providers.
The API retains per-provider snapshots and rejects differing sender addresses.
The application never saves the entered sender to a provider account.
Historical comparisons that used an account default remain readable and copy their
resolved sender into editable explicit fields. Admin default refresh remains available
only as provider-account diagnostics.

## US-only shared form release

The 2026-10-22 approved release decision supersedes earlier international input UI
requirements for new comparisons. Both sender and destination must be US; the API
rejects non-US destinations and customs data. Historical international records remain
readable. Provider selection preserves the single sender, including when all services
are temporarily deselected. New providers reuse the shared form.

Signature and insurance are entered once and mapped only to supporting selected
providers, with unsupported services identified before submission. Both current
adapters advertise no support, so these controls are absent today. Options that differ
across provider requests remain subject to the existing comparable-price ranking rules.
Only genuinely provider-specific inputs belong in a provider-specific section.

Discovery returns `inputRequirements` for sender and destination: `requiredFields`
(contactName, phone, division), `maxNameLength`, `maxStreetLength`, and
`maxContactNameLength`. Shared fields become required if
any selected provider needs them; validation identifies that provider. The same
backend requirement definition drives discovery and submission validation.
myUnishippers limits the sender company/name to 35 characters. Its current Quick
Quote flow does not require contact name or phone. Reuse React Hook Form, MUI, Zod
and installed standards libraries, with the approved provider mappings.

## Provider execution

Amazon is fixed to `api` mode. It uses Shipping API v2 through Amazon's dynamic
sandbox with environment-only LWA client ID, client secret and refresh token. No
Amazon email/password login, Playwright page, cookie/session persistence, CAPTCHA
bridge or provider-account mutation remains. Readiness retrieves an LWA token but
does not request a rate.

myUnishippers retains its admin-controlled `request` and `browser` modes and
environment-only `MYUNISHIPPERS_EMAIL` / `MYUNISHIPPERS_PASSWORD`. Its existing
Playwright-authenticated request/browser behavior is unchanged. New attempts and
user retries use the current provider mode when they start, while historical
attempts retain their recorded mode. Authentication failure permits one relogin
and replay; other provider failures wait for an explicit Retry.

The admin may disable a provider with a maintenance message. Disabled providers are
omitted from new comparisons, remain visible in history, and cannot be retried while
disabled.

## Multiple packages

Amazon Shipping API is called once for every physical package because sandbox/live
multi-package rate semantics are not assumed. Return only carrier/service/currency
combinations present for every package, sum their exact package charges with
Decimal.js, and mark multi-package totals as a **calculated estimate**. Fail closed
when any package has no eligible rate or there is no common service.

myUnishippers Quick Quote accepts one box. Drive Quick Quote once to capture its
current authenticated `/svc/shopFlow` request, then replay that captured request for
each additional distinct box signature. Multiply compatible per-package charges by
each group quantity and sum the groups with Decimal.js. Mark multi-box or multi-group
totals as calculated estimates and fail closed when charge lines do not reconcile to
the returned one-box total. A myUnishippers-only comparison may omit all three
dimensions; its Quick Quote request omits `billedDimension`. Partial dimensions and
every Amazon-inclusive comparison remain invalid. Weight is always required. Quick
Quote does not carry a selectable shipment date, so myUnishippers is eligible only
when the comparison ship date is today in `America/New_York`.

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

Historical Amazon browser failures such as `verification_required` remain readable.
Retrying an eligible historical failure creates a new attempt in the current `api`
mode; no browser challenge UI is available.

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
stale period applies, defaulting to 1 hour. Expired or stale quotes remain in history.
They do not qualify for Lowest price. Equivalent fresh ties share the badge; when
every rate is stale or expired there is no winner. Requested options must have
confirmed coverage before ranking; mixed simulated and real quotes are not ranked.
Amazon sandbox quotes are always simulated, show **Amazon sandbox mode — test data,
not live commercial prices**, and never receive a Lowest price badge.

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

SQ-V1-011 approves `@sp-api-sdk/shipping-api-v2@3.1.7` and
`@sp-api-sdk/auth@3.1.6` for Amazon's generated Shipping v2 contract, sandbox endpoint,
LWA token lifecycle and 429 retry. Keep Zod runtime validation and Decimal.js
aggregation at the application boundary. Playwright remains for myUnishippers and
tracking only. The frontend uses its existing React, MUI, React Hook Form, TanStack
Query, Zod and browser `EventSource` stack.

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

## SQ-V1-008 administration decisions

Admins manage provider settings and refresh account defaults on `/admin/shipping-providers`.
Readiness tests authenticate, resolve account/default context and inspect the proposed
mode without requesting a sample rate. Sample-rate testing is part of SQ-V1-009.
A test result is valid for 15 minutes and bound to the provider, proposed mode,
settings revision and testing admin. Failed tests require explicit acknowledgment;
only allowlisted failure summaries are stored. Settings saves use revision checks
so concurrent edits cannot silently overwrite each other.

Stale periods accept 1–168 whole hours, defaulting to 1 hour. Changes apply immediately
to existing quotes without provider expiry; increasing the period can make a quote
fresh again. Provider expiry remains authoritative. The migration changes the old
24-hour seeded value to 1 hour and caps out-of-range legacy values at 168 hours.

Sender-default refreshes are usable for 15 minutes, enforced by the API. The last
successful address and retrieval time remain available as visibly cached/stale data
after a refresh fails. A new form always refreshes selected defaults; cached defaults
alone never authorize submission. Staff may refresh enabled providers' defaults.

Disabling a provider prevents new comparisons/retries and prevents queued work from
calling that provider. Already-running requests may finish. Lease recovery retains
the original execution mode; a genuinely new attempt uses current mode at start.
Readiness and default refresh share account exclusion with quote execution. Readiness
can test a disabled provider before an admin enables it; default refresh requires an
enabled provider. Readiness results persist across API restarts; interrupted tests
expire with a safe timeout and require an explicit new test.

### Amazon browser verification retirement

SQ-V1-011 removes the Amazon browser/session/CAPTCHA runtime and staff verification
endpoint. Amazon uses sandbox API credentials only. Historical browser outcomes
remain immutable evidence; they do not reactivate the retired flow.
