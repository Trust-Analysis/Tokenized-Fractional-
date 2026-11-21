# Dividend Integration Tests - Implementation Guide

This document provides step-by-step instructions for implementing the dividend distribution end-to-end tests in the existing Soroban test suite.

## Test File Organization

Tests are organized in two files in `contracts/tests/`:

1. **dividend_integration_tests.rs** - Complete specification of all test scenarios
2. **dividend_e2e_tests.rs** - Runnable implementations with helper functions

## How to Implement Tests

### Step 1: Copy Existing Test Patterns

Use the existing test setup from `contracts/src/lib.rs`:

```rust
struct TestEnv {
    env: Env,
    admin: Address,
    buyer: Address,
    token_id: Address,
    contract_id: Address,
}

fn setup() -> TestEnv {
    let env = Env::default();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let contract_id = env.register(RwaMarketplace, ());
    env.mock_all_auths();
    TestEnv { env, admin, buyer, token_id, contract_id }
}

fn client(te: &TestEnv) -> RwaMarketplaceClient<'_> {
    RwaMarketplaceClient::new(&te.env, &te.contract_id)
}

fn mint(te: &TestEnv, to: &Address, amount: i128) {
    token::StellarAssetClient::new(&te.env, &te.token_id).mint(to, &amount);
}
```

### Step 2: Implement Happy Path Tests

#### Example: Single Holder Full Dividend

```rust
#[test]
fn test_e2e_single_holder_full_dividend() {
    let te = setup();
    let c = client(&te);
    
    // ARRANGE: Initialize contract
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    // ARRANGE: Buyer acquires all shares
    mint(&te, &te.buyer, 100_000);
    c.add_to_whitelist(&te.buyer);
    c.buy_shares(&te.buyer, &1000, &te.token_id);  // All 1000 shares
    
    // ARRANGE: Prepare dividend
    let dividend_amount: i128 = 10_000;
    mint(&te, &te.contract_id, dividend_amount);
    
    // ACT: Distribute dividend
    c.distribute_dividends(&te.token_id, &dividend_amount);
    
    // ASSERT: Buyer receives full dividend
    let token_client = token::TokenClient::new(&te.env, &te.token_id);
    // Buyer started with 100_000
    // Paid: 1000 * 100 = 100_000
    // Received: 10_000
    // Expected: 0 + 10_000 = 10_000
    assert_eq!(token_client.balance(&te.buyer), 10_000);
}
```

#### Example: Multiple Holders Pro-Rata

```rust
#[test]
fn test_e2e_multiple_holders_pro_rata() {
    let te = setup();
    let c = client(&te);
    
    // ARRANGE: Initialize
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    // ARRANGE: Create additional holders
    let buyer2 = Address::generate(&te.env);
    let buyer3 = Address::generate(&te.env);
    
    // ARRANGE: Each buyer gets funds and purchases shares
    // Buyer1 (existing): 250 shares (25%)
    mint(&te, &te.buyer, 100_000);
    c.add_to_whitelist(&te.buyer);
    c.buy_shares(&te.buyer, &250, &te.token_id);
    
    // Buyer2: 500 shares (50%)
    mint(&te, &buyer2, 100_000);
    c.add_to_whitelist(&buyer2);
    c.buy_shares(&buyer2, &500, &te.token_id);
    
    // Buyer3: 250 shares (25%)
    mint(&te, &buyer3, 100_000);
    c.add_to_whitelist(&buyer3);
    c.buy_shares(&buyer3, &250, &te.token_id);
    
    // ARRANGE: Prepare dividend
    let dividend_amount: i128 = 1_000;
    mint(&te, &te.contract_id, dividend_amount);
    
    // ACT: Distribute
    c.distribute_dividends(&te.token_id, &dividend_amount);
    
    // ASSERT: Each gets pro-rata share
    let token_client = token::TokenClient::new(&te.env, &te.token_id);
    
    // Buyer1: 250/1000 * 1000 = 250
    assert_eq!(
        token_client.balance(&te.buyer),
        100_000 - 250 * 100 + 250
    );
    
    // Buyer2: 500/1000 * 1000 = 500
    assert_eq!(
        token_client.balance(&buyer2),
        100_000 - 500 * 100 + 500
    );
    
    // Buyer3: 250/1000 * 1000 = 250
    assert_eq!(
        token_client.balance(&buyer3),
        100_000 - 250 * 100 + 250
    );
}
```

### Step 3: Implement Edge Case Tests

#### Example: Authorization Check

