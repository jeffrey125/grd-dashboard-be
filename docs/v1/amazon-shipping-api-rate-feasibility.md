# Amazon Shipping API rate feasibility

Research date: 2026-10-22. Scope: official Amazon documentation only. No API
call, credential access, application submission, or implementation was performed.

## Verdict

**Yes.** Amazon Shipping API v2 can return shipping rates for a US shipment
originating outside Amazon Marketplace. Amazon's model explicitly supports
external channels, and `getRates` returns eligible offerings with service,
carrier, billed weight, pickup/delivery promise, and monetary `totalCharge`.
For off-Amazon shipments, the official reference limits the available carrier
to **Amazon Shipping**; this is not a general UPS/USPS/FedEx rating API.
Amazon also publishes a direct-integration path for US shippers that do not sell
on Amazon and says that path does not require an Amazon Seller account.
[Shipping API v2 reference](https://developer-docs.shipping.amazon.com/apis/docs/shipping-api-v2-reference),
[US off-Amazon example](https://developer-docs.shipping.amazon.com/apis/docs/tutorial-purchase-a-shipment-from-a-rate),
[non-Marketplace integration guide](https://developer-docs.shipping.amazon.com/apis/docs/off-amazon-guide).

That establishes general API capability, **not GRD production access**. A live
portal check on 2026-10-22 confirmed that the Global Resources Direct account
exists and may create sandbox applications. The portal says production access
still requires identity verification followed by profile/permissions setup.
There is no evidence yet that Amazon has approved the developer profile, granted
the Amazon Logistics role, linked an eligible US shipper/rate card, approved a
production application, or enabled production calls.

## Rate call contract

- Method and production URL:
  `POST https://sellingpartnerapi-na.amazon.com/shipping/v2/shipments/rates`.
  The documented US sandbox URL is
  `https://sandbox.sellingpartnerapi-na.amazon.com/shipping/v2/shipments/rates`.
  [Endpoint reference](https://developer-docs.shipping.amazon.com/apis/reference/getrates),
  [host and endpoint table](https://developer-docs.shipping.amazon.com/apis/docs/frequently-asked-questions).
- Authentication: self-authorization of a private app yields an LWA refresh
  token. Exchange it at `POST https://api.amazon.com/auth/o2/token` as
  `application/x-www-form-urlencoded` with `grant_type=refresh_token`,
  `refresh_token`, `client_id`, and `client_secret`. The returned access token
  expires after one hour.
  [LWA connection flow](https://developer-docs.shipping.amazon.com/apis/docs/connecting-to-the-selling-partner-api),
  [self-authorization](https://developer-docs.shipping.amazon.com/apis/docs/self-authorization).
- Rate request headers: send `Content-Type: application/json`, the LWA token as
  `x-amz-access-token`, and explicitly set
  `x-amzn-shipping-business-id: AmazonShipping_US`; otherwise the documented
  business default is UK. Amazon's general SP-API connection guide also lists
  `host`, `x-amz-date`, and a descriptive `user-agent`.
  [GetRates model](https://developer-docs.shipping.amazon.com/apis/docs/shipping-api-v2-model),
  [connection headers](https://developer-docs.shipping.amazon.com/apis/docs/connecting-to-the-selling-partner-api).
- Required top-level JSON for GRD's off-Amazon case: `shipTo`, `shipFrom`, one
  entry in `packages`, and `channelDetails: { "channelType": "EXTERNAL" }`.
  The OpenAPI schema formally requires `shipFrom`, `packages`, and
  `channelDetails`; `shipTo` is conditional and is required for an external
  order because only Amazon-channel orders source/ignore that address.
  `shipDate` is optional and defaults to the current date/time.
  [GetRates tutorial](https://developer-docs.shipping.amazon.com/apis/docs/tutorial-purchase-a-shipment-from-a-rate),
  [request schema](https://developer-docs.shipping.amazon.com/apis/docs/shipping-api-v2-model).
- Each address requires `name`, `addressLine1`, `city`, `stateOrRegion`,
  `postalCode`, and `countryCode`. Each package requires `dimensions`, `weight`,
  `insuredValue`, `items`, and a unique `packageClientReferenceId`; each item
  requires `quantity`. Dimensions require length, width, height and unit; weight
  requires value and unit.
  [OpenAPI component schemas](https://developer-docs.shipping.amazon.com/apis/docs/shipping-api-v2-model).
- A successful response contains `payload.requestToken`, eligible `rates`, and
  optionally `ineligibleRates`. A rate includes identifiers, carrier/service,
  billed weight, `totalCharge` and a pickup/delivery promise. Requesting rates
  alone does not purchase a label or create a shipment.
  [GetRates response model and US example](https://developer-docs.shipping.amazon.com/apis/docs/tutorial-purchase-a-shipment-from-a-rate).

The documented default usage plan for `getRates` is 5 requests per second;
Amazon can assign a different rate, exposed in `x-amzn-RateLimit-Limit`.
[Endpoint reference](https://developer-docs.shipping.amazon.com/apis/reference/getrates).

## One package versus multiple packages

Amazon currently limits each shipment to **one package**, even though the schema
represents packages as a list for forward compatibility. For a multi-box order,
Amazon instructs integrators to create a separate shipment for each package.
[Single-package limitation](https://developer-docs.shipping.amazon.com/apis/docs/tutorial-purchase-a-shipment-from-a-rate).

For GRD rate comparison, that means one `getRates` call per physical box. Any
combined multi-box quote would be GRD-owned aggregation of compatible per-box
offerings and currencies, not an Amazon-provided whole-shipment rate. Partial
responses must not be presented as a complete total.

## Sandbox versus production

The Shipping v2 model marks `getRates` as supporting Amazon's **dynamic
sandbox**. Dynamic sandbox calls use the same contract and sandbox host, are
forwarded to a sandbox backend, and can react to request inputs. They do not
prove that GRD's production account, rate card, lanes, or commercial prices are
active. Only an authorized production request can establish live eligibility
and live rates.
[Sandbox behavior](https://developer-docs.shipping.amazon.com/apis/docs/the-selling-partner-api-sandbox),
[Shipping v2 model](https://developer-docs.shipping.amazon.com/apis/docs/shipping-api-v2-model).

Amazon says a newly registered developer can create a sandbox app, generate a
token, and call Shipping v2 sandbox endpoints while production onboarding
continues. Amazon explicitly says this does not affect production access.
[Sandbox app credentials announcement](https://developer-docs.shipping.amazon.com/apis/changelog/amazon-shipping-v2-apis-access-via-sandbox-app-credentials).

## Account and launch gates

For a US non-Marketplace shipper, Amazon documents this sequence:

1. Create a Solution Provider Portal account and complete Developer Identity
   Verification; no Seller account is required for this route.
2. Submit the developer profile as a **Private Developer**, request the
   **Amazon Logistics** role, and complete the security-controls questionnaire.
   Amazon reviews the profile; the guide says to send the generated case number
   to the account manager and describes a five-business-day response target,
   not guaranteed approval.
3. After approval and role access, create an SP-API app with business entity
   **Shipping** and role **Amazon Logistics**, then self-authorize it to obtain
   the LWA refresh token.
4. Integrate and complete Amazon's testing/onboarding process. Amazon recommends
   rates, purchase, cancellation, and tracking support, followed by test-label
   sign-off and account-manager confirmation of the first shipping date. The
   published guide does not document a quote-only exemption.

Source: [Direct Integration with Amazon Shipping APIs for non-Marketplace sellers](https://developer-docs.shipping.amazon.com/apis/docs/off-amazon-guide).

## GRD-specific conclusion

The API is technically suitable for computing Amazon Shipping rates without
Playwright once GRD has all production access gates and credentials. The newly
created portal account currently permits sandbox app setup but is only the first
production gate. Before implementation can be called live-ready, the portal or
Amazon account manager must confirm all of the following: identity verification,
developer-profile approval, Amazon Logistics role grant, approved private
Shipping app, successful self-authorization, active US shipper/rate-card linkage,
accepted carrier terms, and production launch permission. The OpenAPI model
explicitly lists `TERMS_AND_CONDITIONS_NOT_ACCEPTED` as a reason an offering can
be returned as ineligible.
[Ineligibility reasons](https://developer-docs.shipping.amazon.com/apis/docs/shipping-api-v2-model).

No GRD credential, token, approval state, rate card, or production response was
inspected in this research.
