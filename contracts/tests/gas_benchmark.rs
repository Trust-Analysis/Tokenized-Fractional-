// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

/**
 * tests/gas_benchmark.rs — Gas benchmarking for batch minting optimization.
 *
 * Compares gas consumption between single-token minting loops and batch minting
 * to quantify optimization savings.
 */

#![cfg(test)]

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Env};
use share_certificate_nft::{ShareCertificate, MintRequest};
use stellar_tokens::non_fungible::NonFungibleToken;

#[test]
fn benchmark_single_mint_vs_batch_mint() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    
    // Initialize NFT contract
    ShareCertificate::init(
        &env,
        admin.clone(),
        soroban_sdk::String::from_str(&env, "ipfs://test"),
        soroban_sdk::String::from_str(&env, "Test NFT"),
        soroban_sdk::String::from_str(&env, "TEST"),
    );
    
    // Benchmark single minting (10 mints)
    let start_single = env.budget().cpu_instruction_cost();
    for _ in 0..10 {
        ShareCertificate::mint_certificate(&env.clone(), buyer.clone());
    }
    let end_single = env.budget().cpu_instruction_cost();
    let single_cost = end_single - start_single;
    
    // Reset for batch minting
    let env2 = Env::default();
    env2.mock_all_auths();
    ShareCertificate::init(
        &env2,
        admin.clone(),
        soroban_sdk::String::from_str(&env2, "ipfs://test"),
        soroban_sdk::String::from_str(&env2, "Test NFT"),
        soroban_sdk::String::from_str(&env2, "TEST"),
    );
    
    // Benchmark batch minting (10 mints in one call)
    let start_batch = env2.budget().cpu_instruction_cost();
    ShareCertificate::batch_mint_to_single(&env2, buyer.clone(), 10);
    let end_batch = env2.budget().cpu_instruction_cost();
    let batch_cost = end_batch - start_batch;
    
    let savings = single_cost - batch_cost;
    let savings_percent = (savings as f64 / single_cost as f64) * 100.0;
    
    println!("Single minting cost (10 mints): {}", single_cost);
    println!("Batch minting cost (10 mints): {}", batch_cost);
    println!("Gas savings: {} ({}%)", savings, savings_percent);
    
    // Assert that batch minting is more efficient
    assert!(batch_cost < single_cost, "Batch minting should be more gas-efficient");
    assert!(savings_percent > 10.0, "Should save at least 10% gas");
}

#[test]
fn benchmark_batch_mint_multiple_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let recipient3 = Address::generate(&env);
    
    // Initialize NFT contract
    ShareCertificate::init(
        &env,
        admin.clone(),
        soroban_sdk::String::from_str(&env, "ipfs://test"),
        soroban_sdk::String::from_str(&env, "Test NFT"),
        soroban_sdk::String::from_str(&env, "TEST"),
    );
    
    // Create batch mint requests
    let mut requests = soroban_sdk::Vec::new(&env);
    requests.push_back(MintRequest {
        to: recipient1.clone(),
        count: 5,
    });
    requests.push_back(MintRequest {
        to: recipient2.clone(),
        count: 3,
    });
    requests.push_back(MintRequest {
        to: recipient3.clone(),
        count: 2,
    });
    
    // Benchmark batch minting to multiple recipients
    let start = env.budget().cpu_instruction_cost();
    let total = ShareCertificate::batch_mint_certificates(&env, requests);
    let end = env.budget().cpu_instruction_cost();
    let cost = end - start;
    
    println!("Batch mint to 3 recipients (10 total NFTs): {}", cost);
    println!("Total NFTs minted: {}", total);
    
    assert_eq!(total, 10);
    
    // Verify balances
    let nft = share_certificate_nft::Base::new(&env, &env.current_contract_address());
    assert_eq!(nft.balance(&recipient1), 5);
    assert_eq!(nft.balance(&recipient2), 3);
    assert_eq!(nft.balance(&recipient3), 2);
}

#[test]
fn benchmark_large_batch_mint() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let buyer = Address::generate(&env);
    
    // Initialize NFT contract
    ShareCertificate::init(
        &env,
        admin.clone(),
        soroban_sdk::String::from_str(&env, "ipfs://test"),
        soroban_sdk::String::from_str(&env, "Test NFT"),
        soroban_sdk::String::from_str(&env, "TEST"),
    );
    
    // Benchmark large batch (100 NFTs)
    let start = env.budget().cpu_instruction_cost();
    ShareCertificate::batch_mint_to_single(&env, buyer.clone(), 100);
    let end = env.budget().cpu_instruction_cost();
    let batch_cost = end - start;
    
    println!("Large batch mint (100 NFTs): {}", batch_cost);
    println!("Cost per NFT: {}", batch_cost / 100);
    
    // Verify balance
    let nft = share_certificate_nft::Base::new(&env, &env.current_contract_address());
    assert_eq!(nft.balance(&buyer), 100);
}
