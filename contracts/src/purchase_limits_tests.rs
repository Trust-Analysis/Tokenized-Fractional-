// Purchase Limits Tests for Issue #274
// This module contains comprehensive tests for the purchase limits implementation

#![cfg(test)]

use soroban_sdk::testutils::{Ledger, LedgerInfo};
use soroban_sdk::{Address, Env};

// Helper function to setup test environment
fn setup_test_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

// Helper function to initialize the contract
fn initialize_contract(env: &Env, admin: &Address, payment_token: &Address) {
    // This would call the contract's init function
    // For testing purposes, we'll set up the necessary storage directly
    env.storage().instance().set(&super::DataKey::Admin, admin);
    env.storage().instance().set(&DataKey::PaymentToken, payment_token);
    env.storage().instance().set(&DataKey::PricePerShare, &100i128); // 100 tokens per share
    env.storage().instance().set(&DataKey::TotalShares, &10000u32);
    env.storage().instance().set(&DataKey::AvailableShares, &10000u32);
}

#[test]
fn test_purchase_limit_config_set() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set purchase limits
    super::set_purchase_limits(
        env.clone(),
        1000u32,           // max_shares
        100000i128,        // max_value
        100u32,            // daily_shares
        10000i128,         // daily_value
        500u32,            // weekly_shares
        50000i128,         // weekly_value
        1000u32,           // monthly_shares
        100000i128,        // monthly_value
        true,              // enabled
    );
    
    // Verify limits were set
    let config = super::get_purchase_limits(env.clone());
    assert_eq!(config.max_shares_per_user, 1000);
    assert_eq!(config.max_value_per_user, 100000);
    assert_eq!(config.daily_shares_limit, 100);
    assert_eq!(config.daily_value_limit, 10000);
    assert_eq!(config.weekly_shares_limit, 500);
    assert_eq!(config.weekly_value_limit, 50000);
    assert_eq!(config.monthly_shares_limit, 1000);
    assert_eq!(config.monthly_value_limit, 100000);
    assert_eq!(config.enabled, true);
}

#[test]
fn test_purchase_limits_disabled_by_default() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Get default limits (should be disabled)
    let config = super::get_purchase_limits(env.clone());
    assert_eq!(config.enabled, false);
    assert_eq!(config.max_shares_per_user, 0);
    assert_eq!(config.max_value_per_user, 0);
}

#[test]
fn test_enable_disable_limits() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Enable limits
    super::set_purchase_limits_enabled(env.clone(), true);
    let config = super::get_purchase_limits(env.clone());
    assert_eq!(config.enabled, true);
    
    // Disable limits
    super::set_purchase_limits_enabled(env.clone(), false);
    let config = super::get_purchase_limits(env.clone());
    assert_eq!(config.enabled, false);
}

#[test]
fn test_tier_limits_configuration() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set tier 0 limits
    super::set_tier_limits(
        env.clone(),
        0u32,              // tier
        1000u32,           // max_shares
        100000i128,        // max_value
        10000u32,          // daily_shares_multiplier (1x)
        10000u32,          // daily_value_multiplier (1x)
    );
    
    let tier_limits = super::get_tier_limits(env.clone(), 0u32);
    assert_eq!(tier_limits.max_shares, 1000);
    assert_eq!(tier_limits.max_value, 100000);
    assert_eq!(tier_limits.daily_shares_multiplier, 10000);
    assert_eq!(tier_limits.daily_value_multiplier, 10000);
    
    // Set tier 1 limits with multipliers
    super::set_tier_limits(
        env.clone(),
        1u32,              // tier
        5000u32,           // max_shares
        500000i128,        // max_value
        15000u32,          // daily_shares_multiplier (1.5x)
        15000u32,          // daily_value_multiplier (1.5x)
    );
    
    let tier_limits = super::get_tier_limits(env.clone(), 1u32);
    assert_eq!(tier_limits.max_shares, 5000);
    assert_eq!(tier_limits.max_value, 500000);
    assert_eq!(tier_limits.daily_shares_multiplier, 15000);
    assert_eq!(tier_limits.daily_value_multiplier, 15000);
}

#[test]
fn test_limit_exemption() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let exempt_user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // User should not be exempt by default
    assert_eq!(super::is_limit_exempt(env.clone(), exempt_user.clone()), false);
    
    // Set exemption
    super::set_limit_exempt(env.clone(), exempt_user.clone(), true);
    assert_eq!(super::is_limit_exempt(env.clone(), exempt_user.clone()), true);
    
    // Remove exemption
    super::set_limit_exempt(env.clone(), exempt_user.clone(), false);
    assert_eq!(super::is_limit_exempt(env.clone(), exempt_user.clone()), false);
}

#[test]
fn test_max_shares_limit_validation() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up limits
    super::set_purchase_limits(
        env.clone(),
        100u32,            // max_shares
        0i128,             // max_value (no limit)
        0u32,              // daily_shares (no limit)
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Set user's current balance to 90 shares
    env.storage().persistent().set(&DataKey::Balance(user.clone()), &90u32);
    
    // Attempt to purchase 20 shares (would exceed limit of 100)
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 20u32, 2000i128);
    });
    
    assert!(result.is_err(), "Should panic when exceeding max shares limit");
    
    // Purchase 10 shares (should succeed)
    let history = super::_validate_purchase_limits(&env, &user, 10u32, 1000i128);
    assert_eq!(history.last_purchase_time > 0, true);
}