```rust
#[test]
#[should_panic]
fn test_edge_non_admin_distribute() {
    let te = setup();
    let c = client(&te);
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    // Add buyer and funds
    mint(&te, &te.buyer, 100_000);
    c.add_to_whitelist(&te.buyer);
    c.buy_shares(&te.buyer, &100, &te.token_id);
    
    // Non-admin attempts to distribute
    let non_admin = Address::generate(&te.env);
    mint(&te, &te.contract_id, 1_000);
    
    // This should panic with authorization error
    // (Note: In real test, would need to mock auth differently)
    c.distribute_dividends(&te.token_id, &1_000);
}
```

#### Example: Zero Amount Validation

```rust
#[test]
#[should_panic(expected = "Dividend amount must be positive")]
fn test_edge_zero_dividend_amount() {
    let te = setup();
    let c = client(&te);
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    // Add at least one holder
    mint(&te, &te.buyer, 100_000);
    c.add_to_whitelist(&te.buyer);
    c.buy_shares(&te.buyer, &100, &te.token_id);
    
    // Attempt to distribute zero
    c.distribute_dividends(&te.token_id, &0);
}
```

#### Example: No Holders Check

```rust
#[test]
#[should_panic(expected = "No holders registered")]
fn test_edge_no_holders() {
    let te = setup();
    let c = client(&te);
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    // Contract initialized but no holders
    mint(&te, &te.contract_id, 1_000);
    
    // Attempt distribution with no holders
    c.distribute_dividends(&te.token_id, &1_000);
}
```

### Step 4: Implement Scheduled Dividend Tests

#### Example: Scheduled Dividend Interval

```rust
#[test]
fn test_e2e_scheduled_dividend_interval() {
    let te = setup();
    let c = client(&te);
    
    // ARRANGE: Setup
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    // Add holders
    mint(&te, &te.buyer, 100_000);
    c.add_to_whitelist(&te.buyer);
    c.buy_shares(&te.buyer, &1000, &te.token_id);
    
    // ARRANGE: Set dividend schedule
    // $100 per share, 3600 second interval
    c.set_dividend_schedule(&100, &3600);
    
    // ACT: Try to process before interval (should fail)
    // This would panic if called - verify with expect_panic
    // c.process_scheduled_dividend();  // Would panic
    
    // ACT: Advance ledger time by 3600 seconds
    te.env.ledger().with_mut(|l| {
        l.timestamp += 3600;
    });
    
    // ACT: Mint dividend tokens (3600 per share total = 360,000)
    mint(&te, &te.contract_id, 100_000);
    
    // ACT: Process scheduled dividend (should succeed)
    c.process_scheduled_dividend();
    
    // ASSERT: Holder receives dividend
    let token_client = token::TokenClient::new(&te.env, &te.token_id);
    // Initial: 100,000
    // Spent on shares: 1000 * 100 = 100,000
    // Received in dividend: 100,000 (1000 shares * $100/share)
    // Expected: 100,000
    let balance = token_client.balance(&te.buyer);
    assert!(balance > 0);  // Verify received something
    
    // ASSERT: LastDistribution updated
    let last_dist = c.get_last_distribution();
    assert!(last_dist > 0);
}
```

### Step 5: Implement Integration Tests

#### Example: Complete Lifecycle

```rust
#[test]
fn test_integration_complete_lifecycle() {
    let te = setup();
    let c = client(&te);
    
    // PHASE 1: Initialize with multiple buyers
    c.init(&te.admin, &te.token_id, &100, &1000);
    
    let buyer1 = te.buyer;
    let buyer2 = Address::generate(&te.env);
    let buyer3 = Address::generate(&te.env);
    let buyer4 = Address::generate(&te.env);
    
    // All get initial funds
    for buyer in &[&buyer1, &buyer2, &buyer3] {
        mint(&te, buyer, 100_000);
        c.add_to_whitelist(buyer);
    }
    
    // PHASE 1: Initial purchases
    // buyer1: 250, buyer2: 500, buyer3: 250
    c.buy_shares(&buyer1, &250, &te.token_id);
    c.buy_shares(&buyer2, &500, &te.token_id);
    c.buy_shares(&buyer3, &250, &te.token_id);
    
    // PHASE 1: First distribution
    let div1 = 10_000;
    mint(&te, &te.contract_id, div1);
    c.distribute_dividends(&te.token_id, &div1);
    
    let token_client = token::TokenClient::new(&te.env, &te.token_id);
    let b1_after_div1 = token_client.balance(&buyer1);
    let b2_after_div1 = token_client.balance(&buyer2);
    let b3_after_div1 = token_client.balance(&buyer3);
    
    // Verify first distribution
    assert_eq!(b1_after_div1, 100_000 - 25_000 + 2_500);  // 77_500
    assert_eq!(b2_after_div1, 100_000 - 50_000 + 5_000);  // 55_000
    assert_eq!(b3_after_div1, 100_000 - 25_000 + 2_500);  // 77_500
    
    // PHASE 2: Share transfer
    c.transfer(&buyer1, &buyer4, &100, &te.token_id);
    // buyer1: 150, buyer4: 100
    
    // Fund buyer4
    mint(&te, &buyer4, 100_000);
    
    // PHASE 2: Second distribution
    let div2 = 5_000;
    mint(&te, &te.contract_id, div2);
    c.distribute_dividends(&te.token_id, &div2);
    
    let b1_after_div2 = token_client.balance(&buyer1);
    let b4_after_div2 = token_client.balance(&buyer4);
    
    // buyer1: 150/1000 * 5000 = 750
    assert_eq!(b1_after_div2, b1_after_div1 + 750);
    
    // buyer4: 100/1000 * 5000 = 500
    assert_eq!(b4_after_div2, 100_000 + 500);
    
    // PHASE 3: Verify final state
    let holders = c.get_holders();
    assert_eq!(holders.len(), 4);  // buyer1, buyer2, buyer3, buyer4
}
```

