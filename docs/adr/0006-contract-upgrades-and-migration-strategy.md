# ADR-0006: Contract Upgrades and Migration Strategy

**Date:** 2026-11-22
**Status:** Accepted

## Context

The repository root contained a 51 KB Rust migration-strategy prototype named
`MigrationStrategy`, without a `.rs` extension and outside the `contracts`
workspace. It was not compiled or tested by Cargo or CI, despite describing a
versioned, multi-step storage migration system and extensive unit tests. Keeping
it beside the production contract could imply that this migration framework
exists and is safe to deploy.

The actual upgrade APIs are in `contracts/src/lib.rs`. They are not equivalent
to the prototype and do not implement its migration state machine.

## Decision

Do not integrate the prototype into the contract. Treat it as an unaccepted
design sketch, remove the source file, and use this ADR to record the decision
and the behavior of the existing upgrade APIs.

The contract currently exposes two distinct upgrade paths:

- `schedule_upgrade` stores a Wasm hash and execution ledger in
  `DataKey::PendingUpgrade`. `execute_upgrade` checks the ledger, increments
  `DataKey::ImplementationVersion`, removes the pending entry, and emits an
  event. It does **not** call Soroban's Wasm update API; its source comment
  explicitly describes that call as future proxy behavior.
- `upgrade` requires admin authorization and calls
  `env.deployer().update_current_contract_wasm` immediately. It does not use
  the scheduled-upgrade timelock, and it does not increment
  `ImplementationVersion`.

Neither path runs storage migrations, validates compatibility between old and
new storage layouts, or offers the prototype's sequential migration steps.
The prototype must not be copied into production or described as tested
functionality. Any future migration framework requires a separate proposal,
contract-level implementation, and tests running in the `contracts` workspace
and CI. Aligning or removing the existing upgrade entry points is also a
separate contract change; this ADR does not silently change their behavior.

## Consequences

### Positive

- There is no uncompiled Rust code that readers could mistake for an available
  migration mechanism.
- The distinction between scheduled metadata/version updates and the actual
  immediate Wasm update is explicit for operators and future contributors.
- A future migration proposal starts from the deployed contract's real behavior
  and must provide contract tests and CI coverage.

### Negative

- No general storage-migration framework is provided. State changes requiring
  migration must be handled by a separately reviewed and tested contract
  change.
- The existing scheduled and immediate upgrade APIs remain distinct, including
  their current limitations; resolving those limitations requires a separate
  decision and implementation.

## Alternatives Considered

### Integrate the prototype as a contract module

Rejected: the uncompiled prototype would require a security and compatibility
review, an explicit mapping to the contract's existing storage and upgrade
semantics, and tests against deployed state. Promoting it without that work
would create the very impression of tested migration support this decision is
intended to prevent.

### Retain the prototype as a standalone Rust file

Rejected: a source file outside the Cargo workspace is neither an executable
implementation nor a reliable design record.

## References

- `contracts/src/lib.rs`: `schedule_upgrade`, `execute_upgrade`,
  `cancel_upgrade`, `set_upgrade_timelock`, `get_implementation_version`, and
  `upgrade`.
- Issue #1077: clarify and remove the uncompiled migration prototype.
