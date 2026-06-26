#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, Bytes, Env, Vec,
};

#[contract]
pub struct RwaMarketplace;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    PaymentToken,
    PricePerShare,
    TotalShares,
    AvailableShares,
    Paused,
    Balance(Address),
    VestingSchedules(Address),
    Holders, // registry of all unique holder addresses
    MetadataUri,
}

#[contracttype]
#[derive(Clone)]
pub struct VestingSchedule {
    pub start: u64,
    pub cliff: u64,
    pub duration: u64,
    pub total_amount: u32,
    pub claimed_amount: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventInit {
    admin: Address,
    payment_token: Address,
    price: i128,
    total_shares: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventBuyShares {
    buyer: Address,
    shares: u32,
    total_cost: i128,
}

#[contractevent]
pub struct EventPause {}

#[contractevent]
pub struct EventUnpause {}

#[contractevent(data_format = "vec")]
pub struct EventEmergencyWithdraw {
    to: Address,
    amount: i128,
}

// ← NEW: dividend distribution event
#[contractevent(data_format = "vec")]
pub struct EventDistributeDividends {
    token: Address,
    total_amount: i128,
    holder_count: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventSetPrice {
    old_price: i128,
    new_price: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventSetTotalShares {
    old_total: u32,
    new_total: u32,
}

// ── OVERFLOW-SAFE MATH HELPERS ──────────────────────────────────────
/// Safely add two i128 values, panicking on overflow
fn checked_add_i128(a: i128, b: i128) -> i128 {
    a.checked_add(b).unwrap_or_else(|| panic!("Arithmetic overflow: cannot add {} + {}", a, b))
}

/// Safely subtract two i128 values, panicking on underflow
fn checked_sub_i128(a: i128, b: i128) -> i128 {
    a.checked_sub(b).unwrap_or_else(|| panic!("Arithmetic underflow: cannot subtract {} from {}", b, a))
}

/// Safely multiply two i128 values, panicking on overflow
fn checked_mul_i128(a: i128, b: i128) -> i128 {
    a.checked_mul(b).unwrap_or_else(|| panic!("Arithmetic overflow: cannot multiply {} * {}", a, b))
}

/// Safely add two u32 values, panicking on overflow
fn checked_add_u32(a: u32, b: u32) -> u32 {
    a.checked_add(b).unwrap_or_else(|| panic!("Arithmetic overflow: cannot add {} + {}", a, b))
}

/// Safely subtract two u32 values, panicking on underflow
fn checked_sub_u32(a: u32, b: u32) -> u32 {
    a.checked_sub(b).unwrap_or_else(|| panic!("Arithmetic underflow: cannot subtract {} from {}", b, a))
}

#[contractimpl]
impl RwaMarketplace {
    pub fn init(env: Env, admin: Address, payment_token: Address, price: i128, total_shares: u32) {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Marketplace is already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PaymentToken, &payment_token);
        env.storage().instance().set(&DataKey::PricePerShare, &price);
        env.storage().instance().set(&DataKey::TotalShares, &total_shares);
        env.storage().instance().set(&DataKey::AvailableShares, &total_shares);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Initialize empty holders registry
        let holders: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Holders, &holders);

        EventInit { admin, payment_token, price, total_shares }.publish(&env);
    }

    pub fn buy_shares(env: Env, buyer: Address, shares: u32) {
        buyer.require_auth();

        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            panic!("Marketplace is paused");
        }

        let available: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .expect("Contract not initialized: available shares");

        if shares > available {
            panic!("Not enough shares available for purchase");
        }

        if shares == 0 {
            panic!("Must purchase at least 1 share");
        }

        let price: i128 = env.storage().instance().get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");
        let total_cost = price * (shares as i128);

        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .expect("Contract not initialized: payment token");

        let client = token::TokenClient::new(&env, &token_id);
        client.transfer(&buyer, &admin, &total_cost);

        let new_available = checked_sub_u32(available, shares);
        env.storage()
            .instance()
            .set(&DataKey::AvailableShares, &new_available);

        let prev_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(buyer.clone()))
            .unwrap_or(0);

        let new_balance = checked_add_u32(prev_balance, shares);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(buyer.clone()), &new_balance);

        // Register as new holder only on first purchase or if not registered yet
        Self::register_holder(&env, buyer.clone());

