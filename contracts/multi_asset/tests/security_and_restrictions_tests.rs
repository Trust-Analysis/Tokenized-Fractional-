// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

//! Comprehensive integration test suite for `multi-asset-manager`.
//!
//! Prioritizes the critical bug classes identified in review:
//! 1. Reentrancy guard & Checks-Effects-Interactions (CEI) ordering (#934)
//! 2. Compliance & investment restriction enforcement (#935, #936)
//! 3. Circuit breaker, per-asset pause, and slippage safety controls (#937)
//! 4. Per-holder lockup accounting and timestamp-0 boundary behavior (#938)
//! 5. O(1) holder registry (`IsHolder`) & multi-asset lifecycle/reconstitution (#939, #943)

#![cfg(test)]

use multi_asset_manager::{
    AssetRestrictions, AssetStatus, AssetType, DataKey, MultiAssetManager,
    MultiAssetManagerClient, PricingModel,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token, Address, Env, IntoVal, String, Vec,
};

struct TestFixture {
    env: Env,
    admin: Address,
    treasury: Address,
    token: Address,
    contract_id: Address,
    curators: (Address, Address, Address),
}

fn setup() -> TestFixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register(MultiAssetManager, ());

    let client = MultiAssetManagerClient::new(&env, &contract_id);
    client.init(&admin);

    let c1 = Address::generate(&env);
    let c2 = Address::generate(&env);
    let c3 = Address::generate(&env);
    let mut curator_vec = Vec::new(&env);
    curator_vec.push_back(c1.clone());
    curator_vec.push_back(c2.clone());
    curator_vec.push_back(c3.clone());
    client.set_curators(&curator_vec);

    TestFixture {
        env,
        admin,
        treasury,
        token,
        contract_id,
        curators: (c1, c2, c3),
    }
}

fn client(f: &TestFixture) -> MultiAssetManagerClient<'_> {
    MultiAssetManagerClient::new(&f.env, &f.contract_id)
}

fn approvers(f: &TestFixture) -> Vec<Address> {
    let mut v = Vec::new(&f.env);
    v.push_back(f.curators.0.clone());
    v.push_back(f.curators.1.clone());
    v
}

fn mint_payment_tokens(env: &Env, token_addr: &Address, to: &Address, amount: i128) {
    token::StellarAssetClient::new(env, token_addr).mint(to, &amount);
}

fn token_balance(env: &Env, token_addr: &Address, owner: &Address) -> i128 {
    token::TokenClient::new(env, token_addr).balance(owner)
}

#[allow(clippy::too_many_arguments)]
fn register_and_activate(
    f: &TestFixture,
    name: &str,
    total_supply: u32,
    fixed_price: i128,
    requires_kyc: bool,
    requires_accreditation: bool,
    min_investment: u32,
    max_per_investor: u32,
    transfer_lockup_days: u32,
    restricted_jurisdictions: Vec<String>,
) -> u64 {
    let c = client(f);
    let id = c.register_asset(
        &String::from_str(&f.env, name),
        &AssetType::RealEstate,
        &String::from_str(&f.env, "ipfs://asset-meta"),
        &total_supply,
        &PricingModel::Fixed,
        &fixed_price,
        &f.token,
        &f.treasury,
        &approvers(f),
        &requires_kyc,
        &requires_accreditation,
        &min_investment,
        &max_per_investor,
        &transfer_lockup_days,
        &restricted_jurisdictions,
    );
    c.activate_asset(&id);
    id
}

fn register_unrestricted_active(f: &TestFixture, total_supply: u32, fixed_price: i128) -> u64 {
    register_and_activate(
        f,
        "Unrestricted Asset",
        total_supply,
        fixed_price,
        false,
        false,
        0,
        0,
        0,
        Vec::new(&f.env),
    )
}

fn set_kyc(f: &TestFixture, buyer: &Address, verified: bool) {
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::KYCVerified(buyer.clone()), &verified);
    });
}

fn set_accreditation(f: &TestFixture, buyer: &Address, accredited: bool) {
    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .persistent()
            .set(&DataKey::AccreditedInvestor(buyer.clone()), &accredited);
    });
}

fn set_jurisdiction(f: &TestFixture, buyer: &Address, code: &str) {
    f.env.as_contract(&f.contract_id, || {
        f.env.storage().persistent().set(
            &DataKey::BuyerJurisdiction(buyer.clone()),
            &String::from_str(&f.env, code),
        );
    });
}

