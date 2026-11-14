# Dividend Distribution Integration Test Guide

## Overview

This guide documents comprehensive end-to-end integration tests for the dividend distribution functionality in the RWA Marketplace smart contract. The tests verify both manual and scheduled dividend distributions, covering happy paths, edge cases, and integration flows.

## Test Scope

### What We Test

1. **Manual Dividend Distribution** (`distribute_dividends`)
   - Single holder receiving full dividend
   - Multiple holders receiving pro-rata shares
   - Pro-rata calculations with various share distributions
   - Multiple sequential distributions
   - Distribution after share transfers
   - Cleanup of zero-balance holders

2. **Scheduled Dividend Distribution** (`process_scheduled_dividend`)
   - Setting and retrieving dividend schedules
   - Processing at correct time intervals
   - Multiple scheduled distributions
   - Time boundary conditions
   - LastDistribution timestamp tracking

3. **Integration Flows**
   - Complete marketplace lifecycle with dividends
   - Mixed manual and scheduled distributions
   - Holder registry churn
   - Concurrent operations
   - Error handling and rollback

4. **Edge Cases & Boundaries**
   - Minimal dividend amounts
   - Maximum dividend amounts
   - Rounding and loss in fixed-point arithmetic
   - Division by zero prevention
   - Authorization checks
   - Pause flag enforcement

## Test Categories

### 1. Happy Path Tests (1.1 - 1.10)

#### Test 1.1: Single Holder Full Dividend
- **Purpose**: Verify basic dividend distribution to sole shareholder
- **Setup**: 1 holder with 100% ownership
- **Action**: Distribute dividend
- **Assertion**: Holder receives full dividend amount

```
Setup Phase:
  - Initialize contract: 1000 shares, $100/share
  - Mint $100,000 to buyer
  - Buyer purchases 1000 shares (100% ownership)
  - Mint $10,000 dividend to contract

Execution Phase:
  - Admin distributes $10,000

Verification Phase:
  - Buyer receives: $10,000
  - Contract dividend balance: $0
  - Holder registry: 1 holder
```

#### Test 1.2: Multiple Holders Pro-Rata
- **Purpose**: Verify correct pro-rata distribution
- **Setup**: 3 holders with 25%, 50%, 25% ownership
- **Action**: Distribute dividend
- **Assertion**: Each receives their pro-rata share

```
Setup Phase:
  - Initialize: 1000 shares total
  - Buyer1: 250 shares (25%)
  - Buyer2: 500 shares (50%)
  - Buyer3: 250 shares (25%)
  - Mint $1,000 dividend

Execution Phase:
  - distribute_dividends($1,000)

Expected Results:
  - Buyer1: +$250
  - Buyer2: +$500
  - Buyer3: +$250
  - Total distributed: $1,000
```

**Pro-Rata Formula**: `holder_dividend = total_dividend * holder_shares / total_shares`

#### Test 1.3: Uneven Distribution Pro-Rata
- **Purpose**: Verify rounding in fixed-point arithmetic
- **Setup**: 333, 667 share split; distribute $999
- **Expected**: 
  - Holder1: floor(999 * 333 / 1000) = 332
  - Holder2: floor(999 * 667 / 1000) = 666
  - Rounding loss: 1 token (acceptable)

#### Test 1.4: Multiple Sequential Distributions
- **Purpose**: Verify cumulative dividend payments
- **Sequence**:
  1. Setup holders
  2. Distribute $1,000
  3. Verify balances
  4. Distribute $2,000
  5. Verify cumulative balances
  6. Distribute $500
  7. Verify final balances

**Key Point**: Each holder's balance accumulates; no resets between distributions.

#### Test 1.5: Distribution After Share Transfer
- **Purpose**: Verify holder registry updates with dividends
- **Scenario**:
  1. Buyer1: 100 shares, Buyer2: 100 shares
  2. Buyer1 transfers 50 to Buyer3
  3. Distribute $200
- **Expected**:
  - Buyer1 (50 shares): $50
  - Buyer2 (100 shares): $100
  - Buyer3 (50 shares): $50
  - Buyer1 only receives for remaining shares (no double-count)

