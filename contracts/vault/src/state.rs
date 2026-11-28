use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    TotalAssets,
    TotalShares,
    Shares(Address),      // per-holder balance — already a separate key, not a blob
    Holders,              // soroban_sdk::Vec<Address> — registry only, no balances inline
    /// Issue #940: O(1) holder-membership flag. Replaces the previous
    /// load-full-Vec + linear `contains` scan + rewrite of the whole holder
    /// registry with a single per-holder boolean check/set.
    IsHolder(Address),
}

/// Read-only: total assets. No storage write, so no TTL bump either — a
/// query function should never cost the caller archival rent.
pub fn total_assets(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalAssets).unwrap_or(0)
}

pub fn total_shares(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
}

/// Lazy: only this one holder's balance is pulled from host storage,
/// never the full holder set.
pub fn shares_of(env: &Env, holder: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Shares(holder.clone()))
        .unwrap_or(0)
}

/// Registers a holder in the iterable set the FIRST time they hold a
/// nonzero balance. Uses an O(1) per-holder membership flag
/// (`DataKey::IsHolder`) instead of loading, scanning and rewriting the full
/// `Holders` vector on every call (Issue #940) — the same scalable pattern
/// adopted by the marketplace and multi-asset contracts.
pub fn register_holder_if_new(env: &Env, holder: &Address) {
    if env
        .storage()
        .persistent()
        .get(&DataKey::IsHolder(holder.clone()))
        .unwrap_or(false)
    {
        // Already registered — no storage write, no Vec scan.
        return;
    }
    env.storage()
        .persistent()
        .set(&DataKey::IsHolder(holder.clone()), &true);

    let mut holders: soroban_sdk::Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Holders)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    holders.push_back(holder.clone());
    env.storage().persistent().set(&DataKey::Holders, &holders);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, testutils::Address as _, Env, Vec};

    #[contract]
    struct DummyVault;

    fn with_vault<F: FnOnce(&Env)>(f: F) {
        let env = Env::default();
        let contract_id = env.register(DummyVault, ());
        env.as_contract(&contract_id, || f(&env));
    }

    #[test]
    fn test_empty_vault_queries_return_zero_without_writes() {
        with_vault(|env| {
            let holder = Address::generate(env);
            assert_eq!(total_assets(env), 0);
            assert_eq!(total_shares(env), 0);
            assert_eq!(shares_of(env, &holder), 0);

            assert!(!env.storage().persistent().has(&DataKey::IsHolder(holder)));
            assert!(!env.storage().persistent().has(&DataKey::Holders));
        });
    }

    #[test]
    fn test_totals_and_per_holder_shares_isolation() {
        with_vault(|env| {
            let h1 = Address::generate(env);
            let h2 = Address::generate(env);

            env.storage().instance().set(&DataKey::TotalAssets, &500_000i128);
            env.storage().instance().set(&DataKey::TotalShares, &10_000i128);
            env.storage().persistent().set(&DataKey::Shares(h1.clone()), &7_500i128);
            env.storage().persistent().set(&DataKey::Shares(h2.clone()), &2_500i128);

            assert_eq!(total_assets(env), 500_000);
            assert_eq!(total_shares(env), 10_000);
            assert_eq!(shares_of(env, &h1), 7_500);
            assert_eq!(shares_of(env, &h2), 2_500);
        });
    }

    #[test]
    fn test_register_holder_if_new_sets_flag_and_is_idempotent() {
        with_vault(|env| {
            let h1 = Address::generate(env);
            let h2 = Address::generate(env);

            register_holder_if_new(env, &h1);
            register_holder_if_new(env, &h1);
            register_holder_if_new(env, &h2);
            register_holder_if_new(env, &h1);
            register_holder_if_new(env, &h2);

            let is_h1: bool = env
                .storage()
                .persistent()
                .get(&DataKey::IsHolder(h1.clone()))
                .unwrap_or(false);
            let is_h2: bool = env
                .storage()
                .persistent()
                .get(&DataKey::IsHolder(h2.clone()))
                .unwrap_or(false);
            assert!(is_h1);
            assert!(is_h2);

            let holders: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::Holders)
                .unwrap();
            assert_eq!(holders.len(), 2);
            assert_eq!(holders.get(0).unwrap(), h1);
            assert_eq!(holders.get(1).unwrap(), h2);
        });
    }
}