#[test]
fn test_max_value_limit_validation() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up limits
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        50000i128,         // max_value
        0u32,              // daily_shares (no limit)
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Set user's current balance to 400 shares worth 40000
    env.storage().persistent().set(&DataKey::Balance(user.clone()), &400u32);
    
    // Attempt to purchase 200 shares worth 20000 (would exceed limit of 50000)
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 200u32, 20000i128);
    });
    
    assert!(result.is_err(), "Should panic when exceeding max value limit");
    
    // Purchase 50 shares worth 5000 (should succeed)
    let history = super::_validate_purchase_limits(&env, &user, 50u32, 5000i128);
    assert_eq!(history.last_purchase_time > 0, true);
}

#[test]
fn test_daily_shares_limit() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up daily limit
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        50u32,             // daily_shares
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // First purchase of 30 shares
    let history1 = super::_validate_purchase_limits(&env, &user, 30u32, 3000i128);
    assert_eq!(history1.daily_shares, 30);
    
    // Update history
    super::_update_purchase_history(&env, &user, history1);
    
    // Second purchase of 25 shares (would exceed daily limit of 50)
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 25u32, 2500i128);
    });
    
    assert!(result.is_err(), "Should panic when exceeding daily shares limit");
    
    // Purchase 20 shares (should succeed, total 50)
    let history2 = super::_validate_purchase_limits(&env, &user, 20u32, 2000i128);
    assert_eq!(history2.daily_shares, 50);
}

#[test]
fn test_daily_limit_reset() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up daily limit
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        50u32,             // daily_shares
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Purchase 50 shares (max daily limit)
    let history1 = super::_validate_purchase_limits(&env, &user, 50u32, 5000i128);
    super::_update_purchase_history(&env, &user, history1);
    
    // Attempt another purchase (should fail)
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 1u32, 100i128);
    });
    assert!(result.is_err());
    
    // Advance time by 1 day
    env.ledger().set(LedgerInfo {
        timestamp: 86400, // 1 day later
        protocol_version: 1,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 100,
        min_temp_entry_expiration: 100,
        max_temp_entry_expiration: 10000,
    });
    
    // Purchase should now succeed (daily counter reset)
    let history2 = super::_validate_purchase_limits(&env, &user, 30u32, 3000i128);
    assert_eq!(history2.daily_shares, 30);
}

#[test]
fn test_weekly_limits() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up weekly limit
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        0u32,              // daily_shares (no limit)
        0i128,             // daily_value (no limit)
        200u32,            // weekly_shares
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Purchase 150 shares
    let history1 = super::_validate_purchase_limits(&env, &user, 150u32, 15000i128);
    assert_eq!(history1.weekly_shares, 150);
    super::_update_purchase_history(&env, &user, history1);
    
    // Attempt to purchase 100 more (would exceed weekly limit of 200)
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 100u32, 10000i128);
    });
    assert!(result.is_err());
    
    // Purchase 50 shares (should succeed)
    let history2 = super::_validate_purchase_limits(&env, &user, 50u32, 5000i128);
    assert_eq!(history2.weekly_shares, 200);
}

#[test]
fn test_monthly_limits() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up monthly limit
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        0u32,              // daily_shares (no limit)
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        1000u32,           // monthly_shares
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Purchase 800 shares
    let history1 = super::_validate_purchase_limits(&env, &user, 800u32, 80000i128);
    assert_eq!(history1.monthly_shares, 800);
    super::_update_purchase_history(&env, &user, history1);
    
    // Attempt to purchase 300 more (would exceed monthly limit of 1000)
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 300u32, 30000i128);
    });
    assert!(result.is_err());
    
    // Purchase 200 shares (should succeed)
    let history2 = super::_validate_purchase_limits(&env, &user, 200u32, 20000i128);
    assert_eq!(history2.monthly_shares, 1000);
}

#[test]
fn test_tier_multiplier_application() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let premium_user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up global daily limit
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        100u32,            // daily_shares
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Set user as premium tier
    env.storage().persistent().set(&DataKey::WhitelistTier(premium_user.clone()), &1u32);
    
    // Set premium tier with 2x multiplier
    super::set_tier_limits(
        env.clone(),
        1u32,              // tier
        0u32,              // max_shares (use global)
        0i128,             // max_value (use global)
        20000u32,          // daily_shares_multiplier (2x)
        10000u32,          // daily_value_multiplier (1x)
    );
    
    // Premium user should be able to purchase 200 shares (2x global limit)
    let history = super::_validate_purchase_limits(&env, &premium_user, 200u32, 20000i128);
    assert_eq!(history.daily_shares, 200);
    
    // But not 201 shares
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &premium_user, 201u32, 20100i128);
    });
    assert!(result.is_err());
}