// ============================================================================
// 1. Reentrancy Guard & Checks-Effects-Interactions (CEI) Tests (#934)
// ============================================================================

#[contracttype]
#[derive(Clone)]
enum MockTokenKey {
    Manager,
    AssetId,
    Buyer,
    AttackReenter,
    ReenterRejected,
    ObservedAvailableSupply,
    ObservedBuyerBalance,
    ObservedBuyCount,
    ObservedTotalHolders,
}

#[contract]
pub struct MockProbeToken;

#[contractimpl]
impl MockProbeToken {
    pub fn configure(
        env: Env,
        manager: Address,
        asset_id: u64,
        buyer: Address,
        attack_reenter: bool,
    ) {
        env.storage().instance().set(&MockTokenKey::Manager, &manager);
        env.storage().instance().set(&MockTokenKey::AssetId, &asset_id);
        env.storage().instance().set(&MockTokenKey::Buyer, &buyer);
        env.storage()
            .instance()
            .set(&MockTokenKey::AttackReenter, &attack_reenter);
        env.storage()
            .instance()
            .set(&MockTokenKey::ReenterRejected, &false);
    }

    pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
        let manager: Address = env.storage().instance().get(&MockTokenKey::Manager).unwrap();
        let asset_id: u64 = env.storage().instance().get(&MockTokenKey::AssetId).unwrap();
        let buyer: Address = env.storage().instance().get(&MockTokenKey::Buyer).unwrap();
        let attack_reenter: bool = env
            .storage()
            .instance()
            .get(&MockTokenKey::AttackReenter)
            .unwrap_or(false);

        let mgr = MultiAssetManagerClient::new(&env, &manager);

        // Snapshot manager state DURING external token transfer (Interaction phase).
        // Under strict CEI, Effects must already be committed here.
        let info = mgr.get_asset(&asset_id).unwrap();
        let bal = mgr.get_asset_balance(&asset_id, &buyer);
        let analytics = mgr.get_asset_analytics(&asset_id).unwrap();
        env.storage()
            .instance()
            .set(&MockTokenKey::ObservedAvailableSupply, &info.available_supply);
        env.storage()
            .instance()
            .set(&MockTokenKey::ObservedBuyerBalance, &bal);
        env.storage()
            .instance()
            .set(&MockTokenKey::ObservedBuyCount, &analytics.buy_count);
        env.storage()
            .instance()
            .set(&MockTokenKey::ObservedTotalHolders, &analytics.total_holders);

        if attack_reenter {
            let res = mgr.try_buy_asset_shares(&asset_id, &buyer, &1u32, &i128::MAX);
            env.storage()
                .instance()
                .set(&MockTokenKey::ReenterRejected, &res.is_err());
        }
    }

    pub fn was_reenter_rejected(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&MockTokenKey::ReenterRejected)
            .unwrap_or(false)
    }

    pub fn observed_state(env: Env) -> (u32, u32, u64, u32) {
        let avail = env
            .storage()
            .instance()
            .get(&MockTokenKey::ObservedAvailableSupply)
            .unwrap_or(u32::MAX);
        let bal = env
            .storage()
            .instance()
            .get(&MockTokenKey::ObservedBuyerBalance)
            .unwrap_or(0);
        let buys = env
            .storage()
            .instance()
            .get(&MockTokenKey::ObservedBuyCount)
            .unwrap_or(0);
        let holders = env
            .storage()
            .instance()
            .get(&MockTokenKey::ObservedTotalHolders)
            .unwrap_or(0);
        (avail, bal, buys, holders)
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn test_buy_asset_shares_blocks_when_reentrant_guard_set() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 1_000, 100);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::ReentrantGuard, &true);
    });

    client(&f).buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
}

#[test]
fn test_reentrancy_guard_released_after_successful_purchase() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 1_000, 100);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 20_000);

    let c = client(&f);
    c.buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);

    f.env.as_contract(&f.contract_id, || {
        let guard: bool = f
            .env
            .storage()
            .instance()
            .get(&DataKey::ReentrantGuard)
            .unwrap_or(true);
        assert!(!guard, "ReentrantGuard must be false after purchase");
    });

    // Subsequent legitimate purchase must succeed.
    c.buy_asset_shares(&asset_id, &buyer, &5, &i128::MAX);
    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 15);
}

