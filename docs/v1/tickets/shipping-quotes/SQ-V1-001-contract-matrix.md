# SQ-V1-001 provider contract matrix

## Verification boundary

This ticket provides test harnesses and sanitized evidence, not production quote
endpoints, database tables, or a frontend. Both modes use an authenticated
Playwright browser context. Request mode calls the provider endpoint with in-page
`fetch`; browser mode operates the native form and reads its matching response.
There is no standalone cookie export, automatic mode fallback, or purchase flow.

Live domestic quotes succeeded for both providers in both modes on 2026-10-19.
Earlier Amazon attempts intermittently returned HTTP 500 or a CVF verification
challenge. A later successful request does not establish that those failures are
resolved. The latest request-mode refresh succeeded for both providers.

The deterministic suite intercepts all browser requests and uses mock credentials
only. Its error responses establish harness behavior; they are not proof of a live
provider capability. The live runner is separately opt-in, quote-only, and prints
an allowlisted projection, never full provider responses, account identifiers,
contact details, cookies, or token values. Session context stays in memory.

## Reproduce

Use the existing Playwright, Zod, Vitest, TypeScript, and Node built-ins. No new
production dependency is needed. Supply credentials locally through the existing
ignored `.env` or environment; do not put values on the command line:

- `AMAZON_SHIPPING_EMAIL` / `AMAZON_SHIPPING_PASSWORD`
- `MYUNISHIPPERS_EMAIL` / `MYUNISHIPPERS_PASSWORD`

```sh
pnpm test:shipping-quotes
pnpm test:shipping-quotes:live -- --provider unishippers
pnpm test:shipping-quotes:live -- --provider amazon --interactive
```

`--interactive` opens visible Chromium. If a verification challenge appears, the
runner allows five minutes for the user to complete it in that same window, then
checks authentication again before quoting. It does not bypass verification or
persist session state. Headless runs report a challenge as a blocker. Without
usable credentials the live command skips and exits nonzero. A failed required
domestic mode makes the command exit nonzero even if the other mode succeeds.

The runner never accepts rates, changes account/address settings, creates a
shipment, books a pickup, buys a label, or starts a tracking record.

## Live domestic evidence

Route: US 53125 to US 10118; each package is 10 × 8 × 6 inches and 5 lb.
Amounts are observed USD transportation estimates, not price guarantees.

| Provider / mode         | Packages sent | Result                                                                                                  |
| ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| Amazon / request        | 1             | HTTP 200; USD 13.81 per package, confirmed again in the latest refresh                                  |
| Amazon / browser        | 1             | HTTP 200; USD 13.81 per package                                                                         |
| myUnishippers / request | 2             | HTTP 200; seven UPS services; Ground USD 24.16 for both packages, confirmed again in the latest refresh |
| myUnishippers / browser | 1             | HTTP 200; seven UPS services; Ground USD 12.08                                                          |

Amazon does not return a native two-package total. USD 27.62 is a calculated
estimate from two compatible USD 13.81 package quotes. That aggregation belongs
to later application implementation; the harness returns a single-package result.
myUnishippers' USD 24.16 is already the whole-shipment total; never multiply again.

The final fresh CLI runs passed both required domestic modes for both providers
and exited zero. Amazon used visible Chromium; no manual verification was needed.
An earlier fresh Amazon run returned 500 in request mode and 200 in browser mode,
and correctly exited nonzero. Subsequent guarded request calls also returned 200.
The cause of the intermittent 500 remains unknown; no speculative header fix,
transport retry, or cross-mode fallback was added.

## Capability matrix

| Capability                 | Amazon Shipping                                                                                | myUnishippers                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Domestic lane              | Live verified for the tested US route                                                          | Live verified for the tested US route                                                         |
| International lane         | Unverified; native estimator has no country/customs input; live runner skips Canada            | Tested Canada ESTIMATE returned 422; account-wide international capability remains unverified |
| Account default retrieval  | Proposal/account context verified; complete safe sender snapshot and refresh remain unverified | Profile namespace verified; complete safe sender snapshot and refresh remain unverified       |
| Units                      | Inches / pounds verified                                                                       | Inches / pounds verified                                                                      |
| Request package quantity   | One package per call; application aggregation must be marked as calculated                     | Two explicit handling-unit entries verified; do not rely on a quantity field in ESTIMATE      |
| Browser package quantity   | Single-package native estimator                                                                | Native Quick Quote dialog supports one domestic package; other inputs stop with a blocker     |
| Signature                  | Unverified                                                                                     | Positive selection and pricing unverified                                                     |
| Insurance / declared value | Unverified                                                                                     | Positive selection and pricing unverified                                                     |
| Duty / tax                 | Unverified; do not display unknown as zero                                                     | Unverified; do not display unknown as zero                                                    |
| Charge scope               | Single-package transportation estimate; pickup fees not established                            | Native whole-shipment transportation estimate                                                 |
| Transit data               | Unverified                                                                                     | Service descriptions observed under `timeInTransit`; timing semantics still need mapping      |
| Quote expiry               | Unverified                                                                                     | `expirationDate` observed; provider timezone and expiry semantics unverified                  |
| Request mode               | Live success; intermittent provider 500 remains open                                           | Live success with two packages                                                                |
| Browser mode               | Live success using View → Calculate rates → Estimate rate                                      | Live success using QUICK QUOTE → GET QUOTE                                                    |

