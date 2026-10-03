// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

//! Resource benchmarks for the state-changing fractional marketplace calls.
//!
//! Run with: cargo test --test resource_benchmarks -- --nocapture

#![cfg(test)]

use rwa_marketplace::{RwaMarketplace, RwaMarketplaceClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, Vec};

struct Fixture {
    env: Env,
    admin: Address,
    buyer: Address,
    token: Address,
    contract: Address,
}

fn fixture(total_shares: u32) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_contract.address();
    let contract = env.register(RwaMarketplace, ());
    let client = RwaMarketplaceClient::new(&env, &contract);
    client.init(&admin, &token, &100, &total_shares);

    Fixture { env, admin, buyer, token, contract }
}

fn mint(fixture: &Fixture, recipient: &Address, amount: i128) {
    token::StellarAssetClient::new(&fixture.env, &fixture.token).mint(recipient, &amount);
}

#[test]
fn benchmark_buy_shares_state_change() {
    let fixture = fixture(10_000);
    let client = RwaMarketplaceClient::new(&fixture.env, &fixture.contract);
    mint(&fixture, &fixture.buyer, 100_000);
    client.add_to_whitelist(&fixture.buyer);

    let start = fixture.env.budget().cpu_instruction_cost();
    client.buy_shares(&fixture.buyer, &100, &fixture.token);
    let cpu = fixture.env.budget().cpu_instruction_cost() - start;

    println!("BENCHMARK name=buy_shares shares=100 cpu={cpu}");
    assert_eq!(client.get_shares(&fixture.buyer), 100);
}

#[test]
fn benchmark_batch_transfer_scales_with_recipients() {
    for recipient_count in [4u32, 16, 32] {
        let fixture = fixture(10_000);
        let client = RwaMarketplaceClient::new(&fixture.env, &fixture.contract);
        mint(&fixture, &fixture.buyer, 10_000);
        client.add_to_whitelist(&fixture.buyer);
        client.buy_shares(&fixture.buyer, &recipient_count, &fixture.token);

        let mut recipients = Vec::new(&fixture.env);
        let mut amounts = Vec::new(&fixture.env);
        for _ in 0..recipient_count {
            let recipient = Address::generate(&fixture.env);
            client.add_to_whitelist(&recipient);
            recipients.push_back(recipient);
            amounts.push_back(1u32);
        }

        let start = fixture.env.budget().cpu_instruction_cost();
        client.batch_transfer(&fixture.buyer, recipients, amounts);
        let cpu = fixture.env.budget().cpu_instruction_cost() - start;

        println!("BENCHMARK name=batch_transfer recipients={recipient_count} cpu={cpu}");
    }
}

#[test]
fn benchmark_dividend_distribution_scales_with_holders() {
    for holder_count in [4u32, 16, 32] {
        let fixture = fixture(holder_count * 2);
        let client = RwaMarketplaceClient::new(&fixture.env, &fixture.contract);
        let payout = fixture.contract.clone();
        mint(&fixture, &payout, holder_count as i128 * 100);

        for _ in 0..holder_count {
            let holder = Address::generate(&fixture.env);
            mint(&fixture, &holder, 100);
            client.add_to_whitelist(&holder);
            client.buy_shares(&holder, &1, &fixture.token);
        }

        let start = fixture.env.budget().cpu_instruction_cost();
        client.distribute_dividends(&fixture.token, &(holder_count as i128 * 10));
        let cpu = fixture.env.budget().cpu_instruction_cost() - start;

        println!("BENCHMARK name=distribute_dividends holders={holder_count} cpu={cpu}");
    }
}
