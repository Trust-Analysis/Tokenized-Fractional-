# Purchase Limits Implementation (Issue #274)

## Overview

This implementation adds comprehensive purchase limits to the RWA Marketplace contract to prevent concentration and ensure fair distribution. The system supports multiple limit types, time-based restrictions, tiered limits for different user classes, and limit exemptions.

## Features

### 1. Multiple Limit Types

- **Maximum Shares Per User**: Limits the total number of shares a single address can hold
- **Maximum Value Per User**: Limits the total value (in payment tokens) a user can purchase
- **Daily Limits**: Separate share and value limits per 24-hour period
- **Weekly Limits**: Separate share and value limits per 7-day period
- **Monthly Limits**: Separate share and value limits per 30-day period

### 2. Time-Based Limits

The system automatically tracks purchases across three time windows:
- **Daily**: 86,400 seconds (24 hours)
- **Weekly**: 604,800 seconds (7 days)
- **Monthly**: 2,592,000 seconds (30 days)

Counters automatically reset when the time period expires.

### 3. Tiered Limits

Integration with the existing whitelist tier system:
- **Tier 0 (Standard)**: Base limits
- **Tier 1 (Premium)**: Multipliers applied to daily limits
- **Tier 2 (Institutional)**: Higher limits and multipliers

Tier-specific limits can override global limits when configured.

### 4. Limit Exemptions

Admin can exempt specific addresses from all purchase limits for special cases (e.g., market makers, strategic partners).

### 5. Event Logging

All limit violations and configuration changes emit events for monitoring and analytics:
- `EventPurchaseLimitConfigSet`: When limits are configured
- `EventLimitViolation`: When a user attempts to exceed limits
- `EventLimitExemptSet`: When exemption status changes
- `EventTierLimitsSet`: When tier-specific limits are configured
- `EventUserPurchaseReset`: When admin resets user limits

### 6. Violation Tracking

The system tracks the number of limit violations per user for analytics and potential enforcement actions.

## Data Structures

### PurchaseLimitConfig

```rust
pub struct PurchaseLimitConfig {
    pub max_shares_per_user: u32,      // 0 = no limit
    pub max_value_per_user: i128,      // 0 = no limit
    pub daily_shares_limit: u32,       // 0 = no limit
    pub daily_value_limit: i128,       // 0 = no limit
    pub weekly_shares_limit: u32,      // 0 = no limit
    pub weekly_value_limit: i128,      // 0 = no limit
    pub monthly_shares_limit: u32,     // 0 = no limit
    pub monthly_value_limit: i128,     // 0 = no limit
    pub enabled: bool,                 // Master switch
}
```

### UserPurchaseHistory

```rust
pub struct UserPurchaseHistory {
    pub last_purchase_time: u64,
    pub daily_shares: u32,
    pub daily_value: i128,
    pub day_start: u64,
    pub weekly_shares: u32,
    pub weekly_value: i128,
    pub week_start: u64,
    pub monthly_shares: u32,
    pub monthly_value: i128,
    pub month_start: u64,
}
```

### TierLimits

```rust
pub struct TierLimits {
    pub max_shares: u32,                    // 0 = use global
    pub max_value: i128,                    // 0 = use global
    pub daily_shares_multiplier: u32,       // basis points, 10000 = 1x
    pub daily_value_multiplier: u32,         // basis points, 10000 = 1x
}
```

## API Functions

### Configuration Functions (Admin Only)

#### `set_purchase_limits`

Sets comprehensive purchase limits for the marketplace.

```rust
pub fn set_purchase_limits(
    env: Env,
    max_shares: u32,
    max_value: i128,
    daily_shares: u32,
    daily_value: i128,
    weekly_shares: u32,
    weekly_value: i128,
    monthly_shares: u32,
    monthly_value: i128,
    enabled: bool,
)
```

**Parameters:**
- All limit values of 0 mean "no limit" for that category
- `enabled` acts as a master switch for all limits

#### `set_purchase_limits_enabled`

Enable or disable purchase limit enforcement without changing the actual limits.

```rust
pub fn set_purchase_limits_enabled(env: Env, enabled: bool)
```

#### `set_tier_limits`

Configure tier-specific limits for a whitelist tier.

```rust
pub fn set_tier_limits(
    env: Env,
    tier: u32,           // 0, 1, or 2
    max_shares: u32,
    max_value: i128,
    daily_shares_multiplier: u32,    // basis points
    daily_value_multiplier: u32,     // basis points
)
```

**Note:** Multipliers are in basis points (10000 = 1x, 15000 = 1.5x, 20000 = 2x)

#### `set_limit_exempt`

Set exemption status for a specific address.

```rust
pub fn set_limit_exempt(env: Env, address: Address, exempt: bool)
```

#### `reset_user_purchase_limits`

Reset a user's purchase history for a specific time period (admin only).

```rust
pub fn reset_user_purchase_limits(env: Env, address: Address, period: u32)
```

**Period values:**
- 1 = daily
- 2 = weekly
- 3 = monthly

### Query Functions

#### `get_purchase_limits`

Get the current global purchase limit configuration.

```rust
pub fn get_purchase_limits(env: Env) -> PurchaseLimitConfig
```

#### `get_tier_limits`

Get tier-specific limits for a given tier.

```rust
pub fn get_tier_limits(env: Env, tier: u32) -> TierLimits
```

#### `is_limit_exempt`

Check if an address is exempt from purchase limits.

```rust
pub fn is_limit_exempt(env: Env, address: Address) -> bool
```

#### `get_user_purchase_history`

Get a user's purchase history for monitoring and analytics.

```rust
pub fn get_user_purchase_history(env: Env, address: Address) -> UserPurchaseHistory
```

#### `get_limit_violations`