#[test]
fn test_live_cross_contract_reentrancy_is_blocked_and_cei_effects_precede_transfer() {
    let f = setup();
    let buyer = Address::generate(&f.env);
    let probe_token_id = f.env.register(MockProbeToken, ());
    let probe_client = MockProbeTokenClient::new(&f.env, &probe_token_id);

    let c = client(&f);
    let asset_id = c.register_asset(
        &String::from_str(&f.env, "CEI Probe Asset"),
        &AssetType::Equity,
        &String::from_str(&f.env, "ipfs://cei"),
        &500u32,
        &PricingModel::Fixed,
        &25i128,
        &probe_token_id,
        &f.treasury,
        &approvers(&f),
        &false,
        &false,
        &0u32,
        &0u32,
        &0u32,
        &Vec::new(&f.env),
    );
    c.activate_asset(&asset_id);

    probe_client.configure(&f.contract_id, &asset_id, &buyer, &true);

    c.buy_asset_shares(&asset_id, &buyer, &40, &i128::MAX);

    // 1. Reentrant call inside token::transfer must have been rejected.
    assert!(
        probe_client.was_reenter_rejected(),
        "Reentrant buy_asset_shares inside external transfer must fail"
    );

    // 2. Effects must already have been committed BEFORE external transfer ran.
    let (avail_during, bal_during, buys_during, holders_during) = probe_client.observed_state();
    assert_eq!(avail_during, 460);
    assert_eq!(bal_during, 40);
    assert_eq!(buys_during, 1);
    assert_eq!(holders_during, 1);

    // 3. Final state remains intact (only the outer 40-share buy applied).
    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 40);
    assert_eq!(c.get_asset(&asset_id).unwrap().available_supply, 460);
    f.env.as_contract(&f.contract_id, || {
        assert!(!f
            .env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::ReentrantGuard)
            .unwrap_or(true));
    });
}

#[test]
fn test_failed_purchase_does_not_leave_reentrancy_guard_locked() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 100, 50);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    let c = client(&f);
    // Attempt to buy more than available supply -> fails
    let res = c.try_buy_asset_shares(&asset_id, &buyer, &101, &i128::MAX);
    assert!(res.is_err());

    // Subsequent valid purchase must not hit ReentrantCall
    c.buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 10);
}

// ============================================================================
// 2. Restriction Enforcement Tests (#935, #936)
// ============================================================================

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn test_restriction_kyc_rejects_unverified_buyer() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "KYC Asset",
        1_000,
        100,
        true,
        false,
        0,
        0,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    client(&f).buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
}

#[test]
fn test_restriction_kyc_allows_verified_buyer() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "KYC Asset",
        1_000,
        100,
        true,
        false,
        0,
        0,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);
    set_kyc(&f, &buyer, true);

    client(&f).buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
    assert_eq!(client(&f).get_asset_balance(&asset_id, &buyer), 10);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_restriction_accreditation_rejects_non_accredited_buyer() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "Accredited Asset",
        1_000,
        100,
        false,
        true,
        0,
        0,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    client(&f).buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
}

#[test]
fn test_restriction_accreditation_allows_accredited_buyer() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "Accredited Asset",
        1_000,
        100,
        false,
        true,
        0,
        0,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);
    set_accreditation(&f, &buyer, true);

    client(&f).buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
    assert_eq!(client(&f).get_asset_balance(&asset_id, &buyer), 10);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_restriction_min_investment_rejects_below_minimum() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "MinInv Asset",
        1_000,
        10,
        false,
        false,
        25,
        0,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    client(&f).buy_asset_shares(&asset_id, &buyer, &24, &i128::MAX);
}

#[test]
fn test_restriction_min_investment_allows_exact_minimum() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "MinInv Asset",
        1_000,
        10,
        false,
        false,
        25,
        0,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    client(&f).buy_asset_shares(&asset_id, &buyer, &25, &i128::MAX);
    assert_eq!(client(&f).get_asset_balance(&asset_id, &buyer), 25);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_restriction_max_per_investor_rejects_cumulative_excess() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "MaxCap Asset",
        1_000,
        10,
        false,
        false,
        0,
        100,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 100_000);

    let c = client(&f);
    c.buy_asset_shares(&asset_id, &buyer, &60, &i128::MAX);
    // Cumulative 60 + 41 = 101 > 100 must fail
    c.buy_asset_shares(&asset_id, &buyer, &41, &i128::MAX);
}

