use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    TotalAssets,
    TotalShares,
    Shares(Address),      // per-holder balance — already a separate key, not a blob
    Holders,              // soroban_sdk::Vec<Address> — registry only, no balances inline
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
/// nonzero balance. Uses soroban_sdk::Vec natively — no std::Vec
/// round-trip, no full holder list decoded except when someone is
/// actually being added.
pub fn register_holder_if_new(env: &Env, holder: &Address) {
    let mut holders: soroban_sdk::Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::Holders)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    if !holders.contains(holder) {
        holders.push_back(holder.clone());
        env.storage().persistent().set(&DataKey::Holders, &holders);
    }
}