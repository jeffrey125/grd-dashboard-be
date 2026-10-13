# Local UPS raw response capture

## Location and provenance

The user requested a live production lookup and local retention of its complete
tracking response. The saved file is in the repository's `tmp/` directory:
[`tmp/ups-1ZK580F40320515041-raw.json`](../../tmp/ups-1ZK580F40320515041-raw.json).
The entire root `tmp/` directory is ignored by Git; the capture will not exist
in a fresh checkout.

| Detail                   | Value                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Tracking reference       | `1ZK580F40320515041`                                               |
| Environment              | UPS production                                                     |
| Tracking request started | October 13, 2026, 13:58:25 UTC / 21:58:25 Asia/Manila              |
| HTTP result              | 200                                                                |
| Capture size             | 14,771 bytes                                                       |
| File permissions         | `0600` (owner read/write only)                                     |
| SHA-256                  | `07befee6dbcfc417c0b4a3cfdf4dd69e97bf7d1af4d9c8b177641834af240866` |

The second live lookup used the compiled V1-013 adapter and native Axios transport
with local credentials. OAuth and tracking each succeeded on their first request;
the limiter spaced them six seconds apart. The temporary capture harness saved
only the tracking response body, then closed its session, HTTP client, and cache.
No database write was made.

## Contents

This is the full parsed tracking JSON, pretty-printed with two-space indentation.
It preserves provider fields but is not a byte-for-byte HTTP wire capture.
OAuth responses, access tokens, request credentials, and HTTP headers are excluded.

The top-level `trackResponse.shipment` array includes shipment metadata and the
package. Package fields include current status, delivery dates/time, 12 activity
entries, package addresses, service, weight, dimensions, reference numbers, and
delivery information. Personal or account information remains in the ignored
local file rather than being reproduced in this document.

The adapter normalized this capture to:

```json
{
  "outcome": "found",
  "snapshot": {
    "carrierStatus": "Out for Delivery",
    "carrierStatusDetail": null,
    "pickedUpOn": null,
    "estimatedDeliveryOn": "2026-10-13",
    "deliveredOn": null
  }
}
```

This is a historical response; the local file does not update automatically.

## Scope and verification

This user-authorized local diagnostic capture does not introduce automatic raw
response retention. Normal persistence still follows the UPS allowlist in
[`tracking-source-data-policy.md`](tracking-source-data-policy.md). The complete
capture is neither an ordinary CI fixture nor a database `source_data` value.

The local file was copied unchanged from the temporary capture and verified by
byte equality, JSON parsing, SHA-256, owner-only permissions, and
`git check-ignore -v tmp/ups-1ZK580F40320515041-raw.json`. Only the ignore rule and
documentation are intended for version control.
