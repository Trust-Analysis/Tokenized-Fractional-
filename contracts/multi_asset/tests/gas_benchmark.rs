// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

//! Gas and resource benchmarks for `multi-asset-manager`.
//!
//! Mirrors `contracts/tests/gas_benchmark.rs` and
//! `contracts/tests/resource_benchmarks.rs`.
//!
//! Benchmarks `buy_asset_shares` (first-time vs repeat holder purchase, O(1)
//! `IsHolder` scaling across holder counts), `transfer_asset_shares`,
//! `burn_and_reconstitute`, and multi-asset listing/status scans.
//!
//! Note: `contracts/multi_asset` does not currently implement a
//! `distribute_dividends` or `deposit_distribution` entry point; when
//! distribution support is added to `MultiAssetManager`, add its
//! holder-scaling benchmark alongside the benchmarks below.
//!
//! Run with:
//! `cargo test --package multi-asset-manager --test gas_benchmark -- --nocapture`

#![cfg(test)]

use multi_asset_manager::{
    AssetStatus, AssetType, MultiAssetManager, MultiAssetManagerClient, PricingModel,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String, Vec,
};

struct BenchFixture {
    env: Env,
    admin: Address,
    treasury: Address,
    token: Address,
    contract_id: Address,
    approvers: Vec<Address>,
}

fn fixture() -> BenchFixture {
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
    let mut curators = Vec::new(&env);
    curators.push_back(c1.clone());
    curators.push_back(c2.clone());
    curators.push_back(c3);
    client.set_curators(&curators);

    let mut approvers = Vec::new(&env);
    approvers.push_back(c1);
    approvers.push_back(c2);

    BenchFixture {
        env,
        admin,
        treasury,
        token,
        contract_id,
        approvers,
    }
}

fn mint(f: &BenchFixture, to: &Address, amount: i128) {
    token::StellarAssetClient::new(&f.env, &f.token).mint(to, &amount);
}

fn register_active_asset(
    f: &BenchFixture,
    total_supply: u32,
    fixed_price: i128,
    lockup_days: u32,
) -> u64 {
    let c = MultiAssetManagerClient::new(&f.env, &f.contract_id);
    let id = c.register_asset(
        &String::from_str(&f.env, "Benchmark Asset"),
        &AssetType::RealEstate,
        &String::from_str(&f.env, "ipfs://bench"),
        &total_supply,
        &PricingModel::Fixed,
        &fixed_price,
        &f.token,
        &f.treasury,
        &f.approvers,
        &false,
        &false,
        &0u32,
        &0u32,
        &lockup_days,
        &Vec::new(&f.env),
    );
    c.activate_asset(&id);
    id
}

#[test]
fn benchmark_buy_asset_shares_first_vs_repeat_purchase() {
    let f = fixture();
    let asset_id = register_active_asset(&f, 10_000, 100, 0);
    let buyer = Address::generate(&f.env);
    mint(&f, &buyer, 1_000_000);
    let c = MultiAssetManagerClient::new(&f.env, &f.contract_id);

    // First purchase registers IsHolder, AssetHolders, and AcquiredAt
    let start_first = f.env.budget().cpu_instruction_cost();
    c.buy_asset_shares(&asset_id, &buyer, &100, &i128::MAX);
    let first_cpu = f.env.budget().cpu_instruction_cost() - start_first;

    // Repeat purchase short-circuits via O(1) IsHolder flag
    let start_repeat = f.env.budget().cpu_instruction_cost();
    c.buy_asset_shares(&asset_id, &buyer, &100, &i128::MAX);
    let repeat_cpu = f.env.budget().cpu_instruction_cost() - start_repeat;

    let savings = first_cpu.saturating_sub(repeat_cpu);
    let savings_pct = if first_cpu > 0 {
        (savings as f64 / first_cpu as f64) * 100.0
    } else {
        0.0
    };

    println!("First buy_asset_shares cost (new holder): {}", first_cpu);
    println!("Repeat buy_asset_shares cost (existing holder): {}", repeat_cpu);
    println!("Repeat-buy savings: {} ({:.2}%)", savings, savings_pct);
    println!("BENCHMARK name=buy_asset_shares_first shares=100 cpu={}", first_cpu);
    println!("BENCHMARK name=buy_asset_shares_repeat shares=100 cpu={}", repeat_cpu);

    assert_eq!(c.get_asset_balance(&asset_id, &buyer), 200);
    assert!(
        repeat_cpu < first_cpu,
        "Repeat buy should consume less CPU than first-time holder registration"
    );
}