#[test]
fn test_restriction_max_per_investor_allows_exact_cap() {
    let f = setup();
    let asset_id = register_and_activate(
        &f,
        "MaxCap Asset",
        1_000,
        10,
        false,
        false,
        0,
        100,
        0,
        Vec::new(&f.env),
    );
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 100_000);

    let c = client(&f);
    c.buy_asset_shares(&asset_id, &buyer, &60, &i128::MAX);
    c.buy_asset_shares(&asset_id, &buyer, &40, &i128::MAX);
    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn test_restriction_jurisdiction_rejects_missing_jurisdiction() {
    let f = setup();
    let mut blocked = Vec::new(&f.env);
    blocked.push_back(String::from_str(&f.env, "KP"));
    let asset_id = register_and_activate(&f, "Geo Asset", 1_000, 10, false, false, 0, 0, 0, blocked);

    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    // Buyer has no BuyerJurisdiction entry -> must be rejected
    client(&f).buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn test_restriction_jurisdiction_rejects_blocked_country() {
    let f = setup();
    let mut blocked = Vec::new(&f.env);
    blocked.push_back(String::from_str(&f.env, "KP"));
    blocked.push_back(String::from_str(&f.env, "IR"));
    let asset_id = register_and_activate(&f, "Geo Asset", 1_000, 10, false, false, 0, 0, 0, blocked);

    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);
    set_jurisdiction(&f, &buyer, "IR");

    client(&f).buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
}

#[test]
fn test_restriction_jurisdiction_allows_permitted_country_and_dynamic_update() {
    let f = setup();
    let mut blocked = Vec::new(&f.env);
    blocked.push_back(String::from_str(&f.env, "KP"));
    let asset_id = register_and_activate(
        &f,
        "Geo Asset",
        1_000,
        10,
        true,
        true,
        5,
        50,
        0,
        blocked,
    );

    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 100_000);
    set_kyc(&f, &buyer, true);
    set_accreditation(&f, &buyer, true);
    set_jurisdiction(&f, &buyer, "NG");

    let c = client(&f);
    c.buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 10);

    // Admin updates restrictions to also block "NG"
    let mut updated_blocked = Vec::new(&f.env);
    updated_blocked.push_back(String::from_str(&f.env, "NG"));
    c.update_asset_restrictions(
        &asset_id,
        &AssetRestrictions {
            requires_kyc: true,
            min_investment: 5,
            max_per_investor: 50,
            restricted_jurisdictions: updated_blocked,
            transfer_lockup_days: 0,
            requires_accreditation: true,
        },
    );

    let res = c.try_buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
    assert!(res.is_err());
}

// ============================================================================
// 3. Safety Controls & Slippage Protection Tests (#937)
// ============================================================================

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_circuit_breaker_blocks_purchases() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 1_000, 100);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::CircuitBreakerTriggered, &true);
    });

    client(&f).buy_asset_shares(&asset_id, &buyer, &5, &i128::MAX);
}

#[test]
fn test_asset_pause_blocks_only_paused_asset() {
    let f = setup();
    let asset1 = register_unrestricted_active(&f, 1_000, 100);
    let asset2 = register_unrestricted_active(&f, 1_000, 100);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 50_000);

    f.env.as_contract(&f.contract_id, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::AssetPause(asset1), &true);
    });

    let c = client(&f);
    assert!(c.try_buy_asset_shares(&asset1, &buyer, &5, &i128::MAX).is_err());
    c.buy_asset_shares(&asset2, &buyer, &5, &i128::MAX);
    assert_eq!(c.get_asset_balance(&asset2, &buyer), 5);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn test_slippage_protection_rejects_above_max_price() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 1_000, 105);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    client(&f).buy_asset_shares(&asset_id, &buyer, &5, &104i128);
}

#[test]
fn test_slippage_protection_allows_exact_max_price() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 1_000, 105);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    client(&f).buy_asset_shares(&asset_id, &buyer, &4, &105i128);
    assert_eq!(client(&f).get_asset_balance(&asset_id, &buyer), 4);
    assert_eq!(token_balance(&f.env, &f.token, &f.treasury), 420);
}

// ============================================================================
// 4. Per-Holder Lockup Accounting Tests (#938)
// ============================================================================

