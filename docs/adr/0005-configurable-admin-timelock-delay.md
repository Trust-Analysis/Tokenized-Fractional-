# ADR-0005: Configurable Admin Timelock Delay

**Date:** 2026-11-21
**Status:** Accepted
**Author:** Team

## Context

Issue #1097 requires marketplace instances to be able to choose how long privileged
admin operations are delayed before they can be executed. The original
`schedule_operation` implementation hard-coded a 172,800-second (48-hour) delay,
which made the security/operations trade-off impossible to tune for different
deployments. A configurable value introduces two governance risks: an admin could
set an effectively instant delay and bypass the protection, or could set an
extreme delay that makes emergency administration impossible. The value must
therefore be bounded, and changing it must not be a single-step privileged write.

## Decision

The delay is stored in instance storage under `DataKey::TimelockDelay` and is
supplied as the final `timelock_delay` argument to `init`. Valid values are
inclusive between 86,400 seconds (24 hours) and 2,592,000 seconds (30 days).
The legacy default remains 172,800 seconds (48 hours). Invalid values panic with
`TimelockError::InvalidDelay = 4` at `init`, when scheduling a
`SetTimelockDelay` action, and when executing that action.

The delay can only be changed through the existing timelock flow: schedule
`AdminAction::SetTimelockDelay(new_delay)`, wait for the currently configured
delay, then execute. There is no direct setter. `execute_operation` reads the
real `DataKey::Admin` from instance storage and requires that address's
authorization for this action instead of trusting the caller-supplied `admin`
argument. `schedule_operation` uses `saturating_add` when computing
`execute_after`. `get_timelock_delay` exposes the effective value.

## Consequences

### Positive

- Operators can select a 24-hour to 30-day delay appropriate to their asset,
  jurisdiction, and incident-response process.
- The lower bound prevents an instant-admin-action configuration; the upper
  bound prevents an accidental or malicious indefinite lock.
- Changing the delay is itself delayed, so an admin cannot immediately weaken
  the guard protecting other admin operations.
- The 48-hour default preserves the behavior of the previous hard-coded delay.

### Negative

- Deployments must supply one more `init` argument and validate it in their
  deployment scripts.
- Operators wanting a delay shorter than 24 hours or longer than 30 days need a
  contract change rather than a configuration change.
- A delay increase takes effect only after the old delay elapses, which is
  intentional but slower than an immediate policy update.

## Alternatives

### Keep the delay hard-coded

Rejected: it leaves every deployment with the same security and operational
posture and does not satisfy issue #1097.

### Allow any non-zero delay with a direct setter

Rejected: zero or very small values would defeat the timelock, and a direct
setter would allow a single authorized transaction to remove the protection.

### Store the delay in a separate config contract

Rejected: it adds an external dependency and another contract to deploy,
upgrade, and trust for a single `u64` value.

## Notes

Existing instances deployed before this change have no `TimelockDelay` entry.
The read helper falls back to 172,800 seconds in that case, preserving legacy
scheduling behavior without requiring a migration. `AdminAction::SetTimelockDelay`
was appended last so existing `AdminAction` discriminants remain unchanged, and
`TimelockError::InvalidDelay = 4` was appended after the existing errors. The
existing `EventOperationScheduled`, `EventOperationCancelled`, and
`EventOperationExecuted` events are unchanged.
