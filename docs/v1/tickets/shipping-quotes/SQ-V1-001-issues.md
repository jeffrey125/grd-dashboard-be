# SQ-V1-001 implementation issues and follow ups

Last implementation evidence: 2026-10-19. SQ-V1-001 completed its provider-contract
and test-harness scope. Both providers returned domestic quotes in request and
browser modes. The open items below remain limits on dependent capabilities or
production integration; they do not mean every part of the calculator is ready.

Use the issue IDs below when returning to this work, for example: “Investigate
SQ-V1-001-O01.” These are references within this document, not separate tracker
tickets. Start with O01 and O02 for runtime reliability, then the item needed by
the next feature. Later-ticket links identify relevant work, not a new assignment
or permission to broaden its scope.

## Evidence and implementation

- [Contract matrix](SQ-V1-001-contract-matrix.md): current provider contracts and
  capability boundaries.
- [Implementation summary](../../implementation-summary/SQ-V1-001-implementation-summary.md):
  files, verification, and review notes.
- Harness commit: `ca9c409` —
  `test(shipping-quotes): SQ-V1-001 add authenticated provider contract harness`.
- Evidence commit: `db71cf3` —
  `docs(shipping-quotes): SQ-V1-001 record verified provider contracts`.

The accepted test shipment was US 53125 → US 10118, 10 × 8 × 6 inches and 5 lb per
box. Amazon returned USD 13.81 for one box. myUnishippers returned seven UPS
services: Ground was USD 24.16 for two boxes in request mode and USD 12.08 for one
box in browser mode. These are dated observations, not guaranteed current prices.

Recorded verification passed 50 contract tests, 275 unit tests, formatting, lint,
typecheck, and build. Final fresh CLI runs for both providers exited zero after
both required domestic modes passed. Earlier failures remain relevant below.

## Open reliability issues

### SQ-V1-001-O01 Amazon intermittently returns HTTP 500

**Status:** Open; cause unproven. Earlier fresh-session request attempts returned
500 while the same run's native browser quote returned 200. Later guarded
requests and the final fresh CLI run returned 200 in both modes.

**Impact:** One successful refresh does not establish reliable unattended request
execution. The harness reports the failed attempt; it does not manufacture a
price, retry 500 automatically, or switch modes.

**Return here:** Compare fresh and reused sessions on the same allowed route.
Record safe status/timing information and native request structure. An exploratory
`Accept: application/json` change succeeded once, but an unchanged request also
succeeded later; a missing header is not an established cause and no speculative
header fix was committed. Bootstrap timing is also unproven as a cause.

**Close when:** A reproducible cause has a verified correction and regression
coverage, or repeatable evidence supports a documented provider-side operational
limit. Record failures as well as successful runs. Relevant follow-up:
[SQ-V1-004](SQ-V1-004-amazon.md) and [SQ-V1-009](SQ-V1-009-readiness.md).

### SQ-V1-001-O02 Human verification can block unattended Amazon login

**Status:** External limitation with a manual test workaround. Headless login
sometimes reached `/ap/cvf/request` with an authentication-verification page.
Visible-browser runs subsequently logged in successfully, including the final run
without manual intervention. This is not proof that challenges are gone.

**Current handling:** Challenges stop headless execution explicitly. The live CLI's
`--interactive` mode allows five minutes for the user to finish verification in
the same browser, then checks authentication again. Verification is not bypassed,
and cookies/tokens are not exported or persisted.

**Close when:** The production connection/recovery workflow has a tested operator
path and clearly surfaces challenges/timeouts without repeated credential
submission. Relevant follow-up: [SQ-V1-004](SQ-V1-004-amazon.md),
[SQ-V1-008](SQ-V1-008-admin-controls.md), and [SQ-V1-009](SQ-V1-009-readiness.md).

## Open provider capability issues

### SQ-V1-001-O03 Complete sender defaults and account context remain unverified

**Status:** Partially verified. Amazon merchant/proposal/XSRF context and
myUnishippers profile namespace/authentication headers are dynamically resolved.
That does not establish a complete safe default sender contract: company/name,
street, city/division, postal/country, freshness, and comparison-only correction.
The current ESTIMATE path does not establish a separate billing identifier.

**Impact:** Later adapters must not treat bootstrap readiness as successful default
address refresh, invent account/billing fields, or compare different origins as
though they were identical.

**Close when:** Both providers have verified default-refresh and explicit-sender
contracts, safe snapshots and retrieval timestamps, and actionable failure cases
without saved provider mutations. Relevant follow-up:
[SQ-V1-004](SQ-V1-004-amazon.md) and [SQ-V1-005](SQ-V1-005-unishippers.md).

### SQ-V1-001-O04 International routes and customs are not established

**Status:** Unverified beyond one rejection. Amazon's estimator exposes no
country/customs input; the live runner skips Canada. Amazon's synthetic 422 fixture
tests failure handling, not actual international support. myUnishippers ESTIMATE
with destination CA / H2Y 1C6 returned 422 with no services; account-wide
international capability was not established by that result.

