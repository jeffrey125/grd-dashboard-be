# Tracking source-data policy

## Status

Partially approved. Nullable `tracking_attempts.source_data jsonb` is part of the
initial PostgreSQL schema. V1-011 approves storing an optional adapter-sanitized,
allowlisted JSON object unchanged for `found`, `not_found`, and `failed` attempts;
`skipped` attempts always store null. Retention, additional version columns, and
exact raw-artifact storage remain deferred and must not be implemented without
explicit approval.

## Terminology

- **Normalized snapshot:** the carrier-independent tracking fields used by the application, such as carrier status and normalized pickup/delivery dates.
- **Source data:** the allowlisted carrier fields that an adapter actually consumed before normalization.
- **Raw artifact:** the exact carrier response or browser artifact, such as a complete UPS response, an FFE XML export, EchoShip HTML, or a screenshot.

Source data and raw artifacts are not shipment snapshots. They are evidence associated with a tracking attempt or run.

## Approved schema field

Store only sanitized, allowlisted Carrier fields in the approved initial column:

| Column                  | Type               | Status   | Purpose                                                    |
| ----------------------- | ------------------ | -------- | ---------------------------------------------------------- |
| `source_data`           | `jsonb null`       | Approved | Sanitized Carrier-specific fields consumed by the adapter. |
| `source_schema_version` | `smallint null`    | Deferred | Version of the stored source-data shape.                   |
| `adapter_version`       | `varchar(50) null` | Deferred | Mapper version that produced the normalized result.        |

Do not add the two deferred version columns to the initial schema without explicit approval.

### UPS allowlist example

V1-013 persists only the exact matched package's `trackingNumber`,
`currentStatus.description`, optional `currentStatus.simplifiedTextDescription`,
and optional `deliveryDate` entries containing only `type` and `date`. Original
allowlisted strings are retained before normalization; additional package/status/
date fields and sibling packages are discarded. UPS failed/not-found outcomes
store null source data. Invalid or oversized responses never enter persistence.

```json
{
  "trackingNumber": "1Z999AA10123456784",
  "currentStatus": {
    "description": "In Transit",
    "simplifiedTextDescription": "Moving"
  },
  "deliveryDate": [
    {
      "type": "RDD",
      "date": "20260922"
    }
  ]
}
```

### FFE allowlist example

V1-015 uses this exact eight-field projection of the selected JSON record in both
request and browser modes. Missing optional values are null; raw date/status
strings remain unchanged. No XML is downloaded. Failed/not-found source data is
null; sibling records and all unlisted fields are discarded.

```json
{
  "orderNumber": "9685575",
  "shipmentStatus": "Delivered",
  "pickupDate": "2026-09-03T00:00:00",
  "apptPickupDate": "2026-09-02T00:00:00",
  "apptDeliveryDate": "2026-09-10T00:00:00",
  "schedDeliveryDate": null,
  "requestedDeliveryDate": null,
  "deliveryDate": "2026-09-11T00:00:00"
}
```

### EchoShip allowlist example

V1-014 stores this projection for successful request-mode lookups. Only the
selected event (modified date descending, then created date descending) is retained,
never the complete history or list. Missing
optional load values are null; optional event fields may be omitted. IDs are
canonical strings; original date and status strings remain unconverted.
The load projection includes the nullable raw detail `status`. When tracking
history is empty, it supplies the normalized status and `trackingEvent` is null.
Historical source data may omit `load.status`; no backfill is required.

```json
{
  "load": {
    "id": "69451086",
    "status": "PickedUp",
    "pickupDate": "2026-10-08T16:23:00",
    "deliveryDate": null,
    "deliveryByDate": null,
    "deliveryAppointmentStart": null
  },
  "trackingEvent": {
    "id": "69451086",
    "typeName": "Shipment enroute",
    "notes": "Arrived at terminal",
    "createdDate": "2026-10-13T10:00:00",
    "modifiedDate": "2026-10-13T10:05:00"
  }
}
```

Browser mode stores the same `load` and `trackingEvent` projection from JSON
responses naturally observed during navigation. The provider API is authoritative;
DOM and feature-selected location-history text cannot override it. This supersedes
the initial DOM-only example whose dates omitted the year. Failed/not-found
outcomes store null. HTML, addresses, prices, account data, credentials,
cookie/session values and full responses are excluded. Local exploration captures
remain Git-ignored, not production source-data storage.

## Full raw artifacts

The user-authorized V1-013 local UPS capture is documented in
[`ups-raw-response-capture.md`](ups-raw-response-capture.md). Its complete JSON is
kept in the Git-ignored root `tmp/` directory. This manual diagnostic capture does not enable
application-level artifact retention or change the source-data allowlist.

Exact responses should not be stored in `shipment_tracking_snapshots` or duplicated across Shipment attempts. If a future audit or debugging requirement justifies retaining them, use a separate artifact design:

- UPS response: one artifact for the relevant request or attempt.
- FFE: no export is fetched by V1-015; any future raw capture needs separate approval.
- EchoShip: capture only the allowlisted API projection; store DOM, HTML or screenshots only for an explicitly approved diagnostic workflow.
- Store artifact metadata in PostgreSQL and large content in approved object storage rather than PostgreSQL. No object-storage provider, SDK, or production dependency is selected yet.

## Security and privacy requirements

- Never store passwords, OAuth tokens, cookies, authorization headers, session identifiers, or secrets.
- Minimize names, addresses, phone numbers, signatures, and other personal information.
- Apply access control separately from ordinary Shipment reads.
- Define deletion behavior for soft-deleted and permanently purged Shipments.
- Bound artifact size before persistence and reject unexpected content types.
- Treat logs as another disclosure path; do not log full payloads merely because source data is retained.

## Retention proposal

- Keep normalized snapshots according to the product's history requirement.
- Give source data a short configurable retention period, initially proposed as 30–90 days.
- Give full artifacts a shorter retention period unless an audit requirement says otherwise.
- Remove expired source data without deleting the associated tracking attempt or normalized snapshot.

No retention duration is approved yet.

## Open decisions

1. Is byte-for-byte evidence required in addition to the approved sanitized source data?
2. What retention period and deletion guarantees are required?
3. Who may read source data and raw artifacts?
4. Are source/adapter version columns required, and is object storage approved for full artifacts?
