# fix: Replace bare `.unwrap()` with meaningful error messages in contract

## Summary

Audited every `.unwrap()` call in `contracts/src/lib.rs` and replaced all bare unwraps on storage reads with `.expect("Contract not initialized: <key>")`. This ensures that any call made before `init()` — or after a hypothetical data corruption — produces a clear, human-readable panic message instead of a cryptic raw panic with no context.

---

## Audit Results

### Before → After

| Location | Key | Old | New |
|---|---|---|---|
| `add_to_whitelist` | `Admin` | `.unwrap()` | `.expect("Contract not initialized: admin")` |
| `remove_from_whitelist` | `Admin` | `.unwrap()` | `.expect("Contract not initialized: admin")` |
| `buy_vested_shares` | `AvailableShares` | `.unwrap()` | `.expect("Contract not initialized: available shares")` |
| `buy_vested_shares` | `PricePerShare` | `.unwrap()` | `.expect("Contract not initialized: price")` |
| `buy_vested_shares` | `Admin` | `.unwrap()` | `.expect("Contract not initialized: admin")` |
| `buy_vested_shares` | `PaymentToken` | `.unwrap()` | `.expect("Contract not initialized: payment token")` |

**Total bare `.unwrap()` replaced: 6**

### Already using `.expect()` or `.unwrap_or()` (no change needed)

The following locations were already correct and left untouched:

- `buy_shares` — all four storage reads already used `.expect("Contract not initialized: ...")`
- `distribute_dividends` — admin, total_shares, payment_token all had `.expect(...)`
- `set_metadata_uri`, `set_dividend_schedule`, `pause`, `unpause`, `emergency_withdraw`, `set_price`, `set_total_shares` — all had `.expect("Contract not initialized: ...")`
- `process_scheduled_dividend` — dividend schedule used `.expect("Dividend schedule not configured")`
- `upgrade` — used `.expect("Contract not initialized")`
- `get_shares`, `get_available_shares`, `get_total_shares`, `get_price`, `is_paused`, `get_holders` — all used `.unwrap_or(default)` (correct: safe fallbacks for read-only getters)
- Arithmetic helpers (`checked_add_i128`, etc.) — used `.unwrap_or_else(|| panic!(...))` with detailed messages (correct)
- `cancel_sell_order`, `buy_from_order` — used `.unwrap_or_else(|| panic!("Order not found"))` (correct)
- `register_holder`, `load_vesting_schedules` — used `.unwrap_or_else(|| Vec::new(...))` (correct: safe empty defaults)

### Single remaining `.unwrap()` in test code

```
let schedule = c.get_dividend_schedule().unwrap();  // test assertion — intentional
```
This is in the `#[cfg(test)]` block and is an intentional test assertion on a known-set value. Not changed.

---

## New Tests Added

Three new pre-init panic tests added to the existing `pre_init_client()` helper pattern:

| Test | Expected panic |
|---|---|
| `test_pre_init_add_to_whitelist` | `"Contract not initialized"` |
| `test_pre_init_remove_from_whitelist` | `"Contract not initialized"` |
| `test_pre_init_buy_vested_shares` | `"Contract not initialized"` |

These join the existing suite of 7 pre-init tests (`buy_shares`, `pause`, `unpause`, `set_price`, `set_total_shares`, `distribute_dividends`, `emergency_withdraw`), bringing the total pre-init coverage to **10 functions**.

---

## Checklist

- [x] Audit all `.unwrap()` calls in `lib.rs`
- [x] Replace each with `.expect("...")` — 6 replacements made
- [x] Ensure all pre-init calls return user-friendly errors
- [x] Update tests for new error messages (3 new pre-init tests added)

---

## Files Changed

| File | Change |
|---|---|
| `contracts/src/lib.rs` | 6 `.unwrap()` → `.expect("Contract not initialized: ...")`, 3 new pre-init tests |

---

closes #80