#[test]
fn test_exemption_bypasses_all_limits() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let exempt_user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up strict limits
    super::set_purchase_limits(
        env.clone(),
        10u32,             // max_shares
        1000i128,          // max_value
        5u32,              // daily_shares
        500i128,           // daily_value
        20u32,             // weekly_shares
        2000i128,          // weekly_value
        50u32,             // monthly_shares
        5000i128,          // monthly_value
        true,              // enabled
    );
    
    // Set user as exempt
    super::set_limit_exempt(env.clone(), exempt_user.clone(), true);
    
    // Exempt user should be able to purchase any amount
    let history = super::_validate_purchase_limits(&env, &exempt_user, 1000u32, 100000i128);
    assert_eq!(history.last_purchase_time > 0, true);
}

#[test]
fn test_violation_counter() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up strict limit
    super::set_purchase_limits(
        env.clone(),
        50u32,             // max_shares
        0i128,             // max_value (no limit)
        0u32,              // daily_shares (no limit)
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Set user's current balance to 40 shares
    env.storage().persistent().set(&DataKey::Balance(user.clone()), &40u32);
    
    // Attempt to exceed limit (should increment violation counter)
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 20u32, 2000i128);
    });
    assert!(result.is_err());
    
    // Check violation counter
    let violations = super::get_limit_violations(env.clone(), user.clone());
    assert_eq!(violations, 1);
    
    // Another violation
    let result = std::panic::catch_unwind(|| {
        super::_validate_purchase_limits(&env, &user, 15u32, 1500i128);
    });
    assert!(result.is_err());
    
    // Check violation counter incremented
    let violations = super::get_limit_violations(env.clone(), user.clone());
    assert_eq!(violations, 2);
}

#[test]
fn test_admin_reset_user_limits() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up daily limit
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        50u32,             // daily_shares
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // Purchase 50 shares (max daily limit)
    let history1 = super::_validate_purchase_limits(&env, &user, 50u32, 5000i128);
    super::_update_purchase_history(&env, &user, history1);
    
    // Admin resets daily limit
    super::reset_user_purchase_limits(env.clone(), user.clone(), 1u32); // 1 = daily
    
    // User should now be able to purchase again
    let history2 = super::_validate_purchase_limits(&env, &user, 30u32, 3000i128);
    assert_eq!(history2.daily_shares, 30);
}

#[test]
fn test_limits_disabled_allows_unlimited_purchases() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up limits but keep them disabled
    super::set_purchase_limits(
        env.clone(),
        10u32,             // max_shares
        1000i128,          // max_value
        5u32,              // daily_shares
        500i128,           // daily_value
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        false,             // disabled
    );
    
    // User should be able to purchase any amount when limits are disabled
    let history = super::_validate_purchase_limits(&env, &user, 1000u32, 100000i128);
    assert_eq!(history.last_purchase_time > 0, true);
}

#[test]
fn test_zero_limit_means_no_limit() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up limits with zeros (no limits)
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        0u32,              // daily_shares (no limit)
        0i128,             // daily_value (no limit)
        0u32,              // weekly_shares (no limit)
        0i128,             // weekly_value (no limit)
        0u32,              // monthly_shares (no limit)
        0i128,             // monthly_value (no limit)
        true,              // enabled
    );
    
    // User should be able to purchase any amount
    let history = super::_validate_purchase_limits(&env, &user, 10000u32, 1000000i128);
    assert_eq!(history.last_purchase_time > 0, true);
}

#[test]
fn test_purchase_history_tracking() {
    let env = setup_test_env();
    let admin = Address::generate(&env");
    let payment_token = Address::generate(&env");
    let user = Address::generate(&env");
    
    initialize_contract(&env, &admin, &payment_token);
    
    // Set up limits
    super::set_purchase_limits(
        env.clone(),
        0u32,              // max_shares (no limit)
        0i128,             // max_value (no limit)
        100u32,            // daily_shares
        10000i128,         // daily_value
        500u32,            // weekly_shares
        50000i128,         // weekly_value
        1000u32,           // monthly_shares
        100000i128,        // monthly_value
        true,              // enabled
    );
    
    // Make multiple purchases
    let history1 = super::_validate_purchase_limits(&env, &user, 30u32, 3000i128);
    super::_update_purchase_history(&env, &user, history1);
    
    let history2 = super::_validate_purchase_limits(&env, &user, 20u32, 2000i128);
    super::_update_purchase_history(&env, &user, history2);
    
    let history3 = super::_validate_purchase_limits(&env, &user, 10u32, 1000i128);
    super::_update_purchase_history(&env, &user, history3);
    
    // Check accumulated history
    let final_history = super::get_user_purchase_history(env.clone(), user.clone());
    assert_eq!(final_history.daily_shares, 60);
    assert_eq!(final_history.daily_value, 6000);
    assert_eq!(final_history.weekly_shares, 60);
    assert_eq!(final_history.weekly_value, 6000);
    assert_eq!(final_history.monthly_shares, 60);
    assert_eq!(final_history.monthly_value, 6000);
}
