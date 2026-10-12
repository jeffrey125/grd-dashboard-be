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
The empty production migration list in V1-004 is intentional; production tables
arrive in V1-005.

## Entity and repository contract

`AuditableEntity` defines the internal integer identity, timestamps, soft-delete
column and nullable integer actor IDs. `ExternallyIdentifiedEntity` adds a unique,
database-generated UUID. Neither inherits TypeORM `BaseEntity`. The public UUID
mapping forbids application insert/update values; PostgreSQL constraints and
reviewed triggers enforce identity rules for all writers. No User relations exist.

V1-004's proof lives only in `test/support/database-proof/`. Its service injects a
symbol-token repository contract and returns a record without internal IDs.
The migrated fixture proves audit behavior and rejects changes to either ID,
including `SET id = DEFAULT`. `pnpm test:integration` compiles the fixture into
ignored `.test-dist/` and verifies the actual CLI against disposable PostgreSQL.
V1-005 must replace this fixture with real entity/repository tests and remove it.