#[test]
fn test_lockup_blocks_before_expiry_including_timestamp_zero_and_allows_at_boundary() {
    let f = setup();
    // Ledger starts at timestamp = 0 by default in Env::default().
    let lockup_days = 7u32;
    let lockup_secs = (lockup_days as u64) * 86_400;
    let asset_id = register_and_activate(
        &f,
        "Locked Asset",
        1_000,
        10,
        false,
        false,
        0,
        0,
        lockup_days,
        Vec::new(&f.env),
    );

    let buyer = Address::generate(&f.env);
    let recipient = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    let c = client(&f);
    c.buy_asset_shares(&asset_id, &buyer, &100, &i128::MAX);

    // Even when acquired at t=0, transfer must be blocked during lockup window
    assert!(c.try_transfer_asset_shares(&asset_id, &buyer, &recipient, &10).is_err());

    // 1 second before unlock must still fail
    f.env.ledger().set_timestamp(lockup_secs - 1);
    assert!(c.try_transfer_asset_shares(&asset_id, &buyer, &recipient, &10).is_err());

    // At exact unlock timestamp, transfer succeeds
    f.env.ledger().set_timestamp(lockup_secs);
    c.transfer_asset_shares(&asset_id, &buyer, &recipient, &25);
    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 75);
    assert_eq!(c.get_asset_balance(&asset_id, &recipient), 25);
}

#[test]
fn test_lockup_is_per_holder_and_subsequent_buyers_do_not_relock_earlier_holders() {
    let f = setup();
    let lockup_days = 10u32;
    let day = 86_400u64;
    let asset_id = register_and_activate(
        &f,
        "Per-Holder Lockup Asset",
        1_000,
        10,
        false,
        false,
        0,
        0,
        lockup_days,
        Vec::new(&f.env),
    );

    let buyer_a = Address::generate(&f.env);
    let buyer_b = Address::generate(&f.env);
    let recipient = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer_a, 10_000);
    mint_payment_tokens(&f.env, &f.token, &buyer_b, 10_000);

    let c = client(&f);

    // Buyer A buys at t = 1_000
    f.env.ledger().set_timestamp(1_000);
    c.buy_asset_shares(&asset_id, &buyer_a, &50, &i128::MAX);

    // Buyer B buys 6 days later at t = 1_000 + 6 * day (updates asset-wide last_trade_at!)
    f.env.ledger().set_timestamp(1_000 + 6 * day);
    c.buy_asset_shares(&asset_id, &buyer_b, &50, &i128::MAX);

    // At t = 1_000 + 10 * day: Buyer A's 10-day lockup has expired (even though Buyer B
    // bought only 4 days ago), while Buyer B is still locked for 6 more days.
    f.env.ledger().set_timestamp(1_000 + 10 * day);
    c.transfer_asset_shares(&asset_id, &buyer_a, &recipient, &20);
    assert_eq!(c.get_asset_balance(&asset_id, &buyer_a), 30);
    assert_eq!(c.get_asset_balance(&asset_id, &recipient), 20);

    // Buyer B must STILL be blocked
    assert!(c.try_transfer_asset_shares(&asset_id, &buyer_b, &recipient, &20).is_err());

    // Once Buyer B's 10-day window passes (t = 1_000 + 16 * day), Buyer B can transfer
    f.env.ledger().set_timestamp(1_000 + 16 * day);
    c.transfer_asset_shares(&asset_id, &buyer_b, &recipient, &20);
    assert_eq!(c.get_asset_balance(&asset_id, &buyer_b), 30);
    assert_eq!(c.get_asset_balance(&asset_id, &recipient), 40);
}

// ============================================================================
// 5. Holder Registry O(1), Burn Compensation, Auth, & Conservation Invariants
// ============================================================================

#[test]
fn test_repeat_purchases_do_not_duplicate_holders_or_inflate_holder_count() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 1_000, 10);
    let buyer = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &buyer, 10_000);

    let c = client(&f);
    for _ in 0..5 {
        c.buy_asset_shares(&asset_id, &buyer, &10, &i128::MAX);
    }

    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 50);
    let analytics = c.get_asset_analytics(&asset_id).unwrap();
    assert_eq!(analytics.total_holders, 1);
    assert_eq!(analytics.buy_count, 5);
    assert_eq!(analytics.total_volume, 500);

    f.env.as_contract(&f.contract_id, || {
        let holders: Vec<Address> = f
            .env
            .storage()
            .persistent()
            .get(&DataKey::AssetHolders(asset_id))
            .unwrap();
        assert_eq!(holders.len(), 1);
        let is_holder: bool = f
            .env
            .storage()
            .persistent()
            .get(&DataKey::IsHolder(asset_id, buyer.clone()))
            .unwrap_or(false);
        assert!(is_holder);
    });
}

