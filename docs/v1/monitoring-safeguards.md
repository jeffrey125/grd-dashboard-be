# MON-V1-001: monitoring safeguards and request-session reuse

Approved on 2026-10-26 after the EchoShip monitoring incident. These decisions
supersede the fresh-login-per-run and unlimited technical-retry rules in V1-014,
V1-015 and the original tracking behavior. Scope is shipment monitoring for UPS,
EchoShip and FFE, including scheduled and manual runs. Shipping quotes are separate.

## Carrier settings

| Public field                     | Default | Meaning                                                                      |
| -------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `failurePauseEnabled`            | `true`  | Enable **Auto-Failure Pause Monitoring** for individual Shipments.           |
| `failurePauseThreshold`          | `2`     | Consecutive technical lookup failures before pause; integer 1–10.            |
| `sessionFailureDisableEnabled`   | `true`  | Enable **Auto-Disable After Session Failures** for the Carrier.              |
| `sessionFailureDisableThreshold` | `2`     | Consecutive failed run session checks/logins before disabling; integer 1–10. |
| `consecutiveSessionFailures`     | `0`     | Read-only durable Carrier session failure count.                             |
| `autoDisabledReason`             | `null`  | Read-only `session_failures` when automatically disabled.                    |
| `sessionGeneration`              | `0`     | Read-only invalidation generation; clients must not PATCH it.                |

Admin-only Carrier PATCH accepts the four safeguard settings. Each safeguard can
be independently disabled; failures remain observable but do not stop monitoring.
Re-enabling it resets its counter, preserving history and existing stopped states.
An admin re-enabling the Carrier also clears its automatic-disable reason and
session counter. It does not resume individually paused Shipments.

## Session lifecycle

EchoShip and FFE request sessions retain their provider-owned cookie jars in worker
memory across runs. Every run validates authentication using the provider's existing
authenticated read: EchoShip load summaries, or FFE tracking-page verification.
A confirmed expired/rejected session permits one fresh login followed by its
normal validation. An inconclusive response, malformed data, timeout, or network
failure does not cause a fresh login. EchoShip's explicit account-lock response
also does not trigger a re-login during cached-session validation.

A successful session check/login resets the Carrier failure counter. Failed opening
or validation counts once per run, regardless of shipment count or HTTP subrequests.
A recognized mid-run authentication failure ends further provider reads and counts
once against the Carrier. The affected attempts remain failed but do not increment
individual Shipment failure counters. An abort/shutdown is not an authentication
failure. UPS keeps its existing cached OAuth token/expiry/refresh policy; token
acquisition failures are Carrier-scoped rather than individual lookup failures.

Cookies are never persisted. Disablement, mode/configuration generation changes,
or shutdown discard the cached EchoShip/FFE request session. The scheduler drops
disabled sessions on its next scan; automatic disablement also clears them immediately.
Browser sessions remain isolated per run and use the same durable safeguards.
One worker still executes Carrier runs serially. Existing request pacing applies
to validation, login, and lookups. There is no new batching delay: due Shipments
remain grouped by the existing minute scan.

## Shipment lifecycle

Each finalized individual technical failure increments `consecutiveFailureCount`.
When its enabled Carrier threshold is reached, an active Shipment becomes
`paused / failure_threshold` and `nextCheckAt` is cleared. Further failures of an
already paused Shipment leave it paused. Existing tracking snapshots are preserved.
A found or confirmed not-found result resets the technical-failure count. Confirmed
absence still uses the existing, independent not-found count/threshold.

Manual **Retry now** accepts a failure-threshold pause when the Carrier is enabled.
It performs one logical check. Found resumes monitoring and resets counters;
delivered completes monitoring; failed/not-found leaves monitoring paused.
Manual pauses keep their existing explicit Resume workflow. Disabled Carriers reject
manual refresh; already queued work becomes ineligible without provider requests.

## Persistence and races

The migration adds Carrier policy/counters/reason/generation, a Shipment failure
counter and pause reason, and per-run session accounting. Existing counters start
at zero; historic failures are not backfilled into immediate pauses. Existing
Carrier enabled/disabled states remain unchanged. No new foreign keys are needed.

Attempt outcome and Shipment failure transition commit atomically under the existing
run/attempt/Shipment locks and optimistic version checks. Carrier session outcomes
are recorded under run and Carrier locks, once per failed run. The run captures the
Carrier session generation at execution start; late outcomes from before an admin
reset cannot affect the new generation. Re-enabling Shipment protection resets its
counters and advances Shipment versions so stale in-flight outcomes cannot undo it.
Disabling a Carrier prevents new work; an already executing operation may finish.

The enum is recreated transactionally so the new pause reason is usable within the
migration. Rollback preserves failure-paused Shipments as manually paused rather
than silently resuming them. Counters/reasons survive worker restart; cookies do not.

## UI and verification

Carrier settings show independent switches/thresholds, session count and automatic
disable reason. Shipment screens show the technical-failure pause and counter with
Retry now. Existing run events invalidate Carrier queries so automatic disablement
and cached action eligibility reconcile without a browser reload.

Verification uses existing Vitest, Playwright, and disposable PostgreSQL fixtures:
reused/rotated cookies, expiry and one re-login, inconclusive validation without
credential submission, disable/reset invalidation, per-run versus per-Shipment
accounting, independent toggles/thresholds, recovery/not-found/delivery behavior,
restart persistence, stale-generation rejection, migration up/down/drift, API role
and input boundaries, and desktop/mobile admin workflows. Live Carrier credentials
are never used by these tests. Deployment and unlocking EchoShip are separate actions.