**Impact:** Domestic success cannot enable international coverage, customs mapping,
or duty/tax claims. Unknown duty/tax/clearance amounts must not display as zero.

**Close when:** A safe, quote-only route verifies the required country/customs
contract and response, or capability is explicitly recorded as unsupported for
that route/mode. Preserve provider-specific outcomes. Relevant follow-up:
[SQ-V1-006](SQ-V1-006-international-options.md).

### SQ-V1-001-O05 Positive signature and insurance pricing are unverified

**Status:** Unverified. No positive live selection established that a requested
signature service, insurance, or declared-value option was included or priced.
Historical field presence is insufficient evidence.

**Close when:** Positive and rejected/unsupported cases have sanitized contracts
and demonstrate option coverage and pricing. Keep insurance distinct from customs
value, and show unsupported/unverified rather than assuming inclusion. Relevant
follow-up: [SQ-V1-006](SQ-V1-006-international-options.md).

### SQ-V1-001-O06 myUnishippers browser mode cannot represent multiple boxes

**Status:** Known limit of the verified native Quick Quote dialog. It accepts one
domestic package. The harness blocks quantity other than one or country other
than US before submitting the quote. Request mode's two-package success does not
establish multi-package browser support.

**Impact:** The later browser adapter needs another verified native form path or
an explicit unsupported outcome for these inputs. It must not silently quote one
box, multiply its price, or fall back to request mode.

**Close when:** A native browser flow correctly submits all requested package
groups and the provider returns matching counts/totals, or the mode's restriction
is explicitly exposed to users and enforced. Relevant follow-up:
[SQ-V1-005](SQ-V1-005-unishippers.md).

### SQ-V1-001-O07 Amazon aggregation remains application work

**Status:** Known single-package contract. USD 27.62 for two compatible boxes is a
calculated estimate from two USD 13.81 package amounts, not a native two-package
provider quote. The harness itself does not aggregate package groups.

**Close when:** The adapter deduplicates complete rating signatures, sums compatible
groups, multiplies only confirmed package-scoped transportation charges, preserves
currency, and labels the result as calculated. Shipment/pickup fees must not be
multiplied; their coverage was not established by the estimator. Relevant
follow-up: [SQ-V1-004](SQ-V1-004-amazon.md).

### SQ-V1-001-O08 Transit and expiry semantics need mapping

**Status:** Partially verified for myUnishippers, unverified for Amazon. Native
myUnishippers offers contained service descriptions under `timeInTransit` and an
`expirationDate` string. The expiry string's timezone and precise semantics were
not verified; full transit/delivery normalization also remains open.

**Close when:** Response semantics and timezone/expiry handling are verified with
fixtures, service/transit values are normalized without invention, and missing
expiry uses the approved stale policy. Relevant follow-up:
[SQ-V1-004](SQ-V1-004-amazon.md), [SQ-V1-005](SQ-V1-005-unishippers.md), and
[SQ-V1-007](SQ-V1-007-history-retry.md).

### SQ-V1-001-O09 Broader shipment inputs are not live verified

**Status:** The smoke route uses identical boxes in inches/pounds. Request-mode
myUnishippers quantities one and two were verified. Its local guard permits
integers 1–50; that ceiling is a harness constraint, not an observed provider
guarantee. The flat `QuoteInput` does not establish mixed package groups, metric
conversion, or a user-selected ship-date contract.

**Close when:** Each needed input has a verified mapping or explicit unsupported
result, including group expansion, dimensions/weight conversion and rounding, and
ship-date behavior. Preserve original input in later history. Relevant follow-up:
[SQ-V1-004](SQ-V1-004-amazon.md), [SQ-V1-005](SQ-V1-005-unishippers.md), and
[SQ-V1-006](SQ-V1-006-international-options.md).

## Deferred production integration

### SQ-V1-001-O10 The harness is not the application quote feature

**Status:** Deferred by ticket scope, not a harness regression. No quote API,
comparison persistence, provider worker execution/serialization, SSE, frontend,
history/retry, or admin connection controls were implemented in 001.

**Close when:** The relevant [SQ-V1-002 through SQ-V1-009 tickets](README.md) meet
their own criteria and full-stack checks. The 001 contract/unit test totals are
not evidence that production database, full integration/e2e, container, deployment,
or operational recovery gates passed. No new hosting/deployment choice is implied.

## Resolved implementation problems

These fixes are in the harness commit. Reopen the corresponding row only if the
symptom returns; do not reintroduce the old assumptions while adding adapters.