#### Test 1.6: Scheduled Dividend Interval
- **Purpose**: Verify time-based dividend processing
- **Setup**:
  - Schedule: $500/share, 86400 second interval
  - Total shares: 1000
  - Expected total: $500,000
- **Execution**:
  1. Call process_scheduled_dividend (before interval) → fails
  2. Advance ledger by 86400 seconds
  3. Call process_scheduled_dividend → succeeds
- **Verification**:
  - LastDistribution updated
  - All holders receive pro-rata amounts
  - Next call before interval fails

#### Test 1.7: Scheduled Dividend Multiple Holders
- **Purpose**: Verify scheduled distribution to multiple holders
- **Setup**:
  - 1000 total shares (4 holders, 250 each)
  - Schedule: 10 per share, 3600 second interval
  - Expected total: 10 * 1000 = $10,000
- **Expected Distribution**:
  - Each holder (250 shares): $2,500 (25%)

#### Test 1.8: Repeated Scheduled Dividends
- **Purpose**: Verify multiple scheduled executions
- **Sequence**:
  1. Setup schedule
  2. Process (iteration 1)
  3. Advance time by interval
  4. Process (iteration 2)
  5. Advance time by interval
  6. Process (iteration 3)
- **Key Verifications**:
  - LastDistribution updates each time
  - Balances accumulate correctly
  - Holder registry remains consistent
  - No double-distributions

#### Test 1.9: Dividend Cleans Zero-Balance Holders
- **Purpose**: Verify registry cleanup during distribution
- **Setup**:
  - 2 holders: 100 shares each
  - Holder1 sells all shares (balance → 0)
  - Holder1 remains in registry until next distribution
- **Execution**:
  1. Verify holders.len() == 2
  2. Force Holder1 balance to 0
  3. Distribute dividend
- **Expected**:
  - Holder1 removed from registry
  - Holder2 receives dividend
  - holders.len() == 1

**Important**: Zero-balance cleanup happens **during** distribution, not after.

#### Test 1.10: Large Scale Dividend
- **Purpose**: Verify scalability with many holders
- **Setup**:
  - 50 holders, 200 shares each (10,000 total)
  - Distribute $50,000
- **Expected**:
  - Each holder: $1,000 (10,000 / 50,000)
  - No overflow errors
  - All 50 transfers succeed
  - Holder registry contains all 50 addresses

---

### 2. Edge Case Tests (2.1 - 2.13)

#### Test 2.1: Minimal Dividend Amount
- **Setup**: 100 holders, 1 share each, distribute 100 units
- **Expected**: Each receives 1 unit
- **Purpose**: Verify no underflow or precision loss

#### Test 2.2: Maximum Dividend Amount
- **Setup**: Single holder, distribute near i128::MAX
- **Purpose**: Verify no overflow in multiplication
- **Key Code**: `checked_mul_i128(total_amount, holder_shares as i128)`

#### Test 2.3: Rounding Loss (Acceptable)
- **Setup**: 3 holders (1 share each), distribute 10 units
- **Calculation**:
  - 10 / 3 = 3.333... → 3 per holder (fixed-point)
  - Total paid: 3 + 3 + 3 = 9
  - Rounding loss: 1 (acceptable)
- **Purpose**: Verify deterministic rounding behavior
- **Important**: This loss is acceptable in DeFi contracts (fractions of smallest unit)

#### Test 2.4: Schedule Interval Boundary
- **Boundary Condition**: `now < last_distribution.saturating_add(interval)`
- **Tests**:
  1. `now = last + 0s` → fails
  2. `now = last + interval - 1s` → fails  
  3. `now = last + interval` → succeeds
  4. `now = last + interval + 1s` → succeeds
- **Purpose**: Verify exact boundary enforcement

#### Test 2.5-2.10: Authorization & Validation
- **2.5**: Zero interval fails → panic("Interval must be positive")
- **2.6**: Zero amount fails → panic("Dividend amount must be positive")
- **2.7**: No holders fails → panic("No holders registered")
- **2.8**: No schedule fails → panic("Dividend schedule not configured")
- **2.9**: Non-admin distribute fails → authorization error
- **2.10**: Non-admin set schedule fails → authorization error

