# Amazon browser-session recovery — retired

SQ-V1-011 replaced Amazon Shipping browser automation with Shipping API v2 sandbox
access. The worker no longer launches an Amazon browser, saves Amazon cookies,
opens a debugging port, exposes a verification socket, or accepts staff CAPTCHA
input.

Remove these retired values and mounts from VM configuration during rollout:

- `AMAZON_SHIPPING_EMAIL`
- `AMAZON_SHIPPING_PASSWORD`
- `AMAZON_SESSION_DIRECTORY`
- `AMAZON_SESSION_KEY_FILE`
- `AMAZON_SESSION_DEBUG_PORT`
- `AMAZON_VERIFICATION_SOCKET`

Configure the worker with:

- `AMAZON_SP_API_SANDBOX_CLIENT_ID`
- `AMAZON_SP_API_SANDBOX_CLIENT_SECRET`
- `AMAZON_SP_API_SANDBOX_REFRESH_TOKEN`

Sandbox quotes are simulated test data, not live commercial prices. See the
[SQ-V1-011 ticket](tickets/shipping-quotes/SQ-V1-011-amazon-sp-api-sandbox.md)
and [Amazon API feasibility report](amazon-shipping-api-rate-feasibility.md).
