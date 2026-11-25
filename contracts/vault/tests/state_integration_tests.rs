// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

//! Integration, property-based (`proptest`), and resource-scaling tests for
//! `tokenized-fractional-vault` (`contracts/vault/src/state.rs`).

#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::{contract, testutils::Address as _, Address, Env, Vec};
use std::collections::BTreeSet;
use tokenized_fractional_vault::state::{
    register_holder_if_new, shares_of, total_assets, total_shares, DataKey,
};

#[contract]
struct TestVaultContract;

#[test]
fn test_existing_holder_reregistration_is_constant_time_o1() {
    let env_small = Env::default();
    let c_small = env_small.register(TestVaultContract, ());
    let repeat_small = Address::generate(&env_small);

    env_small.as_contract(&c_small, || {
        register_holder_if_new(&env_small, &repeat_small);
        for _ in 0..3 {
            let other = Address::generate(&env_small);
            register_holder_if_new(&env_small, &other);
        }
    });

    let start_small = env_small.budget().cpu_instruction_cost();
    env_small.as_contract(&c_small, || {
        register_holder_if_new(&env_small, &repeat_small);
    });
    let cpu_small = env_small.budget().cpu_instruction_cost() - start_small;

    let env_large = Env::default();
    let c_large = env_large.register(TestVaultContract, ());
    let repeat_large = Address::generate(&env_large);

    env_large.as_contract(&c_large, || {
        register_holder_if_new(&env_large, &repeat_large);
        for _ in 0..63 {
            let other = Address::generate(&env_large);
            register_holder_if_new(&env_large, &other);
        }
    });

    let start_large = env_large.budget().cpu_instruction_cost();
    env_large.as_contract(&c_large, || {
        register_holder_if_new(&env_large, &repeat_large);
    });
    let cpu_large = env_large.budget().cpu_instruction_cost() - start_large;

    let brand_new = Address::generate(&env_large);
    let start_new = env_large.budget().cpu_instruction_cost();
    env_large.as_contract(&c_large, || {
        register_holder_if_new(&env_large, &brand_new);
    });
    let cpu_new_65 = env_large.budget().cpu_instruction_cost() - start_new;

    println!(
        "BENCHMARK name=vault_register_existing_holder small_n=4 cpu_small={} large_n=64 cpu_large={} new_holder_cpu={}",
        cpu_small, cpu_large, cpu_new_65
    );

    // Issue #940: O(1) IsHolder short-circuit means re-registering an existing
    // holder avoids loading/rewriting the Holders Vec and stays bounded.
    assert!(cpu_large < cpu_new_65);
    assert!(cpu_large <= cpu_small + (cpu_small / 4) + 1_000);
}

#[test]
fn test_read_queries_do_not_create_holder_or_balance_entries() {
    let env = Env::default();
    let contract_id = env.register(TestVaultContract, ());
    let stranger = Address::generate(&env);

    env.as_contract(&contract_id, || {
        assert_eq!(total_assets(&env), 0);
        assert_eq!(total_shares(&env), 0);
        assert_eq!(shares_of(&env, &stranger), 0);

        assert!(!env.storage().instance().has(&DataKey::TotalAssets));
        assert!(!env.storage().instance().has(&DataKey::TotalShares));
        assert!(!env.storage().persistent().has(&DataKey::Shares(stranger.clone())));
        assert!(!env.storage().persistent().has(&DataKey::IsHolder(stranger)));
        assert!(!env.storage().persistent().has(&DataKey::Holders));
    });
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    #[test]
    fn prop_register_holder_if_new_preserves_set_uniqueness(
        indices in prop::collection::vec(0usize..12, 1..40)
    ) {
        let env = Env::default();
        let contract_id = env.register(TestVaultContract, ());

        let mut pool = std::vec::Vec::with_capacity(12);
        for _ in 0..12 {
            pool.push(Address::generate(&env));
        }

        let mut expected_order = std::vec::Vec::new();
        let mut seen = BTreeSet::new();

        env.as_contract(&contract_id, || {
            for &idx in &indices {
                let addr = &pool[idx];
                register_holder_if_new(&env, addr);
                if seen.insert(idx) {
                    expected_order.push(addr.clone());
                }
            }

            let stored: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::Holders)
                .unwrap();
            prop_assert_eq!(stored.len() as usize, expected_order.len());

            for (i, expected_addr) in expected_order.iter().enumerate() {
                prop_assert_eq!(stored.get(i as u32).unwrap(), expected_addr.clone());
            }

            for (idx, addr) in pool.iter().enumerate() {
                let flag: bool = env
                    .storage()
                    .persistent()
                    .get(&DataKey::IsHolder(addr.clone()))
                    .unwrap_or(false);
                prop_assert_eq!(flag, seen.contains(&idx));
            }
            Ok(())
        })?;
    }

    #[test]
    fn prop_totals_and_shares_roundtrip(
        assets in 0i128..=1_000_000_000_000i128,
        shares_a in 0i128..=1_000_000_000i128,
        shares_b in 0i128..=1_000_000_000i128,
    ) {
        let env = Env::default();
        let contract_id = env.register(TestVaultContract, ());
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::TotalAssets, &assets);
            let total = shares_a + shares_b;
            env.storage().instance().set(&DataKey::TotalShares, &total);
            env.storage().persistent().set(&DataKey::Shares(a.clone()), &shares_a);
            env.storage().persistent().set(&DataKey::Shares(b.clone()), &shares_b);

            prop_assert_eq!(total_assets(&env), assets);
            prop_assert_eq!(total_shares(&env), total);
            prop_assert_eq!(shares_of(&env, &a), shares_a);
            prop_assert_eq!(shares_of(&env, &b), shares_b);
            Ok(())
        })?;
    }
}
