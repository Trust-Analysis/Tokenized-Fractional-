# Re-entrancy Guard Implementation

## Issue #49: Add Re-entrancy Guard

This document describes the implementation of a re-entrancy guard as a defense-in-depth security measure for the RWA Marketplace smart contract.

---

## Summary

Added a re-entrancy guard flag to prevent recursive calls to the `buy_shares` function during external token operations. This follows the Checks-Effects-Interactions security pattern commonly used in smart contract development.

---

## Changes Made

### 1. DataKey Enum Extension

**File**: `contracts/src/lib.rs`

Added `ReentrancyGuard` variant to the `DataKey` enum:

```rust
pub enum DataKey {
    // ... existing variants ...
    /// Reentrancy guard flag for defense-in-depth protection
    ReentrancyGuard,
}
```

This storage key holds a boolean flag indicating whether the contract is currently executing a protected function.

---

### 2. Helper Functions

Added two private helper functions:

```rust
/// Re-entrancy guard helper: check and set the guard flag to prevent re-entrant calls.
/// This is a defense-in-depth measure to protect functions that make external calls.
/// The flag is stored in instance storage and cleared after the operation completes.
fn _check_non_reentrant(env: &Env) {
    if env
        .storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::ReentrancyGuard)
        .unwrap_or(false)
    {
        panic!("Re-entrancy detected: contract is already executing");
    }
    _set_non_reentrant(env, true);
}

/// Set the re-entrancy guard flag. Pass `true` to lock, `false` to unlock.
fn _set_non_reentrant(env: &Env, value: bool) {
    env.storage().instance().set(&DataKey::ReentrancyGuard, &value);
}
```

These functions implement the lock/unlock pattern:
- `_check_non_reentrant()` verifies the guard is not set (returns early if already locked) and locks it
- `_set_non_reentrant()` sets the guard to any boolean value (used to unlock after completion)

---

### 3. buy_shares Function Protection

**File**: `contracts/src/lib.rs`

The `buy_shares` function was modified to:

1. Check and set the re-entrancy guard at the start of the function
2. Clear the guard on all exit paths (including early panics)

```rust
pub fn buy_shares(env: Env, buyer: Address, shares: u32, payment_token: Address) {
    buyer.require_auth();

    // Re-entrancy guard: prevent recursive calls during external token operations
    _check_non_reentrant(&env);

    // ... validation logic ...

    // Clear reentrancy guard before publishing event
    _set_non_reentrant(&env, false);

    EventBuyShares { buyer, shares, total_cost }.publish(&env);
}
```

All early-return panic paths also clear the guard before panicking to ensure the contract remains in a consistent state.

---

### 4. Unit Tests

**File**: `contracts/src/lib.rs`

Added five unit tests to verify the re-entrancy guard functionality:

| Test Name | Description |
|-----------|-------------|
| `test_reentrancy_is_blocked` | Simulates an ongoing call by manually setting the guard, verifies the call is rejected with "Re-entrancy detected" error |
| `test_reentrancy_guard_cleared_after_successful_buy` | Verifies the guard is set during execution and cleared after successful completion |
| `test_reentrancy_blocked_on_panic_path` | Tests that re-entrancy is blocked even when other validation errors would occur |
| `test_reentrancy_guard_default_false` | Verifies the guard defaults to false after initialization |
| `test_double_reentrancy_blocked` | Additional test confirming subsequent calls are blocked when guard is set |

---

## Security Rationale

While Soroban's architecture provides strong isolation between contract calls, this re-entrancy guard adds defense-in-depth protection against:

1. **Cross-contract re-entry attacks**: Malicious contracts could theoretically attempt to re-enter during external token transfer callbacks
2. **State consistency**: Ensures atomic execution of the `buy_shares` function
3. **Best practices**: Follows established smart contract security patterns (similar to OpenZeppelin's ReentrancyGuard)

The guard is particularly important because `buy_shares` performs external calls via:
- `token::TokenClient::transfer()` for payment processing
- `NftContractClient::mint_certificate()` if NFT contract is configured

---

## Testing

To run the tests:

```bash
cd contracts
cargo test --lib test_reentrancy
```

All tests pass, confirming:
- Re-entrancy is properly detected and blocked
- Guard is properly cleared after successful execution
- Normal operation is not affected

---

## Closes #49

This implementation satisfies all requirements from issue #49:
- [x] Add REENTRANCY_GUARD data key
- [x] Implement _check_non_reentrant() and _set_non_reentrant() helpers
- [x] Guard buy_shares with re-entrancy protection
- [x] Write unit tests confirming re-entrancy is blocked
- [x] Clear documentation and inline comments