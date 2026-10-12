# Database foundation

Both runtimes import `DatabaseModule`, which registers one TypeORM DataSource per
Nest application context. Feature modules reuse that source through repositories;
they must not register another `forRoot` connection. API and worker processes have
separate pools. The CLI imports `data-source.ts` without starting Nest or HTTP.

## Configuration and lifecycle

The existing validated `DB_*` configuration supplies connection settings. The
runtime and CLI both load `.env` from the working directory, preserve literal
passwords, and prefer process environment values. `NODE_ENV=test` skips `.env`.
The CLI uses Node's built-in environment-file parser and TypeORM's own console
logger independently of the application's `LOG_LEVEL` setting.

Connections are plaintext: verified TLS is explicitly deferred in
`docs/v1/TODO.md`. Each pool permits ten connections. Acquisition/connect timeout
is five seconds; SQL statement timeout is five seconds and client query timeout
is six seconds. These limits also apply to migrations; review them before future
long-running data migrations.

Each runtime makes at most three initialization attempts with one second between
attempts. Five seconds bounds each connection attempt, not the entire startup
sequence (TypeORM also runs initialization queries). Failure exits with code 1.
Startup never synchronizes, runs migrations, drops schema, or installs extensions.

Readiness executes `SELECT 1`; Terminus bounds the response to one second and
returns status only. Underlying acquisition/query work has the driver limits
above. Overlapping probes share one pending query to avoid accumulating work
after a response timeout. A later database outage leaves HTTP liveness available
and readiness recovers when connectivity returns. Closing Nest closes the pool.

## Reviewed migrations

Run commands from the package root:

```sh
pnpm migration:create src/infrastructure/database/migrations/DescribeChange
pnpm migration:generate src/infrastructure/database/migrations/DescribeChange
pnpm migration:show
pnpm migration:run
pnpm migration:revert
pnpm schema:log
pnpm query 'SELECT now()'
pnpm typeorm --help
```

Commands that load the DataSource compile the project first and use compiled ESM
entities from `dist/modules/**/*.entity.js` and migrations from
`dist/infrastructure/database/migrations/*.js`. File generators and the general CLI entry do not
build automatically.
Review generated TypeScript and SQL before running it. Generation compares the
configured database with compiled entity metadata. Write trigger/check/index SQL
explicitly where the generator cannot express the intended behavior. Revert runs
the latest migration's `down`; review data-loss implications before using it.
Migration transaction mode defaults to `all`.

The package scripts call TypeORM's CLI directly. Its complete stdout and stderr
are preserved, including generated SQL, failed queries, parameters, driver errors,
connection metadata, and anything included in those errors. Do not paste command
output into tickets or shared logs without reviewing it for secrets and personal
data. Runtime application query logging remains disabled; this full-output policy
applies to operator-invoked CLI commands.

`pnpm typeorm <command>` exposes the complete installed CLI. Named shortcuts cover
the project-useful commands: entity/subscriber creation, migration
create/generate/show/run/revert, schema logging, and arbitrary SQL queries.
`schema:sync`, `schema:drop`, and `init` remain available through the general
command but have no named shortcut because they bypass reviewed migrations or can
destroy/replace project state. Do not use them against shared or production data.
V1-005 supplies one atomic initial migration with five tables, enum types,
constraints, indexes, identifier/snapshot protection triggers, and the three
Carrier seeds. PostgreSQL's built-in `gen_random_uuid()` is verified before DDL;
no extension installation is required.

## Entity and repository contract

`AuditableEntity` defines the internal integer identity, timestamps, soft-delete
column and nullable integer actor IDs. `ExternallyIdentifiedEntity` adds a unique,
database-generated UUID. Neither inherits TypeORM `BaseEntity`. The public UUID
mapping forbids application insert/update values; PostgreSQL constraints and
reviewed triggers enforce identity rules for all writers. No User relations exist.

The five production entities live in their owning Carrier, Shipment, and tracking
features. Bigint IDs and calendar dates map to strings to preserve precision and
date-only semantics. TypeORM maintains mutable audit timestamps and the Shipment
version on writes; direct SQL callers are responsible for those updates.

Reviewed PostgreSQL triggers reject changes to generated IDs/public UUIDs and all
snapshot fields, including identity resets through `SET id = DEFAULT`. No-op
UUID and snapshot-fact assignments are allowed; identity columns retain PostgreSQL's
`GENERATED ALWAYS` assignment restrictions. Snapshot history has no audit or soft-delete columns.
All foreign keys explicitly use `ON DELETE NO ACTION`; permanent purges require
explicit dependency cleanup as described in `docs/v1/database-schema.md`.

Mixed ASC/DESC history indexes are marked `synchronize: false` in entity metadata
because TypeORM cannot fully describe them. Reviewed migrations create them and
catalog assertions verify their exact definition. Schema-generation previews do
not reproduce those indexes or the protection triggers; review generated SQL.

`pnpm test:integration` builds production code and exercises the real CLI and
schema against disposable PostgreSQL. V1-007 replaced the temporary Carrier test
adapter with the concrete production repository and service in `src/modules/carriers`.
The service injects `TypeOrmCarriersRepository` directly by its class token; no
separate Carrier contract file, Symbol, or provider factory remains.
Coverage preserves service DI, audit writes, generated UUIDs, code uniqueness,
and soft-deleted exclusions. Fixtures provision/retire rows directly; runtime
Carrier operations are read/update only. Only reviewed migrations accompanying
implemented adapters add Carriers with explicit stable codes. No automatic slug
generation or deletion API is provided. The old proof schema and fixture build
are removed.
