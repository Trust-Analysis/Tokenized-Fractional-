#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
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
    Holders, // ← NEW: registry of all unique holder addresses
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
            .unwrap();

        if shares > available {
            panic!("Not enough shares available for purchase");
        }

        if shares == 0 {
            panic!("Must purchase at least 1 share");
        }

        let price: i128 = env.storage().instance().get(&DataKey::PricePerShare).unwrap();
        let total_cost = checked_mul_i128(price, shares as i128);

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .unwrap();

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

        // Register as new holder only on first purchase (prev_balance was 0)
        if prev_balance == 0 {
            let mut holders: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::Holders)
                .unwrap_or_else(|| Vec::new(&env));
            holders.push_back(buyer.clone());
            env.storage().instance().set(&DataKey::Holders, &holders);
        }

        EventBuyShares { buyer, shares, total_cost }.publish(&env);
    }

    /// Distribute `total_amount` of `token` pro-rata among all current holders
    /// based on their share count relative to total issued shares.
    ///
    /// Only the admin may call this. The contract must hold enough `token`
    /// balance to cover `total_amount` before calling.
    pub fn distribute_dividends(env: Env, token: Address, total_amount: i128) {
        // Only admin can distribute
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if total_amount <= 0 {
            panic!("Dividend amount must be positive");
        }

        let total_shares: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap();

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

    /// Returns the current list of registered holders.
    pub fn get_holders(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Holders)
            .unwrap_or_else(|| Vec::new(&env))
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
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        EventPause {}.publish(&env);
    }

    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        EventUnpause {}.publish(&env);
    }

    pub fn emergency_withdraw(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .unwrap();

        let client = token::TokenClient::new(&env, &token_id);
        client.transfer(&env.current_contract_address(), &to, &amount);

        EventEmergencyWithdraw { to, amount }.publish(&env);
    }

    /// Update the per-share price. Only the admin may call this.
    pub fn set_price(env: Env, new_price: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if new_price <= 0 {
            panic!("Price must be positive");
        }

        let old_price: i128 = env.storage().instance().get(&DataKey::PricePerShare).unwrap();
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
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let total_shares: u32 = env.storage().instance().get(&DataKey::TotalShares).unwrap();
        let available_shares: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .unwrap();

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
    use soroban_sdk::{testutils::Address as _, token, Env};

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
    fn test_buy_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100000);

        c.buy_shares(&te.buyer, &25);
        assert_eq!(c.get_shares(&te.buyer), 25);
        assert_eq!(c.get_available_shares(), 975);
    }

    #[test]
    fn test_multiple_buys() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100000);

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

    // Test successful operations with large but safe values
    #[test]
    fn test_large_price_multiplication_safe() {
        let te = setup();
        let c = client(&te);
        // Use large but safe price and shares
        c.init(&te.admin, &te.token_id, &1_000_000_000_000_i128, &1000);
        mint(&te, &te.buyer, 100_000_000_000_000_i128);
        
        // 1_000_000_000_000 * 100 = 100_000_000_000_000 (safe, well below i128::MAX)
        c.buy_shares(&te.buyer, &100);
        assert_eq!(c.get_shares(&te.buyer), 100);
        assert_eq!(c.get_available_shares(), 900);
    }

    #[test]
    fn test_large_dividend_multiplication_safe() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        
        c.buy_shares(&te.buyer, &500); // buyer owns 50%
        
        let dividend_amount: i128 = 100_000_000_000; // Large but safe
        mint(&te, &te.contract_id, dividend_amount);
        
        // Should safely compute 100_000_000_000 * 500 / 1000 = 50_000_000_000
        c.distribute_dividends(&te.token_id, &dividend_amount);
        
        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        let expected = 100_000 - 500 * 100 + 50_000_000_000;
        assert_eq!(token_client.balance(&te.buyer), expected);
    }

    #[test]
    fn test_checked_math_with_max_u32_values() {
        let te = setup();
        let c = client(&te);
        // Test with maximum u32 values for safe operations
        let max_shares = u32::MAX - 100;
        c.init(&te.admin, &te.token_id, &100, &max_shares);
        mint(&te, &te.buyer, i128::MAX);
        
        // Buying small number of shares from large pool should work safely
        c.buy_shares(&te.buyer, &50);
        assert_eq!(c.get_shares(&te.buyer), 50);
        assert_eq!(c.get_available_shares(), max_shares - 50);
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