#### Test 2.11: Paused Distribution
- **Purpose**: Verify pause flag enforcement (Issue #310)
- **Setup**:
  1. Set dividend pause flag (FunctionPauseFlags bit 2)
  2. Attempt distribute_dividends
- **Expected**: Panic with "Dividend distribution is currently paused"

#### Test 2.12: Extreme Share Count
- **Setup**:
  - u32::MAX shares total
  - 2 holders split evenly
  - Large dividend amount
- **Purpose**: Verify no overflow in: `total_amount * holder_shares / total_shares`
- **Key**: Use `checked_mul_i128` to prevent overflow

#### Test 2.13: Single Share Holder
- **Setup**:
  - Holder A: 999 shares
  - Holder B: 1 share
  - Dividend: $1,000
- **Expected**:
  - A: 999
  - B: 1
- **Purpose**: Verify single-share holders receive proportional amounts

---

### 3. Integration Flow Tests (3.1 - 3.5)

#### Test 3.1: Complete Marketplace Lifecycle

**Phase 1: Setup & Initial Distribution**
```
- Admin initializes: 1000 shares, $100/share
- Buyer1: 250 shares
- Buyer2: 500 shares
- Buyer3: 250 shares
- Distribute: $10,000
  - Buyer1: +$2,500
  - Buyer2: +$5,000
  - Buyer3: +$2,500
```

**Phase 2: Share Transfer & Second Distribution**
```
- Buyer1 transfers 100 shares to Buyer4
  - Buyer1: 150 shares
  - Buyer4: 100 shares
- Distribute: $5,000
  - Buyer1: +$750 (150/1000 * $5,000)
  - Buyer2: +$2,500 (500/1000 * $5,000)
  - Buyer3: +$1,250 (250/1000 * $5,000)
  - Buyer4: +$500 (100/1000 * $5,000)
```

**Phase 3: Buyback & Third Distribution**
```
- Contract buys back 50 available shares
- Distribute: $2,000
- Verify holder calculations with reduced available shares
```

#### Test 3.2: Mixed Manual & Scheduled
- Manual distribute $500
- Set schedule: $100/share, 86400s
- Wait for interval
- Process scheduled (distributes $100k)
- Manual distribute $500 again
- **Key**: Verify all three succeed, balances accumulate

#### Test 3.3: Holder Churn
- **Sequence**:
  1. 5 holders → distribute
  2. 2 new buyers → 7 holders → distribute
  3. 3 holders sell → 4 holders (cleanup) → distribute
- **Key**: Registry size changes, calculations remain accurate

#### Test 3.4: Insufficient Dividend Tokens
- **Setup**: 10 holders, mint only $5,000 dividend
- **Attempt**: Distribute $10,000
- **Expected**: Transaction reverts, no partial payments
- **Important**: Atomicity - either all transfers or none

#### Test 3.5: Concurrent Share Purchase
- **Scenario**: During distribution, new buyer purchases shares
- **Expected**:
  - New buyer NOT in distribution snapshot
  - Existing holders receive correct amounts
  - New buyer included in NEXT distribution

---

### 4. Regression Tests

#### Regression 1: Checked Multiplication
- **Context**: Prevents: `dividend_amount * holder_shares` overflow
- **Test**: Large values that would overflow unchecked
- **Verification**: Uses `checked_mul_i128`, not unchecked

#### Regression 2: Holder Registry Update
- **Context**: Zero-balance cleanup during distribution
- **Test**: Verify holders removed as expected
- **Verification**: Registry length decreases for zero-balance accounts

#### Regression 3: LastDistribution Timestamp
- **Context**: Required for interval enforcement
- **Test**: Set schedule, process, query LastDistribution
- **Verification**: Updated to current ledger timestamp

#### Regression 4: Event Emission
- **Context**: Off-chain indexing depends on events
- **Tests**:
  - EventDistributeDividends on manual distribution
  - EventScheduledDividend on scheduled distribution
  - Correct token, amount, holder_count

#### Regression 5: Pause Flag Enforcement
- **Context**: Issue #310 - Granular pause controls
- **Test**: Set dividend pause flag, attempt distribution
- **Verification**: Fails with pause error

---

## Test Implementation Pattern

### Basic Test Structure

```rust
#[test]
fn test_description() {
    // ARRANGE: Setup test environment
    let te = setup();
    let c = client(&te);
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    let buyer = Address::generate(&te.env);
    mint(&te, &buyer, 100_000);
    c.add_to_whitelist(&buyer);
    
    // ACT: Execute the test scenario
    c.buy_shares(&buyer, &500, &te.token_id);
    mint(&te, &te.contract_id, 10_000);
    c.distribute_dividends(&te.token_id, &10_000);
    
    // ASSERT: Verify outcomes
    let token_client = token::TokenClient::new(&te.env, &te.token_id);
    let expected_balance = 100_000 - 500 * 100 + 5_000;
    assert_eq!(token_client.balance(&buyer), expected_balance);
}
```

### Test with Should Panic

```rust
#[test]
#[should_panic(expected = "Dividend amount must be positive")]
fn test_zero_dividend_fails() {
    let te = setup();
    let c = client(&te);
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    c.distribute_dividends(&te.token_id, &0);
}
```

### Test with Multiple Holders

```rust
#[test]
fn test_multiple_holders_pro_rata() {
    let te = setup();
    let c = client(&te);
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    // Create multiple buyers
    let holders = vec![
        (Address::generate(&te.env), 250_u32),
        (Address::generate(&te.env), 500_u32),
        (Address::generate(&te.env), 250_u32),
    ];
    
    // Each buys their shares
    for (buyer, shares) in &holders {
        mint(&te, buyer, 100_000);
        c.add_to_whitelist(buyer);
        c.buy_shares(buyer, shares, &te.token_id);
    }
    
    // Distribute
    mint(&te, &te.contract_id, 1_000);
    c.distribute_dividends(&te.token_id, &1_000);
    
    // Verify each received pro-rata amount
    let token_client = token::TokenClient::new(&te.env, &te.token_id);
    for (buyer, shares) in &holders {
        let expected_dividend = 1_000 * (*shares as i128) / 1000;
        let expected_balance = 100_000 - (*shares as i128) * 100 + expected_dividend;
        assert_eq!(token_client.balance(buyer), expected_balance);
    }
}
```

---

## Running the Tests

### Run All Dividend Tests
```bash
cd contracts
cargo test dividend
```

### Run Specific Test File
```bash
cargo test --test dividend_e2e_tests
cargo test --test dividend_integration_tests
```

### Run Single Test
```bash
cargo test single_holder_full_dividend
```

### Run with Output
```bash
cargo test -- --nocapture
```

### Run with Backtrace on Panic
```bash
RUST_BACKTRACE=1 cargo test
```

---

## Test Data & Scenarios

### Dividend Calculation Examples

**Example 1: Even Split**
- Total shares: 1000
- Holders: 3 (333, 333, 334)
- Dividend: $1,000
- Distribution:
  - H1: floor(1000 * 333 / 1000) = 333
  - H2: floor(1000 * 333 / 1000) = 333
  - H3: floor(1000 * 334 / 1000) = 334
  - Total: 1,000 ✓

**Example 2: Uneven Split**
- Total shares: 1000
- Holders: 2 (333, 667)
- Dividend: $999
- Distribution:
  - H1: floor(999 * 333 / 1000) = 332
  - H2: floor(999 * 667 / 1000) = 666
  - Total: 998 (1 unit rounding loss)

**Example 3: Scheduled Dividend**
- Schedule: 100 per share
- Total shares: 1000
- Total dividend: 100 * 1000 = 100,000
- Distribution to 4 equal holders:
  - Each: 100,000 / 4 = 25,000

---

## Assertions & Verifications

### Balance Assertions
```rust
// Verify dividend amount received
let expected = initial_balance - purchase_cost + dividend;
assert_eq!(actual_balance, expected);

// Verify sum of all distributions equals total distributed
let mut total_received = 0;
for holder in holders {
    total_received += get_balance(&holder);
}
assert_eq!(total_received, dividend_amount);
```

### Holder Registry Assertions
```rust
// Verify holder count
assert_eq!(c.get_holders().len(), expected_count);

// Verify specific holder is registered
assert!(c.get_holders().contains(&expected_holder));

// Verify zero-balance holders removed
let holders_before = c.get_holders().len();
// ... perform distribution ...
let holders_after = c.get_holders().len();
assert_eq!(holders_after, holders_before - 1);
```

### Timestamp Assertions
```rust
// Verify LastDistribution updated
let last_dist = c.get_last_distribution();
assert_eq!(last_dist, te.env.ledger().timestamp());

// Verify next call before interval fails
te.env.advance_ledger_to_round(ledger + 100);
// ... process_scheduled_dividend should fail ...
```

---

## Common Issues & Solutions

### Issue 1: Rounding Loss in Pro-Rata Calculation
- **Problem**: Not all tokens may be distributed due to integer division
- **Solution**: This is acceptable in fixed-point arithmetic. Document the loss.
- **Verification**: Total paid ≤ total_dividend

### Issue 2: Holder Registry Inconsistency
- **Problem**: Zero-balance holders not cleaned up
- **Solution**: Distribution loop filters out zero-balance holders
- **Verification**: Check registry after each distribution

### Issue 3: Overflow in Multiplication
- **Problem**: `total_amount * holder_shares` overflows i128
- **Solution**: Use `checked_mul_i128` helper function
- **Verification**: No panic on large values

### Issue 4: Pause Flag Not Respected
- **Problem**: Distribution succeeds when paused
- **Solution**: Check `FunctionPauseFlags` in `distribute_dividends`
- **Verification**: Panic when dividend flag is set

### Issue 5: Interval Not Enforced
- **Problem**: Scheduled dividend processes before interval
- **Solution**: Verify `now >= last_distribution + interval`
- **Verification**: Test boundary conditions

---

## Performance Considerations

### Gas Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| distribute_dividends | O(n) | n = number of holders |
| process_scheduled_dividend | O(n) | n = number of holders |
| set_dividend_schedule | O(1) | Single storage write |
| get_dividend_schedule | O(1) | Single storage read |

### Large-Scale Testing

For tests with many holders (e.g., 1000+):
- Consider performance impact
- May need to use unit tests for very large numbers
- Document performance expectations

---

## Continuous Integration

### Test Command for CI/CD
```bash
cargo test --all --verbose -- --nocapture --test-threads=1
```

### Coverage Expectations
- Line coverage: >95%
- Branch coverage: >90%
- All test categories: Happy, Edge, Integration, Regression

### Test Maintenance
- Review tests when code changes
- Update assertions for new behavior
- Add regression tests for bugs found
- Document test changes in PRs

---

## References

- [Smart Contract Code](./contracts/src/lib.rs)
- [Dividend Distribution Implementation](./contracts/src/lib.rs#L941-L1020)
- [Scheduled Dividend Processing](./contracts/src/lib.rs#L1257-L1333)
- [Test Utilities](./contracts/src/lib.rs#L2724-L2755)
- [Issue #310: Granular Pause Controls](./docs/ADRs/adr-310.md)
- [Soroban SDK Testing Documentation](https://developers.stellar.org/docs/learn/writing-smart-contracts/learning-path/persisting-data#testing)

---

## Test Checklist

Use this checklist when adding new dividend tests:

- [ ] Test has clear description of what it verifies
- [ ] ARRANGE phase sets up valid state
- [ ] ACT phase executes the operation
- [ ] ASSERT phase verifies outcomes
- [ ] Test uses consistent helper functions
- [ ] Test includes comments for complex calculations
- [ ] Expected panic messages are specific
- [ ] Test covers both success and failure paths
- [ ] Test name clearly describes scenario
- [ ] Test is independent (can run in any order)
- [ ] Test cleans up resources (if needed)
- [ ] Test documentation in this guide is updated