        EventBuyShares { buyer, shares, total_cost }.publish(&env);
    }

    pub fn add_to_whitelist(env: Env, addr: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Whitelisted(addr.clone()), &true);
    }

    pub fn remove_from_whitelist(env: Env, addr: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().persistent().remove(&DataKey::Whitelisted(addr.clone()));
    }

    pub fn is_whitelisted(env: Env, addr: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Whitelisted(addr))
            .unwrap_or(false)
    }

    /// Distribute `total_amount` of `token` pro-rata among all current holders
    /// based on their share count relative to total issued shares.
    ///
    /// Only the admin may call this. The contract must hold enough `token`
    /// balance to cover `total_amount` before calling.
    pub fn distribute_dividends(env: Env, token: Address, total_amount: i128) {
        // Only admin can distribute
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if total_amount <= 0 {
            panic!("Dividend amount must be positive");
        }

        let total_shares: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .expect("Contract not initialized: total shares");

        if total_shares == 0 {
            panic!("No shares have been issued");
        }

        let holders: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Holders)
            .unwrap_or_else(|| Vec::new(&env));

        if holders.is_empty() {
            panic!("No holders registered");
        }

        let client = token::TokenClient::new(&env, &token);
        let contract_addr = env.current_contract_address();

        // Track holders whose balance has dropped to 0 (to clean up registry)
        let mut active_holders: Vec<Address> = Vec::new(&env);

        for holder in holders.iter() {
            let holder_shares: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(holder.clone()))
                .unwrap_or(0);

            if holder_shares == 0 {
                // Balance is zero — skip and exclude from registry
                continue;
            }

            active_holders.push_back(holder.clone());

            // Pro-rata: holder_amount = total_amount * holder_shares / total_shares
            // Use checked arithmetic to avoid overflow
            let holder_amount: i128 =
                checked_mul_i128(total_amount, holder_shares as i128) / (total_shares as i128);

            if holder_amount > 0 {
                client.transfer(&contract_addr, &holder, &holder_amount);
            }
        }

        // Update holder registry — removes any zero-balance holders
        env.storage().instance().set(&DataKey::Holders, &active_holders);

        let holder_count = active_holders.len();

        EventDistributeDividends {
            token,
            total_amount,
            holder_count,
        }
        .publish(&env);
    }

    /// Register a holder if not already present.
    fn register_holder(env: &Env, owner: Address) {
        let mut holders: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Holders)
            .unwrap_or_else(|| Vec::new(env));
        for holder in holders.iter() {
            if holder == owner {
                return;
            }
        }
        holders.push_back(owner);
        env.storage().instance().set(&DataKey::Holders, &holders);
    }

    fn load_vesting_schedules(env: &Env, owner: &Address) -> Vec<VestingSchedule> {
        env.storage()
            .persistent()
            .get(&DataKey::VestingSchedules(owner.clone()))
            .unwrap_or_else(|| Vec::new(env))
    }

    fn set_vesting_schedules(env: &Env, owner: &Address, schedules: &Vec<VestingSchedule>) {
        env.storage()
            .persistent()
            .set(&DataKey::VestingSchedules(owner.clone()), schedules);
    }

    fn compute_vested_amount(schedule: &VestingSchedule, timestamp: u64) -> u32 {
        let start = schedule.start;
        let cliff_time = start.saturating_add(schedule.cliff);
        let vesting_end = start.saturating_add(schedule.duration);

        if timestamp < cliff_time {
            return 0;
        }
        if timestamp >= vesting_end || schedule.duration <= schedule.cliff {
            return schedule.total_amount;
        }

        let vested_duration = timestamp.saturating_sub(cliff_time);
        let total_vesting_duration = schedule.duration.saturating_sub(schedule.cliff);
        let vested = (schedule.total_amount as u128)
            .saturating_mul(vested_duration as u128)
            / (total_vesting_duration as u128);
        vested as u32
    }

    fn total_owned_shares(env: &Env, owner: &Address) -> u32 {
        let liquid: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(owner.clone()))
            .unwrap_or(0);
        let schedules = Self::load_vesting_schedules(env, owner);
        let mut locked: u32 = 0;
        for schedule in schedules.iter() {
            locked = locked.saturating_add(schedule.total_amount.saturating_sub(schedule.claimed_amount));
        }
        liquid.saturating_add(locked)
    }

    fn calc_claimable_vested_shares(env: &Env, owner: &Address, timestamp: u64) -> u32 {
        let schedules = Self::load_vesting_schedules(env, owner);
        let mut claimable: u32 = 0;
        for schedule in schedules.iter() {
            let vested = Self::compute_vested_amount(&schedule, timestamp);
            let available = vested.saturating_sub(schedule.claimed_amount);
            claimable = claimable.saturating_add(available);
        }
        claimable
    }

    pub fn buy_vested_shares(env: Env, buyer: Address, shares: u32, duration: u64) {
        buyer.require_auth();

        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            panic!("Marketplace is paused");
        }

        if shares == 0 {
            panic!("Must purchase at least 1 share");
        }

        if duration == 0 {
            panic!("Vesting duration must be positive");
        }

        let available: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .unwrap();

        if shares > available {
            panic!("Not enough shares available for purchase");
        }

        let price: i128 = env.storage().instance().get(&DataKey::PricePerShare).unwrap();
        let total_cost = price * (shares as i128);

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .unwrap();

        let client = token::TokenClient::new(&env, &token_id);
        client.transfer(&buyer, &admin, &total_cost);

        env.storage()
            .instance()
            .set(&DataKey::AvailableShares, &(available - shares));

        let now = env.ledger().timestamp();
        let schedule = VestingSchedule {
            start: now,
            cliff: 0,
            duration,
            total_amount: shares,
            claimed_amount: 0,
        };

        let mut schedules = Self::load_vesting_schedules(&env, &buyer);
        schedules.push_back(schedule);
        Self::set_vesting_schedules(&env, &buyer, &schedules);

        Self::register_holder(&env, buyer.clone());

        EventBuyShares { buyer, shares, total_cost }.publish(&env);
    }

    pub fn claim_vested_shares(env: Env, claimer: Address) {
        claimer.require_auth();

        let now = env.ledger().timestamp();
        let mut schedules = Self::load_vesting_schedules(&env, &claimer);

        let mut total_claimable: u32 = 0;
        let mut updated_schedules: Vec<VestingSchedule> = Vec::new(&env);

        for schedule in schedules.iter() {
            let vested = Self::compute_vested_amount(&schedule, now);
            let available = vested.saturating_sub(schedule.claimed_amount);
            if available > 0 {
                total_claimable = total_claimable.saturating_add(available);
                let mut schedule = schedule.clone();
                schedule.claimed_amount = schedule.claimed_amount.saturating_add(available);
                if schedule.claimed_amount < schedule.total_amount {
                    updated_schedules.push_back(schedule);
                }
            } else {
                updated_schedules.push_back(schedule.clone());
            }
        }

        if total_claimable == 0 {
            panic!("No vested shares available to claim");
        }

        let prev_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(claimer.clone()))
            .unwrap_or(0);
        let new_balance = prev_balance.saturating_add(total_claimable);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(claimer.clone()), &new_balance);

        Self::set_vesting_schedules(&env, &claimer, &updated_schedules);
    }

    pub fn get_vesting_schedules(env: Env, owner: Address) -> Vec<VestingSchedule> {
        Self::load_vesting_schedules(&env, &owner)
    }

    pub fn get_claimable_vested_shares(env: Env, owner: Address) -> u32 {
        Self::calc_claimable_vested_shares(&env, &owner, env.ledger().timestamp())
    }

    pub fn get_locked_shares(env: Env, owner: Address) -> u32 {
        let schedules = Self::load_vesting_schedules(&env, &owner);
        let mut locked: u32 = 0;
        for schedule in schedules.iter() {
            locked = locked.saturating_add(schedule.total_amount.saturating_sub(schedule.claimed_amount));
        }
        locked
    }

    /// Returns the current list of registered holders.
    pub fn get_holders(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Holders)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Store a URI pointing to off-chain asset metadata. Admin only.
    pub fn set_metadata_uri(env: Env, uri: Bytes) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().instance().set(&DataKey::MetadataUri, &uri);
    }

    /// Retrieve the on-chain metadata URI. Returns empty bytes if not set.
    pub fn get_metadata_uri(env: Env) -> Bytes {
        env.storage().instance().get(&DataKey::MetadataUri)
            .unwrap_or_else(|| Bytes::new(&env))
    }

    pub fn get_shares(env: Env, owner: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(owner))
            .unwrap_or(0)
    }

    pub fn get_available_shares(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .unwrap_or(0)
    }

    pub fn get_total_shares(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0)
    }

    pub fn get_price(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::PricePerShare)
            .unwrap_or(0)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(true)
    }

    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        EventPause {}.publish(&env);
    }

    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        EventUnpause {}.publish(&env);
    }

    pub fn emergency_withdraw(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .expect("Contract not initialized: payment token");

        let client = token::TokenClient::new(&env, &token_id);
        client.transfer(&env.current_contract_address(), &to, &amount);

        EventEmergencyWithdraw { to, amount }.publish(&env);
    }

    /// Update the per-share price. Only the admin may call this.
    pub fn set_price(env: Env, new_price: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if new_price <= 0 {
            panic!("Price must be positive");
        }

        let old_price: i128 = env.storage().instance().get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");
        env.storage()
            .instance()
            .set(&DataKey::PricePerShare, &new_price);

        EventSetPrice {
            old_price,
            new_price,
        }
        .publish(&env);
    }

    /// Issue additional shares or adjust the total supply cap.
    /// Only the admin may call this. `new_total` must be at least the number
    /// of shares already sold and at least the current available pool.
    pub fn set_total_shares(env: Env, new_total: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let total_shares: u32 = env.storage().instance().get(&DataKey::TotalShares)
            .expect("Contract not initialized: total shares");
        let available_shares: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .expect("Contract not initialized: available shares");

        let issued_shares = checked_sub_u32(total_shares, available_shares);

        if new_total < available_shares {
            panic!("New total must be at least available shares");
        }

        if new_total < issued_shares {
            panic!("New total cannot be less than issued shares");
        }

        let new_available = checked_sub_u32(new_total, issued_shares);

        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &new_total);
        env.storage()
            .instance()
            .set(&DataKey::AvailableShares, &new_available);

        EventSetTotalShares {
            old_total: total_shares,
            new_total,
        }
        .publish(&env);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, token, Env};

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

    // ── Existing tests (unchanged) ──────────────────────────────────────

    #[test]
    fn test_init_and_query() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        assert_eq!(c.get_total_shares(), 1000);
        assert_eq!(c.get_available_shares(), 1000);
        assert_eq!(c.get_price(), 100);
        assert!(!c.is_paused());
        assert_eq!(c.get_shares(&te.admin), 0);
    }

    #[test]
    #[should_panic(expected = "Buyer is not whitelisted")]
    fn test_buy_shares_requires_whitelist() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100000);
        c.buy_shares(&te.buyer, &25);
    }

    #[test]
    fn test_whitelist_admin_can_add_and_buy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100000);

        assert!(!c.is_whitelisted(&te.buyer));
        c.add_to_whitelist(&te.buyer);
        assert!(c.is_whitelisted(&te.buyer));

        c.buy_shares(&te.buyer, &25);
        assert_eq!(c.get_shares(&te.buyer), 25);
        assert_eq!(c.get_available_shares(), 975);
    }

    #[test]
    #[should_panic(expected = "Buyer is not whitelisted")]
    fn test_remove_from_whitelist_blocks_buy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100000);

        c.add_to_whitelist(&te.buyer);
        assert!(c.is_whitelisted(&te.buyer));
        c.remove_from_whitelist(&te.buyer);
        assert!(!c.is_whitelisted(&te.buyer));

        c.buy_shares(&te.buyer, &25);
    }

    #[test]
    fn test_multiple_buys() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100000);
        c.add_to_whitelist(&te.buyer);

        c.buy_shares(&te.buyer, &10);
        c.buy_shares(&te.buyer, &20);
        assert_eq!(c.get_shares(&te.buyer), 30);
        assert_eq!(c.get_available_shares(), 970);
    }

    #[test]
    fn test_pause_unpause() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        assert!(!c.is_paused());
        c.pause();
        assert!(c.is_paused());
        c.unpause();
        assert!(!c.is_paused());
    }

    #[test]
    #[should_panic(expected = "Marketplace is paused")]
    fn test_buy_when_paused() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.pause();
        c.buy_shares(&te.buyer, &1);
    }

    #[test]
    #[should_panic(expected = "Marketplace is already initialized")]
    fn test_double_init() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.init(&te.admin, &te.token_id, &100, &1000);
    }

    #[test]
    #[should_panic(expected = "Not enough shares available")]
    fn test_overbuy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &10);
        mint(&te, &te.buyer, 100000);
        c.buy_shares(&te.buyer, &20);
    }

    #[test]
    #[should_panic(expected = "Must purchase at least 1 share")]
    fn test_zero_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.buy_shares(&te.buyer, &0);
    }

    #[test]
    fn test_emergency_withdraw() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.emergency_withdraw(&te.admin, &0);
    }

    // ── New tests for holder registry and distribute_dividends ──────────

    #[test]
    fn test_holders_registered_on_buy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Before any purchase, registry is empty
        assert_eq!(c.get_holders().len(), 0);

        c.buy_shares(&te.buyer, &10);
        assert_eq!(c.get_holders().len(), 1);

        // Second buy by same buyer — should NOT add duplicate
        c.buy_shares(&te.buyer, &5);
        assert_eq!(c.get_holders().len(), 1);
    }

    #[test]
    fn test_multiple_holders_registered() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let buyer2 = Address::generate(&te.env);
        mint(&te, &te.buyer, 100_000);
        mint(&te, &buyer2, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.add_to_whitelist(&buyer2);

        c.buy_shares(&te.buyer, &10);
        c.buy_shares(&buyer2, &20);

        assert_eq!(c.get_holders().len(), 2);
    }

    #[test]
    fn test_distribute_dividends_single_holder() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.buy_shares(&te.buyer, &500); // buyer owns 500 / 1000 shares = 50%

        // Mint dividend tokens to the contract
        let dividend_amount: i128 = 10_000;
        mint(&te, &te.contract_id, dividend_amount);

        c.distribute_dividends(&te.token_id, &dividend_amount);

        // buyer has 500/1000 shares → receives 5000
        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        // buyer started with 100_000, paid 500*100=50_000, receives 5_000
        assert_eq!(token_client.balance(&te.buyer), 100_000 - 50_000 + 5_000);
    }

    #[test]
    fn test_distribute_dividends_multiple_holders() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let buyer2 = Address::generate(&te.env);
        mint(&te, &te.buyer, 100_000);
        mint(&te, &buyer2, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.add_to_whitelist(&buyer2);

        // buyer: 250 shares (25%), buyer2: 750 shares (75%)
        c.buy_shares(&te.buyer, &250);
        c.buy_shares(&buyer2, &750);

        let dividend_amount: i128 = 10_000;
        mint(&te, &te.contract_id, dividend_amount);

        c.distribute_dividends(&te.token_id, &dividend_amount);

        let token_client = token::TokenClient::new(&te.env, &te.token_id);

        // buyer: 10000 * 250 / 1000 = 2500
        assert_eq!(
            token_client.balance(&te.buyer),
            100_000 - 250 * 100 + 2_500
        );
        // buyer2: 10000 * 750 / 1000 = 7500
        assert_eq!(
            token_client.balance(&buyer2),
            100_000 - 750 * 100 + 7_500
        );
    }

    #[test]
    fn test_distribute_cleans_up_zero_balance_holders() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let buyer2 = Address::generate(&te.env);
        mint(&te, &te.buyer, 100_000);
        mint(&te, &buyer2, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.add_to_whitelist(&buyer2);

        c.buy_shares(&te.buyer, &10);
        c.buy_shares(&buyer2, &20);
        assert_eq!(c.get_holders().len(), 2);

        // Manually zero out buyer's balance to simulate a future sell/transfer
        te.env.as_contract(&te.contract_id, || {
            te.env
                .storage()
                .persistent()
                .set(&DataKey::Balance(te.buyer.clone()), &0u32);
        });

        let dividend_amount: i128 = 1_000;
        mint(&te, &te.contract_id, dividend_amount);
        c.distribute_dividends(&te.token_id, &dividend_amount);

        // buyer had 0 shares — removed from registry
        assert_eq!(c.get_holders().len(), 1);
    }

    #[test]
    #[should_panic(expected = "Dividend amount must be positive")]
    fn test_distribute_zero_amount() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.distribute_dividends(&te.token_id, &0);
    }

    #[test]
    #[should_panic(expected = "No holders registered")]
    fn test_distribute_no_holders() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.distribute_dividends(&te.token_id, &1000);
    }

    // ── Tests for set_price and set_total_shares ────────────────────────

    #[test]
    fn test_set_price() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_price(&200);
        assert_eq!(c.get_price(), 200);
    }

    #[test]
    fn test_set_price_affects_future_buys() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.set_price(&200);
        c.buy_shares(&te.buyer, &10);

        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        assert_eq!(token_client.balance(&te.buyer), 100_000 - 10 * 200);
    }

    #[test]
    #[should_panic(expected = "Price must be positive")]
    fn test_set_price_zero() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_price(&0);
    }

    #[test]
    #[should_panic(expected = "Price must be positive")]
    fn test_set_price_negative() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_price(&-50);
    }

    #[test]
    fn test_set_total_shares_increase() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_total_shares(&1500);
        assert_eq!(c.get_total_shares(), 1500);
        assert_eq!(c.get_available_shares(), 1500);
    }

    #[test]
    fn test_set_total_shares_after_partial_sale() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.buy_shares(&te.buyer, &100);
        assert_eq!(c.get_available_shares(), 900);

        c.set_total_shares(&1200);
        assert_eq!(c.get_total_shares(), 1200);
        assert_eq!(c.get_available_shares(), 1100);
        assert_eq!(c.get_shares(&te.buyer), 100);
    }

    #[test]
    fn test_set_total_shares_same_as_current() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_total_shares(&1000);
        assert_eq!(c.get_total_shares(), 1000);
        assert_eq!(c.get_available_shares(), 1000);
    }

    #[test]
    #[should_panic(expected = "New total must be at least available shares")]
    fn test_set_total_shares_below_available() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_total_shares(&500);
    }

    #[test]
    #[should_panic(expected = "Arithmetic overflow")]
    fn test_buy_shares_price_overflow() {
        let te = setup();
        let c = client(&te);
        // Use very high price that will overflow when multiplied by shares
        c.init(&te.admin, &te.token_id, &i128::MAX, &1000);
        mint(&te, &te.buyer, i128::MAX);
        
        // This should panic because price * shares overflows
        c.buy_shares(&te.buyer, &2);
    }

    #[test]
    #[should_panic(expected = "Not enough shares available")]
    fn test_buy_shares_overbuy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        
        // Buy more shares than available (caught by logic check, not arithmetic)
        c.buy_shares(&te.buyer, &2000);
    }

    #[test]
    #[should_panic(expected = "Arithmetic overflow")]
    fn test_buy_shares_balance_overflow() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &1, &u32::MAX);
        mint(&te, &te.buyer, i128::MAX);
        
        // Manually set high balance to test the checked_add_u32 in balance calculation
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().persistent().set(&DataKey::Balance(te.buyer.clone()), &(u32::MAX - 10));
            // Also set available shares high enough
            te.env.storage().instance().set(&DataKey::AvailableShares, &1000u32);
        });
        
        // Now buying 20 more shares should trigger overflow in checked_add_u32
        c.buy_shares(&te.buyer, &20);
    }

    #[test]
    #[should_panic(expected = "Arithmetic overflow")]
    fn test_distribute_dividends_multiply_overflow() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        
        c.buy_shares(&te.buyer, &500);
        
        // Use extremely large dividend amount that will overflow when multiplied by holder_shares
        let huge_dividend: i128 = i128::MAX / 2;
        mint(&te, &te.contract_id, huge_dividend);
        
        // This should panic because total_amount * holder_shares overflows
        c.distribute_dividends(&te.token_id, &huge_dividend);
    }

    #[test]
    #[should_panic(expected = "New total cannot be less than issued shares")]
    fn test_set_total_shares_below_issued_logic_check() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        
        // Buy some shares to create issued_shares
        c.buy_shares(&te.buyer, &600);
        
        // Try to set new_total to less than issued_shares
        // This is caught by the logic check before any arithmetic
        c.set_total_shares(&500);
    }

    // ── Pre-init tests: every function should give a clear error before init ─

    fn pre_init_client() -> (Env, RwaMarketplaceClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let contract_id = env.register(RwaMarketplace, ());
        let client = RwaMarketplaceClient::new(&env, &contract_id);
        (env, client, token_id, admin)
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_buy_shares() {
        let (env, client, _, _) = pre_init_client();
        let buyer = Address::generate(&env);
        client.buy_shares(&buyer, &1);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_pause() {
        let (_, client, _, _) = pre_init_client();
        client.pause();
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_unpause() {
        let (_, client, _, _) = pre_init_client();
        client.unpause();
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_set_price() {
        let (_, client, _, _) = pre_init_client();
        client.set_price(&100);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_set_total_shares() {
        let (_, client, _, _) = pre_init_client();
        client.set_total_shares(&1000);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_distribute_dividends() {
        let (_, client, token_id, _) = pre_init_client();
        client.distribute_dividends(&token_id, &1000);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_emergency_withdraw() {
        let (_, client, _, admin) = pre_init_client();
        client.emergency_withdraw(&admin, &0);
    }

    // ── Metadata URI tests ──────────────────────────────────────────────

    #[test]
    fn test_set_and_get_metadata_uri() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let uri = soroban_sdk::Bytes::from_slice(&te.env, b"ipfs://QmTest");
        c.set_metadata_uri(&uri);
        assert_eq!(c.get_metadata_uri(), uri);
    }

    #[test]
    fn test_get_metadata_uri_default_empty() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        assert_eq!(c.get_metadata_uri(), soroban_sdk::Bytes::new(&te.env));
    }

    #[test]
    fn test_set_metadata_uri_overwrites() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_metadata_uri(&soroban_sdk::Bytes::from_slice(&te.env, b"ipfs://old"));
        let new_uri = soroban_sdk::Bytes::from_slice(&te.env, b"ipfs://new");
        c.set_metadata_uri(&new_uri);
        assert_eq!(c.get_metadata_uri(), new_uri);
    }
}
// --- TIMELOCK MODULE ---
// Appended as a completely isolated module to avoid breaking existing enums.

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminAction {
    Pause,
    Unpause,
    EmergencyWithdraw(soroban_sdk::Address, i128),
}

#[soroban_sdk::contracttype]
pub enum TimelockDataKey {
    TimelockOp(AdminAction),
}

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TimelockError {
    NotScheduled = 1,
    TimelockNotExpired = 2,
    AlreadyScheduled = 3,
}

#[soroban_sdk::contractimpl]
impl RwaMarketplace {
    pub fn schedule_operation(env: soroban_sdk::Env, admin: soroban_sdk::Address, action: AdminAction) {
        admin.require_auth();
        let timelock_key = TimelockDataKey::TimelockOp(action.clone());
        
        if env.storage().persistent().has(&timelock_key) {
            soroban_sdk::panic_with_error!(&env, TimelockError::AlreadyScheduled);
        }
        
        let execute_after = env.ledger().timestamp() + 172_800; // 48 hours
        env.storage().persistent().set(&timelock_key, &execute_after);
    }

    pub fn cancel_operation(env: soroban_sdk::Env, admin: soroban_sdk::Address, action: AdminAction) {
        admin.require_auth();
        let timelock_key = TimelockDataKey::TimelockOp(action);
        
        if !env.storage().persistent().has(&timelock_key) {
            soroban_sdk::panic_with_error!(&env, TimelockError::NotScheduled);
        }
        
        env.storage().persistent().remove(&timelock_key);
    }

    pub fn execute_operation(env: soroban_sdk::Env, admin: soroban_sdk::Address, action: AdminAction) {
        admin.require_auth();
        let timelock_key = TimelockDataKey::TimelockOp(action.clone());
        
        let execute_after: u64 = env
            .storage()
            .persistent()
            .get(&timelock_key)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(&env, TimelockError::NotScheduled));

        if env.ledger().timestamp() < execute_after {
            soroban_sdk::panic_with_error!(&env, TimelockError::TimelockNotExpired);
        }

        env.storage().persistent().remove(&timelock_key);

        // Forward to the native marketplace functions securely
        match action {
            AdminAction::Pause => {
                RwaMarketplace::pause(env.clone());
            },
            AdminAction::Unpause => {
                RwaMarketplace::unpause(env.clone());
            },
            AdminAction::EmergencyWithdraw(to, amount) => {
                RwaMarketplace::emergency_withdraw(env.clone(), to, amount);
            }
        }
    }
}

#[cfg(test)]
mod timelock_tests {
    use super::*;
    use soroban_sdk::{Env, testutils::{Address as _, Ledger as _}};
    
    #[test]
    fn test_timelock_delay() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = soroban_sdk::Address::generate(&env);
        let payment_token = soroban_sdk::Address::generate(&env);
        
        let contract_id = env.register(RwaMarketplace, ());
        let client = RwaMarketplaceClient::new(&env, &contract_id);
        
        client.init(&admin, &payment_token, &100_i128, &1000_u32);
        
        let action = AdminAction::Pause;
        
        client.schedule_operation(&admin, &action);
        env.ledger().set_timestamp(env.ledger().timestamp() + 176_400); // Forward 49 hours
        client.execute_operation(&admin, &action);
        
        assert_eq!(client.is_paused(), true);
    }
}

// ── Property-based / fuzz tests using proptest ─────────────────────────

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::testutils::Address as _;

    const NUM_BUYERS: usize = 5;
    const INIT_TOTAL: u32 = 1000;
    const INIT_PRICE: i128 = 100;

    /// Operations that can be fuzzed.
    #[derive(Clone, Debug)]
    enum Op {
        BuyShares { buyer_idx: usize, shares: u32 },
        Pause,
        Unpause,
        SetPrice(i128),
        SetTotalShares(u32),
    }

    fn arb_op() -> impl Strategy<Value = Op> {
        prop_oneof![
            4 => (0..NUM_BUYERS, 1..INIT_TOTAL / 4).prop_map(|(idx, s)| Op::BuyShares { buyer_idx: idx, shares: s }),
            1 => Just(Op::Pause),
            1 => Just(Op::Unpause),
            1 => (1i128..10_000i128).prop_map(Op::SetPrice),
            1 => (INIT_TOTAL..INIT_TOTAL * 5).prop_map(Op::SetTotalShares),
        ]
    }

    proptest! {
        /// Invariant: sum(all holder balances) + available == total at all times.
        #[test]
        fn test_contract_invariants(ops in prop::collection::vec(arb_op(), 1..30)) {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let token_id = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            let contract_id = env.register(RwaMarketplace, ());
            let client = RwaMarketplaceClient::new(&env, &contract_id);

            // Create buyers with sufficient funds
            let buyers: [Address; NUM_BUYERS] = core::array::from_fn(|_| Address::generate(&env));
            for b in buyers.iter() {
                token::StellarAssetClient::new(&env, &token_id).mint(b, &1_000_000_000);
            }

            client.init(&admin, &token_id, &INIT_PRICE, &INIT_TOTAL);

            let mut balances = [0u32; NUM_BUYERS];
            let mut available = INIT_TOTAL;
            let mut total = INIT_TOTAL;
            let mut paused = false;

            for op in ops {
                match op {
                    Op::BuyShares { buyer_idx, shares } => {
                        if paused || shares > available {
                            continue;
                        }
                        client.buy_shares(&buyers[buyer_idx], &shares);
                        balances[buyer_idx] += shares;
                        available -= shares;
                    }
                    Op::Pause => {
                        client.pause();
                        paused = true;
                    }
                    Op::Unpause => {
                        client.unpause();
                        paused = false;
                    }
                    Op::SetPrice(new_price) => {
                        if new_price <= 0 {
                            continue;
                        }
                        client.set_price(&new_price);
                    }
                    Op::SetTotalShares(new_total) => {
                        let issued = total - available;
                        if new_total < available || new_total < issued {
                            continue;
                        }
                        let new_available = new_total - issued;
                        client.set_total_shares(&new_total);
                        total = new_total;
                        available = new_available;
                    }
                }

                // Invariant: sum(balances) + available == total
                let sum_b: u32 = balances.iter().sum();
                prop_assert_eq!(
                    sum_b + available,
                    total,
                    "core invariant: sum(balances)={} + available={} != total={}",
                    sum_b, available, total
                );
                // Invariant: available never exceeds total
                prop_assert!(available <= total, "available={} > total={}", available, total);
                // Invariant: no balance exceeds total
                for &b in &balances {
                    prop_assert!(b <= total, "balance={} > total={}", b, total);
                }
                // On-chain state matches tracked state
                prop_assert_eq!(client.get_total_shares(), total);
                prop_assert_eq!(client.get_available_shares(), available);
                prop_assert_eq!(client.is_paused(), paused);
            }
        }

        /// Invariant: pause/unpause cycles toggle correctly.
        /// No buy_shares succeeds while paused.
        #[test]
        fn test_pause_unpause_cycles(pauses in prop::collection::vec(any::<bool>(), 1..20)) {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let token_id = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            let contract_id = env.register(RwaMarketplace, ());
            let client = RwaMarketplaceClient::new(&env, &contract_id);
            client.init(&admin, &token_id, &INIT_PRICE, &INIT_TOTAL);

            for should_pause in pauses {
                if should_pause {
                    client.pause();
                    prop_assert!(client.is_paused());
                } else {
                    client.unpause();
                    prop_assert!(!client.is_paused());
                }
            }
        }

        /// Invariant: for sequential buys by a single user,
        /// available + total_bought == INIT_TOTAL and
        /// total_shares remains unchanged.
        #[test]
        fn test_buy_sequences_invariant(buys in prop::collection::vec(1u32..200u32, 1..20)) {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let token_id = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            let contract_id = env.register(RwaMarketplace, ());
            let client = RwaMarketplaceClient::new(&env, &contract_id);

            let buyer = Address::generate(&env);
            token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &1_000_000_000);
            client.init(&admin, &token_id, &INIT_PRICE, &INIT_TOTAL);

            let mut total_bought = 0u32;

            for shares in buys {
                let available = client.get_available_shares();
                if shares > available {
                    continue;
                }
                client.buy_shares(&buyer, &shares);
                total_bought += shares;

                // available + total_bought == INIT_TOTAL
                prop_assert_eq!(
                    client.get_available_shares() + total_bought,
                    INIT_TOTAL,
                    "available={} + bought={} != {}",
                    client.get_available_shares(),
                    total_bought,
                    INIT_TOTAL
                );
                // holder balance matches total bought
                prop_assert_eq!(client.get_shares(&buyer), total_bought);
                // total_shares never changes
                prop_assert_eq!(client.get_total_shares(), INIT_TOTAL);
            }
        }
    }
}
// ====================== CONTRACT UPGRADEABILITY (#6) ======================

#[contracttype]
#[derive(Clone)]
pub struct ContractUpgraded {
    pub new_wasm_hash: BytesN<32>,
}

#[contractimpl]
impl RwaMarketplace {

    /// Upgrade the smart contract to a new version.
    /// Only the admin can call this function.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        // Verify admin
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");

        admin.require_auth();

        // Perform the upgrade
        env.deployer().upgrade_contract(new_wasm_hash.clone());

        // Emit upgrade event
        env.events().publish(
            (symbol_short!("Contract"), symbol_short!("Upgraded")),
            ContractUpgraded { new_wasm_hash },
        );
    }
}