| ID            | Symptom and cause                                                                                                                                                   | Resolution and evidence                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQ-V1-001-R01 | Actions could rely on stale page/session state, and retry ownership could be duplicated by callers.                                                                 | Every public quote action performs a fresh authentication/bootstrap check. Valid sessions are reused; a quote-time 401/403 permits one forced login and one replay. Fixtures cover initial login, reuse, revocation, a second expiry, and unavailable pages. |
| SQ-V1-001-R02 | Amazon login discarded the correct sign-in redirect and opened `/ap/signin` on the shipping host.                                                                   | Reuse the provider-reached login form; start necessary navigation at the protected quote URL. Initial-login fixtures check that the form is not needlessly loaded twice.                                                                                     |
| SQ-V1-001-R03 | Amazon reached the rates URL but the old logic expected calculator inputs immediately. The document could still be rendering.                                       | Wait for a visible rates control, follow View → Calculate rates, then require the origin input. The native-shaped fixture and live browser quotes passed.                                                                                                    |
| SQ-V1-001-R04 | Fake DOM attributes/stored identifiers did not represent real provider bootstrap.                                                                                   | Resolve Amazon merchant/proposal values and XSRF context from the native proposal exchange, and myUnishippers namespace from a successful profile. Missing bootstrap context raises a blocker; nothing is hardcoded from the account.                        |
| SQ-V1-001-R05 | myUnishippers was treated as a direct origin-field quote form; its shipping contact Email could be mistaken for login. Generic waits appeared to be login timeouts. | Use Auth0-specific login controls and QUICK QUOTE readiness, then open the real dialog. Fixture pages include the unrelated contact Email field; live login and both modes passed.                                                                           |
| SQ-V1-001-R06 | The myUnishippers profile request did not contain `x-session-token`, so it could not supply all required request headers.                                           | Resolve namespace from the profile and capture both authorization/session headers from a native same-origin service request; observed on `getNotificationCountFlow`. Values remain in memory.                                                                |
| SQ-V1-001-R07 | A simplified myUnishippers payload did not match native dimensional/weight and estimate structure.                                                                  | Send SMALLPACK / ESTIMATE with value/unit objects, Custom packaging, postal/country addresses, and the runtime namespace. Native-shaped fixtures and live request quotes passed.                                                                             |
| SQ-V1-001-R08 | One handling unit with a quantity property still returned one package, risking an understated shipment total.                                                       | Expand one explicit handling-unit entry per box. The two-box request and returned package counts match; Ground USD 24.16 is used once as the whole-shipment total.                                                                                           |
| SQ-V1-001-R09 | An earlier full-shipment path encountered date requirements and the sender company 35-character `ERR_TOO_LONG` constraint.                                          | Use the native postal-code ESTIMATE path, which sends no company name. It succeeds without an account/address edit or company override. Historical company validation remains a separate fixture; O03 covers future full sender contracts.                   |
| SQ-V1-001-R10 | Live execution could obscure a successful mode when another failed, overstate Canada support, or confuse one-box and two-box results.                               | Report each mode independently with requested package count and provider result. Optional Canada failure does not fail the domestic gate. Amazon Canada is skipped, Amazon domestic requests one box, and returned myUnishippers package counts are checked. |
| SQ-V1-001-R11 | Full provider responses could contain account/contact fields, and failed client status could be mistaken for offers.                                                | Zod projects only allowlisted rate fields; failed `clientStatus` yields zero services. A regression adds synthetic private fields to both responses and proves they are absent from summaries. No raw live payload is printed.                               |

The old documentation claiming that both providers remained blocked before any
quote was corrected after the real flows succeeded. Treat O01/O02 as the remaining
Amazon limits, not the superseded assumption that neither provider can log in.

## Constraints to preserve

1. Use authenticated in-browser HTTP for request mode. Keep session values in
   memory, and log only safe summaries/header names. Credentials remain local
   environment values, not test-fixture inputs.
2. Each action reloads and checks the protected entry page. This adds latency but
   avoids trusting cached DOM/cookies. A new process starts a new browser session;
   cross-process session persistence is not implemented.
3. Retry authentication once on 401/403. Surface other failures and unsupported
   capabilities explicitly, preserving the selected mode.
4. Keep provider platform distinct from delivering carrier, and preserve native
   whole-shipment totals versus calculated package estimates.
5. Stay quote-only: no rate acceptance, account/address saves, shipment creation,
   labels, booking, or pickups. Diagnostic screenshots/probes from implementation
   were removed; do not depend on them to reproduce a check.

## Resume and verify

Run from `grd-dashboard-be`. The deterministic suite intercepts browser requests
and uses mock credentials. The live commands contact providers for quote-only
checks and use local environment values:

- `AMAZON_SHIPPING_EMAIL` / `AMAZON_SHIPPING_PASSWORD`
- `MYUNISHIPPERS_EMAIL` / `MYUNISHIPPERS_PASSWORD`

```sh
pnpm test:shipping-quotes
pnpm test:shipping-quotes:live -- --provider unishippers
pnpm test:shipping-quotes:live -- --provider amazon --interactive
```

Read each mode's `success`, HTTP status, requested/returned package count, and
charge scope. The live command exits nonzero if either required domestic mode
fails, even when another mode succeeds. A challenge requiring a person must be
completed in the same visible browser within five minutes; timeout is a blocker.

For code changes, run the relevant regression and `pnpm check`. Capture only
sanitized outcomes. To close an open item, update its status, dated evidence,
closing condition, and relevant regression reference here, then update the
contract matrix when a capability changes. Keep resolved history so a later
regression can be recognized without repeating the original investigation.