#[test]
fn test_burn_and_reconstitute_records_compensation_and_prevents_reuse() {
    let f = setup();
    let asset_id = register_unrestricted_active(&f, 200, 75);
    let owner = Address::generate(&f.env);
    mint_payment_tokens(&f.env, &f.token, &owner, 20_000);

    let c = client(&f);
    assert_eq!(c.get_reconstitution_compensation(&asset_id, &owner), 0);

    f.env.ledger().set_timestamp(55_555);
    c.buy_asset_shares(&asset_id, &owner, &200, &i128::MAX);
    c.burn_and_reconstitute(&asset_id, &owner);

    // Valuation = 200 * 75 = 15_000 recorded on-chain
    assert_eq!(c.get_reconstitution_compensation(&asset_id, &owner), 15_000);
    assert_eq!(c.get_asset_balance(&asset_id, &owner), 0);

    let info = c.get_asset(&asset_id).unwrap();
    assert_eq!(info.status, AssetStatus::Archived);
    assert_eq!(info.total_supply, 0);
    assert_eq!(info.available_supply, 0);

    // Subsequent buy, transfer, or second burn on archived asset must fail
    assert!(c.try_buy_asset_shares(&asset_id, &owner, &1, &i128::MAX).is_err());
    assert!(c.try_burn_and_reconstitute(&asset_id, &owner).is_err());
}

#[test]
fn test_non_admin_cannot_perform_admin_actions() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let outsider = Address::generate(&env);
    let contract_id = env.register(MultiAssetManager, ());
    let client = MultiAssetManagerClient::new(&env, &contract_id);

    // Authorized init as admin
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (admin.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&admin);

    // Outsider tries to set oracle -> must fail without admin auth
    env.mock_auths(&[MockAuth {
        address: &outsider,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_oracle",
            args: (outsider.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = client.try_set_oracle(&outsider);
    assert!(res.is_err());
}

#[test]
fn test_randomized_share_conservation_invariant() {
    // Deterministic PRNG sequence exercising buys and transfers across multiple
    // investors, verifying share conservation:
    // available_supply + sum(all holder balances) == total_supply.
    let f = setup();
    let total_supply = 1_000u32;
    let asset_id = register_unrestricted_active(&f, total_supply, 10);
    let c = client(&f);

    let mut investors = std::vec::Vec::new();
    for _ in 0..8 {
        let inv = Address::generate(&f.env);
        mint_payment_tokens(&f.env, &f.token, &inv, 1_000_000);
        investors.push(inv);
    }

    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
    let next_u64 = |s: &mut u64| -> u64 {
        *s ^= *s << 13;
        *s ^= *s >> 7;
        *s ^= *s << 17;
        *s
    };

    for step in 0..60u32 {
        let r = next_u64(&mut seed);
        let idx_a = (r as usize) % investors.len();
        let idx_b = ((r >> 8) as usize) % investors.len();
        let amount = ((r >> 16) as u32 % 40) + 1;

        if step % 3 != 2 {
            let _ = c.try_buy_asset_shares(&asset_id, &investors[idx_a], &amount, &i128::MAX);
        } else if idx_a != idx_b {
            let _ = c.try_transfer_asset_shares(
                &asset_id,
                &investors[idx_a],
                &investors[idx_b],
                &amount,
            );
        }

        let info = c.get_asset(&asset_id).unwrap();
        let held: u32 = investors
            .iter()
            .map(|inv| c.get_asset_balance(&asset_id, inv))
            .sum();
        assert_eq!(
            info.available_supply + held,
            info.total_supply,
            "Share conservation violated at step {}",
            step
        );
    }
}

#[test]
fn test_listing_pagination_and_edge_cases() {
    let f = setup();
    let c = client(&f);

    for i in 1..=5u32 {
        let id = register_unrestricted_active(&f, 100 * i, 10);
        if i % 2 == 0 {
            c.deactivate_asset(&id);
        }
    }

    let page1 = c.list_assets(&0, &2);
    let page2 = c.list_assets(&2, &2);
    let page3 = c.list_assets(&4, &2);
    assert_eq!(page1.len(), 2);
    assert_eq!(page2.len(), 2);
    assert_eq!(page3.len(), 1);
    assert_eq!(page1.get(0).unwrap().asset_id, 1);
    assert_eq!(page3.get(0).unwrap().asset_id, 5);

    let paused = c.list_assets_by_status(&AssetStatus::Paused, &0, &10);
    assert_eq!(paused.len(), 2);
    let active_skip = c.list_assets_by_status(&AssetStatus::Active, &1, &2);
    assert_eq!(active_skip.len(), 2);
    assert_eq!(active_skip.get(0).unwrap().asset_id, 3);
}
