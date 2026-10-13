# V1 target folder structure

Create files when their ticket implements the corresponding behavior; do not generate empty feature folders merely to match this tree.

```text
grd-dashboard-be/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .husky/
│   └── pre-commit
├── docs/
│   └── v1/
│       ├── README.md
│       ├── architecture.md
│       ├── auth-plan.md
│       ├── cache-design.md
│       ├── database-schema.md
│       ├── decisions.md
│       ├── folder-structure.md
│       ├── tracking-behavior.md
│       ├── tracking-source-data-policy.md
│       └── tickets/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── worker.ts
│   ├── worker.module.ts
│   ├── constants.ts
│   ├── config/
│   │   ├── config.module.ts
│   │   ├── configuration.ts
│   │   └── env.schema.ts
│   ├── infrastructure/
│   │   ├── cache/
│   │   │   ├── abstract-cache.service.ts
│   │   │   ├── abstract-cache.service.spec.ts
│   │   │   ├── application-cache.module.ts
│   │   │   ├── application-cache.module.spec.ts
│   │   │   └── cache.config.ts
│   │   ├── database/
│   │   │   ├── database.module.ts
│   │   │   ├── data-source.ts
│   │   │   ├── entities/
│   │   │   │   ├── auditable.entity.ts
│   │   │   │   └── externally-identified.entity.ts
│   │   │   └── migrations/
│   │   └── logging/
│   │       ├── index.ts
│   │       ├── logging.module.ts
│   │       ├── pino-logger.service.ts
│   │       ├── pino-logger.service.spec.ts
│   │       ├── request-logging.interceptor.ts
│   │       └── safe-error-fields.ts
│   └── modules/
│       ├── health/
│       │   ├── health.module.ts
│       │   ├── health.controller.ts
│       │   └── health.controller.spec.ts
│       ├── auth/
│       │   └── # Final shape follows Ticket V1-009
│       ├── carriers/
│       │   ├── carriers.module.ts
│       │   ├── carriers.controller.ts
│       │   ├── carriers.service.ts
│       │   ├── carrier.entity.ts
│       │   ├── carriers.schemas.ts
│       │   ├── carriers.repository.ts
│       │   ├── typeorm-carriers.repository.ts
│       │   ├── cache/
│       │   │   └── carrier-cache.service.ts
│       │   └── adapters/
│       │       ├── carrier-adapter.ts
│       │       ├── carrier-adapter.registry.ts
│       │       ├── carrier-adapters.module.ts
│       │       ├── carrier-result.ts
│       │       ├── ups/
│       │       │   ├── ups.module.ts
│       │       │   ├── ups.adapter.ts
│       │       │   ├── ups.client.ts
│       │       │   ├── ups-token.provider.ts
│       │       │   ├── ups.schemas.ts
│       │       │   └── ups.mapper.ts
│       │       ├── echoship/
│       │       │   ├── echoship.module.ts
│       │       │   ├── echoship.adapter.ts
│       │       │   ├── echoship.browser.ts
│       │       │   ├── echoship.schemas.ts
│       │       │   └── echoship.mapper.ts
│       │       └── ffe/
│       │           ├── ffe.module.ts
│       │           ├── ffe.adapter.ts
│       │           ├── ffe.browser.ts
│       │           ├── ffe.browser-network.ts
│       │           ├── ffe.request.ts
│       │           ├── ffe.config.ts
│       │           ├── ffe.failure.ts
│       │           ├── ffe.protocol.ts
│       │           └── ffe.mapping.ts
│       ├── shipments/
│       │   ├── shipments.module.ts
│       │   ├── shipments.controller.ts
│       │   ├── shipments.service.ts
│       │   ├── shipment.entity.ts
│       │   ├── shipments.schemas.ts
│       │   ├── shipments.repository.ts
│       │   ├── typeorm-shipments.repository.ts
│       │   └── cache/
│       │       └── shipment-cache.service.ts
│       ├── tracking/
│       │   ├── tracking.module.ts
│       │   ├── tracking-http.module.ts
│       │   ├── tracking-worker.module.ts
│       │   ├── tracking.controller.ts
│       │   ├── tracking.service.ts
│       │   ├── tracking-scheduler.service.ts
│       │   ├── tracking-executor.service.ts
│       │   ├── tracking-run.entity.ts
│       │   ├── tracking-attempt.entity.ts
│       │   ├── shipment-tracking-snapshot.entity.ts
│       │   ├── tracking.repository.ts
│       │   ├── typeorm-tracking.repository.ts
│       │   ├── tracking.schemas.ts
│       │   └── cache/
│       │       └── tracking-cache.service.ts
│       ├── notifications/
│       │   ├── notifications.module.ts
│       │   ├── notification.publisher.ts
│       │   └── ntfy-notification.publisher.ts
│       └── events/
│           ├── events.module.ts
│           ├── events.controller.ts
│           └── events.service.ts
├── test/
│   ├── e2e/
│   ├── integration/
│   ├── fixtures/
│   └── support/
│       ├── create-test-app.ts
│       └── postgresql-container.ts
├── .env.example
├── .gitignore
├── .prettierignore
├── lint-staged.config.mjs
├── nest-cli.json
├── prettier.config.mjs
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── vitest.config.e2e.ts
├── vitest.config.integration.ts
├── package.json
└── pnpm-lock.yaml
```

## Placement rules

- Group HTTP, application behavior, entities, repository contracts/implementations, cache behavior, and tests by feature.
- Keep shared TypeORM base entities in `infrastructure/database/entities`; ordinary business entities remain in their owning feature.
- Use area-specific TypeScript aliases for imports crossing directories:
  `@app/*` for files directly under `src/`, `@config/*`, `@infrastructure/*`,
  `@modules/*`, `@runtime/*`, and `@test/*`. Keep relative imports for files in
  the same directory.
- Keep generic cache registration/base behavior in `infrastructure/cache`; feature keys and invalidation remain in the feature.
- Keep application-wide compile-time constants in `src/constants.ts`. Do not put environment values, secrets, mutable state, or database-owned configuration there.
- Keep protocol details used only by one feature next to that feature. Promote them to `src/constants.ts` only when they become a real cross-module contract; this prevents the root file from becoming an unrelated-value registry.
- Keep the Pino wrapper, safe error projection, redaction, and HTTP request logging in `infrastructure/logging`; feature modules log through its project-owned interface rather than importing Pino directly.
- Keep Carrier protocol code below `carriers/adapters`; only the worker composition root imports `CarrierAdaptersModule`.
- Keep the scheduler below tracking and import it only through `TrackingWorkerModule`.
- Avoid a generic `common/`, `utils/`, or `helpers/` dumping ground. Promote shared code only after two real consumers establish the seam.

No `deploy/` folder is part of v1.
