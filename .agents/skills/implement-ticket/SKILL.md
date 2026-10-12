---
name: implement-ticket
description: Implement one GRD backend ticket from docs/v1/tickets through context gathering, interactive grilling, verification, and a Markdown implementation summary. Use for ticket implementation or resuming an unfinished ticket, not standalone reviews or documentation questions.
---

# Implement one GRD ticket

Input: a ticket path or an unambiguous ticket ID, such as `V1-003`.
Resolve paths from the repository root. Keep one ticket with one lead agent in the
current interactive session; this skill does not create sessions or select the
next ticket automatically. Any review delegation must respect session permissions.

Example invocation:

```text
$implement-ticket docs/v1/tickets/V1-003-runtime-config-and-health.md
```

## 1. Establish context

Read applicable repository instructions, `docs/v1/README.md`, the selected ticket,
and all of its required reading. Use `docs/v1/tickets/README.md` to resolve its
dependency order. Inspect the relevant source, package manifest, lockfile, test
commands, working tree, and diff.

Read the prerequisite tickets' summaries under `docs/v1/implementation-summary/`
and any other summary that covers code the ticket will change. Check recorded
limitations against the actual implementation. If a prerequisite is incomplete,
report the concrete gap before implementing the dependent ticket.

If this ticket already has a summary or partial implementation, reconcile those
with the current code and decisions already approved in the conversation. Resume
from the first unfinished step; preserve unrelated changes and settled decisions.

Completion: identify the ticket's acceptance criteria, relevant prior decisions,
existing changes, and unresolved design choices.

## 2. Grill unresolved decisions

Use the available `grilling` skill, reading its instructions before the interview.
If it is unavailable, use this self-contained interview contract: map decisions
and their dependencies, investigate discoverable facts yourself, and ask exactly
one unresolved question per turn. Include a recommended answer and its material
tradeoff, then wait for the user's answer. Record settled decisions in the
conversation and select the next question whose prerequisites are settled.

Focus on ambiguities that affect behavior, interfaces, scope, failure handling,
or acceptance tests. Existing ticket requirements and previously approved answers
are inputs to the interview, not questions to repeat. If the requirements are
already complete, proceed to the approach confirmation.

## 3. Confirm the implementation approach

Review the agreed requirements and acceptance criteria. Evaluate existing
libraries and built-ins first, then established maintained packages for any gaps.
Verify new package compatibility from primary sources. Recommend the approach,
explain its fit and material tradeoffs, and present the final plan for confirmation
before writing implementation code. Include dependency choices in this single
confirmation when possible.

An existing approval for the same approach remains valid. Feature agreement alone
does not approve a dependency or a custom implementation. Obtain explicit approval
before adding a new production dependency; use the repository's package manager
and lockfile after approval.

Completion: no unresolved material requirement remains and the implementation
approach has been approved.

## 4. Implement and verify

Use the `implement` skill after the approach is approved. Read
`/home/jeff/.agents/skills/implement/SKILL.md` before implementation, or resolve its
current location from the available skills if that path changes. Follow its TDD,
verification, and code-review workflow within the agreed ticket scope and session
permissions. Its instruction to commit is subject to the explicit final commit
approval in step 5; finish verification and the summary before requesting it.
If the skill cannot be found, report the missing dependency instead of claiming
to have used it.

Implement only the selected ticket and its agreed scope. Use the existing test
infrastructure to cover meaningful behavior and failure cases. Run the ticket's
verification commands and relevant repository checks, deriving the exact commands
from current project configuration.

Review the final diff against every acceptance criterion and the initial working
tree. Resolve regressions introduced by the change. Record exact commands and
results, including checks that could not run and why. Treat a blocked or failing
required check as an explicit limitation rather than a passing result.

## 5. Write the implementation summary and handoff

Create or update:

```text
docs/v1/implementation-summary/<TICKET-ID>-implementation-summary.md
```

Follow the neighboring summaries' useful conventions and include these headings:

- **Summary** — implemented outcome and completion status.
- **Changes Made** — behavior, architecture, configuration, database, or API changes;
  include settled design decisions and the selected dependency approach.
- **Files Changed** — relevant files and their review purpose.
- **Verification** — exact commands, results, and checks not run.
- **Review Notes** — assumptions, tradeoffs, edge cases, and separation from
  pre-existing changes.
- **Remaining Issues** — incomplete, deferred, blocked, or risky items; `None.`
  only when none remain.
- **Suggested Review Order** — shortest useful review sequence.

For a resumed ticket, preserve useful history while making the current status
clear. A blocked implementation may have a summary, but must be labeled incomplete.
Check the summary's formatting and the final diff after writing it.

End with a concise handoff using those same headings and link the summary.
Propose the smallest coherent Conventional Commits, listing each commit's files
and behavioral purpose. Obtain explicit final approval before staging and
committing. Publishing, merging, and tagging require their applicable authorization;
creating the summary does not perform any of those actions.

Completion: each acceptance criterion has supporting evidence or an explicit
remaining issue, the summary reflects the actual diff and verification, and the
user has a reviewable handoff.
