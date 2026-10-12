# V1-005: Implement the initial PostgreSQL schema

## Status

Depends on V1-004.

## Objective

Implement the five authoritative tables, enums, constraints, indexes, ownership-safe foreign keys, and initial Carrier seeds through reviewed TypeORM migrations.

## Required reading

- [`../database-schema.md`](../database-schema.md) in full
- [`../tracking-source-data-policy.md`](../tracking-source-data-policy.md), approved initial field only

## Scope

- Implement Carrier, Shipment, tracking snapshot, tracking run, and tracking attempt entities.
- Write migrations in the exact dependency order from the schema document.
- Seed UPS, EchoShip, and FFE with approved interval, threshold, and rate-limit values.
- Add database checks, partial uniqueness, due-work indexes, and composite ownership-safe foreign keys.
- Keep source/adapter version columns, raw artifacts, User foreign keys, notifications/outbox, and queue tables out of this migration.

## Acceptance criteria

- Every documented column, enum, default, check, unique constraint, foreign key action, and index exists and no deferred column is present.
- UPS seed: 30-minute poll, not-found threshold 5, rate limit 10.
- EchoShip and FFE seeds: 5-minute poll, threshold 5, null generic rate limit.
- An empty database migrates up successfully; a full revert and second migrate also succeed.
- Run application schema migration coverage through `pnpm test:integration` in the CI integration job established by V1-002 and extended by V1-004.
- Integration tests prove active duplicate protection, soft-delete/re-add behavior, ownership-safe snapshot links, invalid enum/check rejection, and UUID generation.
- TypeORM entity metadata and migrated PostgreSQL schema agree.

## Verification

Run migration integration tests against fresh PostgreSQL, inspect generated schema/indexes, then run typecheck and build.