#[test]
fn benchmark_buy_asset_shares_repeat_buy_scales_o1_with_holders() {
    let mut repeat_costs = [0u64; 3];
    let counts = [4u32, 16, 32];

    for (idx, &holder_count) in counts.iter().enumerate() {
        let f = fixture();
        let asset_id = register_active_asset(&f, 10_000, 10, 0);
        let c = MultiAssetManagerClient::new(&f.env, &f.contract_id);

        let repeat_buyer = Address::generate(&f.env);
        mint(&f, &repeat_buyer, 100_000);
        c.buy_asset_shares(&asset_id, &repeat_buyer, &1, &i128::MAX);

        for _ in 1..holder_count {
            let holder = Address::generate(&f.env);
            mint(&f, &holder, 1_000);
            c.buy_asset_shares(&asset_id, &holder, &1, &i128::MAX);
        }

        let start = f.env.budget().cpu_instruction_cost();
        c.buy_asset_shares(&asset_id, &repeat_buyer, &10, &i128::MAX);
        let cpu = f.env.budget().cpu_instruction_cost() - start;
        repeat_costs[idx] = cpu;

        println!(
            "BENCHMARK name=buy_asset_shares_repeat_holders holders={} cpu={}",
            holder_count, cpu
        );
    }

    // Because IsHolder is O(1), repeat-purchase cost at 32 holders should stay
    // tightly bounded relative to 4 holders (no O(N) AssetHolders scan).
    assert!(
        repeat_costs[2] <= repeat_costs[0] + (repeat_costs[0] / 4) + 5_000,
        "Repeat buy CPU grew unexpectedly with holder count: {:?}",
        repeat_costs
    );
}

#[test]
fn benchmark_transfer_asset_shares_with_and_without_lockup() {
    let f1 = fixture();
    let asset_unlocked = register_active_asset(&f1, 1_000, 10, 0);
    let sender1 = Address::generate(&f1.env);
    let recipient1 = Address::generate(&f1.env);
    mint(&f1, &sender1, 10_000);
    let c1 = MultiAssetManagerClient::new(&f1.env, &f1.contract_id);
    c1.buy_asset_shares(&asset_unlocked, &sender1, &100, &i128::MAX);

    let start_unlocked = f1.env.budget().cpu_instruction_cost();
    c1.transfer_asset_shares(&asset_unlocked, &sender1, &recipient1, &25);
    let unlocked_cpu = f1.env.budget().cpu_instruction_cost() - start_unlocked;

    let f2 = fixture();
    let asset_locked = register_active_asset(&f2, 1_000, 10, 7);
    let sender2 = Address::generate(&f2.env);
    let recipient2 = Address::generate(&f2.env);
    mint(&f2, &sender2, 10_000);
    let c2 = MultiAssetManagerClient::new(&f2.env, &f2.contract_id);
    c2.buy_asset_shares(&asset_locked, &sender2, &100, &i128::MAX);
    f2.env.ledger().set_timestamp(7 * 86_400);

    let start_locked = f2.env.budget().cpu_instruction_cost();
    c2.transfer_asset_shares(&asset_locked, &sender2, &recipient2, &25);
    let lockup_checked_cpu = f2.env.budget().cpu_instruction_cost() - start_locked;

    println!("BENCHMARK name=transfer_asset_shares_unlocked cpu={}", unlocked_cpu);
    println!(
        "BENCHMARK name=transfer_asset_shares_lockup_checked cpu={}",
        lockup_checked_cpu
    );
    assert_eq!(c1.get_asset_balance(&asset_unlocked, &recipient1), 25);
    assert_eq!(c2.get_asset_balance(&asset_locked, &recipient2), 25);
}

#[test]
fn benchmark_burn_and_reconstitute() {
    let f = fixture();
    let asset_id = register_active_asset(&f, 500, 40, 0);
    let owner = Address::generate(&f.env);
    mint(&f, &owner, 50_000);
    let c = MultiAssetManagerClient::new(&f.env, &f.contract_id);
    c.buy_asset_shares(&asset_id, &owner, &500, &i128::MAX);

    let start = f.env.budget().cpu_instruction_cost();
    c.burn_and_reconstitute(&asset_id, &owner);
    let cpu = f.env.budget().cpu_instruction_cost() - start;

    println!("BENCHMARK name=burn_and_reconstitute supply=500 cpu={}", cpu);
    assert_eq!(c.get_reconstitution_compensation(&asset_id, &owner), 20_000);
}

#[test]
fn benchmark_list_assets_pagination_scales_with_page_size() {
    for asset_count in [8u32, 24] {
        let f = fixture();
        let c = MultiAssetManagerClient::new(&f.env, &f.contract_id);
        for i in 0..asset_count {
            let id = register_active_asset(&f, 100, 10, 0);
            if i % 2 == 1 {
                c.deactivate_asset(&id);
            }
        }

        let start_all = f.env.budget().cpu_instruction_cost();
        let all = c.list_assets(&0, &asset_count);
        let cpu_all = f.env.budget().cpu_instruction_cost() - start_all;

        let start_status = f.env.budget().cpu_instruction_cost();
        let active = c.list_assets_by_status(&AssetStatus::Active, &0, &asset_count);
        let cpu_status = f.env.budget().cpu_instruction_cost() - start_status;

        assert_eq!(all.len(), asset_count);
        assert_eq!(active.len(), asset_count / 2);

        println!(
            "BENCHMARK name=list_assets count={} cpu={}",
            asset_count, cpu_all
        );
        println!(
            "BENCHMARK name=list_assets_by_status count={} cpu={}",
            asset_count, cpu_status
        );
    }
}
