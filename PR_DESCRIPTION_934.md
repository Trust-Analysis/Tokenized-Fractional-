# PR Description — Tokenized-Fractional #934

## Summary

Fixes a Checks-Effects-Interactions (CEI) violation and missing reentrancy
guard in `buy_asset_shares` in `contracts/multi_asset/src/lib.rs`.

## Motivation

`buy_asset_shares` called the external `client.transfer(...)` *before*
updating `available_supply`, the buyer's `AssetBalance`, the `AssetHolders`
registry, and `AssetAnalytics`. This is the exact CEI violation that
`contracts/src/lib.rs`'s `buy_shares` already fixed for the main contract
(issue #633), but the fix was never applied to this sibling contract. There
was also no reentrancy guard anywhere in this function.

## Impact

If the configured `payment_token` can invoke any callback during `transfer`
(or a future token integration does), `buy_asset_shares` is vulnerable to
the reentrancy/double-spend class of bug already identified and remediated
once in this codebase — just in the wrong contract.

## Changes

### `contracts/multi_asset/src/lib.rs`

1. **Added `Error::ReentrantCall` variant** — new error code (19) for
   reentrancy guard violations.

2. **Added `DataKey::ReentrantGuard`** — instance storage key used to track
   whether `buy_asset_shares` is currently executing.

3. **Reordered `buy_asset_shares` to CEI order** — all contract state updates
   now happen *before* the external token transfer:
   - `available_supply` decremented
   - Buyer `AssetBalance` incremented
   - `AssetHolders` registry updated (new holder registered if applicable)
   - `AssetAnalytics` updated (total_holders, total_volume, avg_price,
     last_trade_at, buy_count)
   - Only then: `client.transfer(&buyer, &info.treasury, &total_cost)`

4. **Added reentrancy guard** — guard is set to `true` before state changes,
   checked at function entry (panics with `ReentrantCall` if already set),
   and released to `false` after the transfer completes.

## Verification

- Code compiles with `cargo build`
- Mirrors the CEI pattern already proven in `contracts/src/lib.rs`'s
  `buy_shares` (issue #633)
- The reentrancy guard follows the same instance-storage pattern used
  elsewhere in the codebase

## Related

- Issue #934 (Wave): CEI violation with no reentrancy guard in
  `multi_asset` contract's `buy_asset_shares`

Closes #934