Get the number of limit violations for a user.

```rust
pub fn get_limit_violations(env: Env, address: Address) -> u32
```

## Integration Points

### Purchase Functions

The limit validation is integrated into all purchase functions:

1. **`buy_shares`**: Standard share purchases from the marketplace
2. **`buy_vested_shares`**: Purchases with vesting schedules
3. **`buy_from_order`**: Purchases from sell orders

All purchase functions now:
1. Calculate the purchase value
2. Call `_validate_purchase_limits()` before token transfer
3. Update purchase history after successful purchase
4. Emit violation events if limits are exceeded

### Validation Flow

```
Purchase Request
    ↓
Check if limits enabled
    ↓ (if enabled)
Check if user is exempt
    ↓ (if not exempt)
Get user's whitelist tier
    ↓
Apply tier-specific multipliers
    ↓
Check maximum shares limit
    ↓
Check maximum value limit
    ↓
Check daily limits (with auto-reset)
    ↓
Check weekly limits (with auto-reset)
    ↓
Check monthly limits (with auto-reset)
    ↓
Update purchase history
    ↓
Allow purchase
```

## Gas Efficiency

The implementation is designed for gas efficiency:

1. **Early Returns**: Validation returns early if limits are disabled or user is exempt
2. **Lazy Loading**: Purchase history is only loaded when limits are enabled
3. **Batch Updates**: All time-based counters are updated in a single operation
4. **Minimal Storage**: Only stores essential data, uses efficient data types
5. **Selective Validation**: Only checks limits that are configured (non-zero)

## Security Considerations

1. **Admin Control**: All configuration functions require admin authentication
2. **No Retroactive Application**: Limits only apply to future purchases, not existing holdings
3. **Exemption Management**: Exemptions require explicit admin action
4. **Violation Tracking**: All violations are logged for monitoring
5. **Circuit Breaker Compatible**: Works with existing circuit breaker mechanism

## Migration Guide

### For Existing Deployments

The purchase limits system is backward compatible:

1. **Disabled by Default**: New limits are disabled until explicitly enabled
2. **Legacy Limits Preserved**: The existing `MaxSharesPerUser` limit continues to work
3. **Gradual Rollout**: Admins can enable limits gradually after testing

### Recommended Deployment Steps

1. Deploy the updated contract
2. Configure appropriate limits using `set_purchase_limits`
3. Set up tier-specific limits if using whitelist tiers
4. Test with small limits on a testnet
5. Enable limits in production using `set_purchase_limits_enabled(true)`
6. Monitor violation events for the first few days
7. Adjust limits as needed based on actual usage patterns

## Example Configurations

### Conservative Configuration

```rust
set_purchase_limits(
    max_shares: 1000,              // Max 1000 shares per user
    max_value: 100000000000,      // Max 100,000 tokens (assuming 7 decimals)
    daily_shares: 100,            // Max 100 shares per day
    daily_value: 10000000000,      // Max 10,000 tokens per day
    weekly_shares: 500,           // Max 500 shares per week
    weekly_value: 50000000000,    // Max 50,000 tokens per week
    monthly_shares: 1000,         // Max 1000 shares per month
    monthly_value: 100000000000,  // Max 100,000 tokens per month
    enabled: true
)
```

### Tiered Configuration

```rust
// Standard tier (0)
set_tier_limits(
    tier: 0,
    max_shares: 1000,
    max_value: 100000000000,
    daily_shares_multiplier: 10000,  // 1x
    daily_value_multiplier: 10000    // 1x
)

// Premium tier (1)
set_tier_limits(
    tier: 1,
    max_shares: 5000,
    max_value: 500000000000,
    daily_shares_multiplier: 15000,  // 1.5x
    daily_value_multiplier: 15000    // 1.5x
)

// Institutional tier (2)
set_tier_limits(
    tier: 2,
    max_shares: 0,              // Use global limit
    max_value: 0,               // Use global limit
    daily_shares_multiplier: 20000,  // 2x
    daily_value_multiplier: 20000    // 2x
)
```

## Monitoring and Analytics

### Key Events to Monitor

1. **`EventLimitViolation`**: Indicates users attempting to exceed limits
   - Monitor frequency to identify potential abuse or misconfiguration
   - Track which limit types are most commonly hit

2. **`EventPurchaseLimitConfigSet`**: Configuration changes
   - Audit trail for limit modifications

3. **`EventUserPurchaseReset`**: Admin interventions
   - Track when admins manually reset user limits

### Recommended Metrics

1. **Violation Rate**: Number of violations per total purchase attempts
2. **Limit Utilization**: Percentage of users approaching their limits
3. **Tier Distribution**: Purchase patterns across different tiers
4. **Time-based Patterns**: Purchase volume by time of day/week

## Future Enhancements

Potential improvements for future versions:

1. **Dynamic Limits**: Automatically adjust limits based on market conditions
2. **Graduated Limits**: Implement sliding scale limits based on holding duration
3. **Limit Governance**: DAO-based limit configuration
4. **Advanced Analytics**: More sophisticated purchase pattern analysis
5. **Cross-Contract Limits**: Limits spanning multiple contracts
6. **Temporary Limit Increases**: Time-limited limit boosts for special events

## Testing

See `PURCHASE_LIMITS_TESTS.md` for comprehensive test coverage including:

- Unit tests for individual limit types
- Integration tests for purchase functions
- Time-based limit reset tests
- Tier multiplier tests
- Exemption tests
- Edge case and error condition tests

## References

- Issue #274: Purchase Limits Implementation
- Issue #270: Whitelist Enhancements (tier system)
- Issue #268: Buyback Enhancement (oracle integration)
- Issue #310: Granular Pause Controls
- Issue #311: Emergency Stop Mechanism