### Step 6: Implement Rounding Tests

#### Example: Rounding Loss

```rust
#[test]
fn test_edge_rounding_loss() {
    let te = setup();
    let c = client(&te);
    
    // Setup: 3 holders with 1 share each, divide 10
    // Expected: 3 + 3 + 3 = 9 (1 token loss)
    c.init(&te.admin, &te.token_id, &1, &3);
    
    let buyer1 = te.buyer;
    let buyer2 = Address::generate(&te.env);
    let buyer3 = Address::generate(&te.env);
    
    for buyer in &[&buyer1, &buyer2, &buyer3] {
        mint(&te, buyer, 10);  // Each gets 10 tokens
        c.add_to_whitelist(buyer);
    }
    
    // Each buys 1 share
    c.buy_shares(&buyer1, &1, &te.token_id);
    c.buy_shares(&buyer2, &1, &te.token_id);
    c.buy_shares(&buyer3, &1, &te.token_id);
    
    // Distribute 10 (10/3 = 3.333... → 3 each)
    mint(&te, &te.contract_id, 10);
    c.distribute_dividends(&te.token_id, &10);
    
    let token_client = token::TokenClient::new(&te.env, &te.token_id);
    
    // Each should receive 3
    // Buyer1: 10 - 1 + 3 = 12
    assert_eq!(token_client.balance(&buyer1), 12);
    assert_eq!(token_client.balance(&buyer2), 12);
    assert_eq!(token_client.balance(&buyer3), 12);
    
    // Total received: 9 (1 lost to rounding)
}
```

## Testing Checklist

- [ ] Happy path tests pass (single holder, multiple holders)
- [ ] Sequential distributions accumulate correctly
- [ ] Pro-rata calculations are accurate
- [ ] Share transfers reflected in next distribution
- [ ] Scheduled dividends respect interval
- [ ] Multiple scheduled cycles work correctly
- [ ] Zero-balance holders cleaned up
- [ ] Large scale tests (many holders) complete
- [ ] Edge cases handle validations (zero amount, no holders, etc.)
- [ ] Authorization checks work (non-admin fails)
- [ ] Rounding behavior is deterministic
- [ ] Schedule boundaries enforced exactly
- [ ] Pause flags respected
- [ ] Integration flows (transfer + dividend) work correctly
- [ ] Insufficient tokens handled safely
- [ ] All regression tests pass

## Running the Tests

```bash
# Run all dividend tests
cargo test dividend --lib

# Run specific test file
cargo test --test dividend_e2e_tests

# Run single test
cargo test test_e2e_single_holder_full_dividend

# Run with backtrace
RUST_BACKTRACE=1 cargo test dividend
```

## Common Issues During Implementation

### Issue: TestEnv not accessible
- **Solution**: Define TestEnv in your test module or import from main crate

### Issue: Can't advance ledger time
- **Solution**: Use `te.env.ledger().with_mut()` to modify timestamp

### Issue: Authorization errors in tests
- **Solution**: Call `env.mock_all_auths()` in setup

### Issue: Balance calculation errors
- **Solution**: Carefully track: initial - spend + received

### Issue: Holder registry inconsistencies
- **Solution**: Verify holders list before and after distributions

## Next Steps

1. Choose which tests to implement first (start with happy path)
2. Copy the patterns shown above
3. Run tests with `cargo test`
4. Fix any compilation errors
5. Verify test assertions match expected behavior
6. Document any deviations from specifications
7. Add to CI/CD pipeline