## Authentication and bootstrap

Every public quote method calls the authentication guard first. It reloads the
protected provider entry page, checks the rendered login/quote state, and requires
fresh successful bootstrap context. A stale cookie or DOM alone is insufficient.
Valid sessions are reused within the same browser context. A login form or
preflight 401/403 starts authentication; unexpected pages, failed bootstrap,
unavailable pages, or missing identifiers stop without guessing context.

Login continues on the form reached by the provider's redirect. When navigation
is required, it starts at the protected quote entry URL so the provider supplies
its own login host and redirect parameters. A quote-time 401/403 permits one
forced login and one replay in the same mode. A second expiry is surfaced. Other
HTTP failures remain explicit provider results; there is no automatic 500 retry.

### Amazon

Protected entry: `https://ship.amazon.com/getstarted/progress?show=rates`.
The real flow exposes **View**, then **Calculate rates**, then the calculator.
The harness waits for rendered controls after redirects rather than assuming the
URL change means the document is ready. It never clicks **Accept rates and
continue** or **Start over**.

`GET /hz/getLatestProposalSharedWithShipper` supplies
`rateCardProposal.merchantId` and `rateCardProposal.simulatedShipperId`. The
current native request supplies `x-xsrf-token`; those values are held in a private
per-page session. Quotes use cookies plus the XSRF header and JSON content type:

```text
POST /shipping-rates/getRates?merchantId=<dynamic>&simulatedShipperId=<dynamic>
body: originZip, destinationZip, length, width, height, weight, serviceCode
```

No quantity, country, or customs input is sent by the native estimator. CVF paths,
verification page titles, CAPTCHA, OTP, and MFA controls produce a challenge.
The live runner skips Amazon international tests rather than treating a synthetic
fixture's 422 response as live international evidence.

### myUnishippers

Protected entry: `https://www.myunishippers.com/ship/small-package`.
Login follows the provider's Auth0 Email → Continue → Password → Continue flow.
The authenticated shipping page also contains a contact Email field; that field
is not used as a login signal. Readiness uses the **QUICK QUOTE** control.

`POST /svc/getUserProfileFlow` supplies a successful profile and
`response.orgUnit.namespace`. Its request has authorization but does not supply
the session header. The harness also waits for a native same-origin `/svc/`
request with both `authorization` and `x-session-token` (observed on
`getNotificationCountFlow`), preserving optional `cachettl`. These header values
are kept only in memory and used only inside the authenticated page.

Request mode sends `POST /svc/shopFlow` with `productType: SMALLPACK`,
`mode: ESTIMATE`, postal/country addresses, `orgInfo.namespace`, and one
`handlingUnitList` entry per box. Dimensions are value/unit objects in inches;
weight is a value/unit object in pounds; packaging is Custom (`02`). A single
entry with a quantity property was observed to return one package, so the harness
submits explicit entries and checks returned package counts. The local request
guard permits integer quantities 1–50; only one and two packages are live verified.

The estimate request sends no company name or saved sender mutation. Historical
full-shipment company-name validation (`ERR_TOO_LONG`) remains a separate fixture;
it is not a current ESTIMATE blocker and requires no company override.

Browser mode fills the real Quick Quote dialog's Sender Zip, Delivery Zip, Length,
Width, Height, and Weight, then captures **GET QUOTE**. Multiple boxes or non-US
input stop explicitly; the harness does not silently submit one box or change mode.

## Sanitization and remaining gates

Live output includes status, endpoint path, header names, identifier names, money,
carrier/service, package count, and provider expiry text only. Zod strips unknown
response fields before output. A failed `clientStatus` is never counted as a quote.
No full response, account contact, namespace, merchant ID, cookie, credential, or
authorization/session token value is logged or written to a fixture.

The ten sanitized scenarios cover domestic success in both modes, validation,
authentication expiry, and unsupported routes. Amazon validation/unsupported
responses are simulated contract cases. They do not establish live provider
support. Missing capability mappings must remain blocked until verified.

Remaining research: Amazon intermittent 500, complete safe sender refresh,
international/customs, positive signature/insurance behavior, and precise transit
and expiry semantics. Production API/worker/frontend integration belongs to
SQ-V1-002 onward. These boundaries do not prevent the verified domestic harness
from being used for quote-only checks.
