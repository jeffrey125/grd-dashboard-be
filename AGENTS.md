# Library-first implementation

Before implementing or refactoring functionality in any domain, inspect installed
dependencies and evaluate established, maintained npm packages. Present the
recommended package, its fit and material tradeoffs, and ask the user to approve
the choice before writing implementation code. Reuse a suitable installed package
when available. Existing approval for the same choice and scope remains valid.

Use the approved package for reusable functionality rather than writing a custom
replacement. If a platform built-in is more appropriate, or no suitable package
exists, explain the reason and obtain explicit approval for that alternative.
Custom business rules and provider mappings also require an agreed scope; keep
their reusable validation, arithmetic, protocols and scheduling library-backed.
This policy applies across all domains, not only money and unit calculations.

Obtain explicit approval before adding any production dependency, then use the
project's package manager and update its lockfile. Review the final diff for
remaining custom replacements and report any exceptions and their approvals.

# Database foreign keys

For every new foreign key, explicitly use `ON DELETE NO ACTION` in migrations
and the corresponding ORM mapping. Use another delete action only when the user
explicitly approves an override for that relationship.

# Read before changing behavior

Read `CONTEXT.md` for domain vocabulary and `docs/v1/README.md` for authoritative
specifications. For ticket work, read its specification and prerequisite summaries
under `docs/v1/implementation-summary/`; later approved decisions supersede
historical ticket limitations.

For HTTP/auth/frontend work, read `docs/v1/auth-api.md` and
`docs/v1/frontend-handoff.md`. For runtime/database/container work, read `README.md`
and `docs/v1/release-readiness.md`, including the deferred hosting decisions.

# Implementation boundaries

Keep API and worker composition separate: exactly one worker and one API replica
in v1. Feature services use feature-owned repository contracts; TypeORM belongs
in persistence implementations. Reuse installed dependencies; obtain approval
before adding production packages. Schema changes must update
`docs/v1/database-schema.md` and explain why the migration is needed.

Preserve grouped statements: one blank line between imports, declarations,
setup/actions/assertions, control-flow sections and methods; keep related lines
together. Separate broad whitespace cleanup from behavior changes in review.

Carrier tests use fixtures, never local provider credentials. Use disposable
PostgreSQL for migration/integration checks. Keep secrets and diagnostic captures
outside tracked files and the Docker build context. Production database TLS uses
`verify-full`; never resolve a certificate failure by disabling verification.

# Commit subjects

Include the applicable ticket ID after the Conventional Commit prefix, for example:
`test(shipping-quotes): SQ-V1-001 add authenticated provider contract harness`.
Use that ticket ID for every related commit, and the new ticket ID when starting
another ticket. Apply this format to proposed messages and actual commits.

# Completion evidence

Run the applicable commands from `README.md`; release/container changes also need
the combined coverage and opt-in container checks. Report exact results, skipped
checks and unresolved rollout blockers. A unit-only coverage report is not a
whole-backend coverage report. Keep frontend handoffs aligned with actual response
schemas, especially fields/endpoints still missing.

Use the seven-heading implementation handoff required by the ticket skill.
Separate unrelated worktree changes and propose single-purpose commits; obtain
explicit final approval before staging/committing. Deployment and CI/CD changes
remain a separate task, not an implied release-verification step.
