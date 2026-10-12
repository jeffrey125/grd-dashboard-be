# Tracking source-data policy

## Status

Partially approved. Nullable `tracking_attempts.source_data jsonb` is part of the initial PostgreSQL schema. Its detailed population and retention policy, additional version columns, and exact raw-artifact storage remain deferred and must not be implemented without explicit approval.

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

Store only the matching shipment record, converted to JSON. Do not duplicate the complete account export for every Shipment.

```json
{
  "OrderNumber": "9685575",
  "ShipmentStatus": "Delivered",
  "ApptPickupDate": "09/02/2026",
  "ApptDeliveryDate": "09/10/2026",
  "DeliveryDate": "09/11/2026"
}
```

### EchoShip allowlist example

Store extracted source text rather than the complete authenticated HTML page.

```json
{
  "statusText": "In Transit",
  "ediStatusText": "Arrived at terminal",
  "pickedUpText": "Picked Up Sep 8",
  "deliveryHeading": "Estimated Delivery",
  "deliveryText": "Estimated Delivery Sep 12"
}
```

## Full raw artifacts

Exact responses should not be stored in `shipment_tracking_snapshots` or duplicated across Shipment attempts. If a future audit or debugging requirement justifies retaining them, use a separate artifact design:

- UPS response: one artifact for the relevant request or attempt.
- FFE export: one artifact for the Carrier tracking run, because the file contains many shipments.
- EchoShip: capture an allowlisted DOM extract by default; store HTML or screenshots only for an explicitly approved diagnostic workflow.
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
2. Should source data be populated for every attempt, only changed results, or failures only?
3. What retention period and deletion guarantees are required?
4. Who may read source data and raw artifacts?
5. Are source/adapter version columns required, and is object storage approved for full artifacts?
