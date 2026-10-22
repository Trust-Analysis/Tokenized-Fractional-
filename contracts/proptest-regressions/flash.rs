#![no_std]

use soroban_sdk::{contract, contractimpl, contracterror, contracttype, contractevent, symbol_short, Address, Env, String, Vec, BytesN, panic_with_error};


// -- Error Codes --------------------------------------------------

#[contracterror]

#[derive(Copy, Clone, Debug, Eq, PartialEq)]

pub enum Error {

    NotAuthorized = 1,

    AlreadyInitialized = 2,

    NotInitialized = 3,

    AssetNotFound = 4,

    AssetAlreadyActive = 5,

    AssetAlreadyInactive = 6,

    AssetArchived = 7,

    InsufficientShares = 8,

    InvalidAmount = 9,

    InvalidPricingModel = 10,

    TokenNotAccepted = 11,

    TransferFailed = 12,

    AssetCountExhausted = 13,

    NameTooLong = 14,

    TreasuryNotSet = 15,

    InvalidCuratorSet = 16,

    InsufficientApprovals = 17,

    NotACurator = 18,

}


// -- Pricing Models -----------------------------------------------

#[contracttype]

#[derive(Clone, Debug, Eq, PartialEq)]

pub enum PricingModel {

    Fixed,

    Tiered,

    Auction,

    Dynamic,

}


// -- Asset Status -------------------------------------------------

#[contracttype]

#[derive(Clone, Debug, Eq, PartialEq)]

pub enum AssetStatus {

    Draft,

    Active,

    Paused,

    Archived,

}


// -- Asset Type ---------------------------------------------------

#[contracttype]

#[derive(Clone, Debug, Eq, PartialEq)]

pub enum AssetType {

    RealEstate,

    Agriculture,

    Commodities,

    Art,

    Debt,

    Equity,

    Other,

}


// -- Core Data Structures -----------------------------------------

#[contracttype]

#[derive(Clone, Debug)]

pub struct AssetInfo {

    pub asset_id: u64,

    pub name: String,

    pub asset_type: AssetType,

    pub metadata_uri: String,

    pub total_supply: u32,

    pub available_supply: u32,

    pub status: AssetStatus,

    pub pricing_model: PricingModel,

    pub payment_token: Address,

    pub treasury: Address,

    pub created_at: u64,

    pub updated_at: u64,

}


#[contracttype]

#[derive(Clone, Debug)]

pub struct AssetPricing {

    pub model: PricingModel,

    pub fixed_price: i128,

    pub tier_thresholds: Vec<i128>,

    pub tier_prices: Vec<i128>,

    pub reserve_price: i128,

}


#[contracttype]

#[derive(Clone, Debug)]

pub struct AssetRestrictions {

    pub requires_kyc: bool,

    pub min_investment: u32,

    pub max_per_investor: u32,

    pub restricted_jurisdictions: Vec<String>,

    pub transfer_lockup_days: u32,

    pub requires_accreditation: bool,

}


#[contracttype]

#[derive(Clone, Debug)]

pub struct AssetAnalytics {

    pub total_holders: u32,

    pub total_volume: i128,

    pub avg_price: i128,

    pub last_trade_at: u64,

    pub buy_count: u64,

    pub sell_count: u64,

}


#[contracttype]

#[derive(Clone, Debug)]

pub struct AssetTemplate {

    pub name: String,

    pub asset_type: AssetType,

    pub default_restrictions: AssetRestrictions,

    pub default_pricing_model: PricingModel,

}


// -- Storage Keys -------------------------------------------------

#[contracttype]

pub enum DataKey {

    Initialized,

    Admin,

    AssetCount,

    AssetInfo(u64),

    AssetPricing(u64),

    AssetRestrictions(u64),

    AssetAnalytics(u64),

    AssetBalance(u64, Address),

    AssetHolders(u64),

    AssetApproval(u64, Address, Address),

    Template(String),

    TemplateCount,

    OracleAddress,

    Curators,

}


// -- Events -------------------------------------------------------

#[contractevent(data_format = "vec")]

pub struct EventAssetRegistered {

    pub asset_id: u64,

    pub name: String,

    pub asset_type: AssetType,

    pub total_supply: u32,

    pub pricing_model: PricingModel,

}


#[contractevent(data_format = "vec")]

pub struct EventAssetUpdated {

    pub asset_id: u64,

    pub name: String,

    pub status: AssetStatus,

}


#[contractevent(data_format = "vec")]

pub struct EventAssetActivated {

    pub asset_id: u64,

}


#[contractevent(data_format = "vec")]

pub struct EventAssetDeactivated {

    pub asset_id: u64,

}


#[contractevent(data_format = "vec")]

pub struct EventAssetArchived {

    pub asset_id: u64,

}


#[contractevent(data_format = "vec")]

pub struct EventAssetPricingUpdated {

    pub asset_id: u64,

    pub model: PricingModel,

    pub fixed_price: i128,

}


#[contractevent(data_format = "vec")]

pub struct EventAssetSharesBought {

    pub asset_id: u64,

    pub buyer: Address,

    pub amount: u32,

    pub total_cost: i128,

}


#[contractevent(data_format = "vec")]

pub struct EventAssetSharesTransferred {

    pub asset_id: u64,

    pub from: Address,

    pub to: Address,

    pub amount: u32,

}


#[contractevent(data_format = "vec")]
pub struct EventReconstituted {

    pub asset_id: u64,

    pub owner: Address,

    pub burned_supply: u32,

}


#[contractevent(data_format = "vec")]

pub struct EventTemplateCreated {

    pub name: String,

    pub asset_type: AssetType,

}


// -- Helper Functions ---------------------------------------------

fn checked_add_u32(env: &Env, a: u32, b: u32) -> u32 {

    a.checked_add(b).unwrap_or_else(|| panic_with_error!(env, Error::InvalidAmount))

}


fn checked_sub_u32(env: &Env, a: u32, b: u32) -> u32 {

    a.checked_sub(b).unwrap_or_else(|| panic_with_error!(env, Error::InvalidAmount))

}


fn checked_mul_i128(env: &Env, a: i128, b: i128) -> i128 {

    a.checked_mul(b).unwrap_or_else(|| panic_with_error!(env, Error::InvalidAmount))

}


// -- Main Contract ------------------------------------------------

#[contract]

pub struct MultiAssetManager;


#[contractimpl]

impl MultiAssetManager {

    // -- Initialization ------------------------------------------

    pub fn init(env: Env, admin: Address) {

        admin.require_auth();

        if env.storage().instance().has(&DataKey::Initialized) {

            panic_with_error!(&env, Error::AlreadyInitialized);

        }

        env.storage().instance().set(&DataKey::Initialized, &true);

        env.storage().instance().set(&DataKey::Admin, &admin);

        env.storage().instance().set(&DataKey::AssetCount, &0u64);

        env.storage().instance().set(&DataKey::TemplateCount, &0u64);

    }


    pub fn is_initialized(env: Env) -> bool {

        env.storage().instance().has(&DataKey::Initialized)

    }


    pub fn get_admin(env: Env) -> Address {

        env.storage().instance().get(&DataKey::Admin)

            .expect("Contract not initialized")

    }


    // -- Multi-Sig Curators (Issue #595) -------------------------

    /// Designate the curator set used for the 2-of-3 minting approval

    /// workflow. Requires exactly three unique addresses; only the admin

    /// may change the set.

    pub fn set_curators(env: Env, curators: Vec<Address>) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        if curators.len() != 3 {

            panic_with_error!(&env, Error::InvalidCuratorSet);

        }


        // The 2-of-3 threshold is only meaningful if the three curators

        // are distinct addresses.

        let mut seen = Vec::<Address>::new(&env);

        for curator in curators.iter() {

            let mut duplicate = false;

            for existing in seen.iter() {

                if existing == curator {

                    duplicate = true;

                    break;

                }

            }

            if duplicate {

                panic_with_error!(&env, Error::InvalidCuratorSet);

            }

            seen.push_back(curator.clone());

        }


        env.storage().instance().set(&DataKey::Curators, &curators);

    }


    pub fn get_curators(env: Env) -> Vec<Address> {

        env.storage().instance().get(&DataKey::Curators)

            .expect("Curators not configured: call set_curators first")

    }


    /// Enforce the 2-of-3 multi-sig approval requirement for minting a new

    /// fractional asset. Every address in `approvers` must be a designated

    /// curator and must authorize the invocation (Soroban `require_auth`),

    /// and at least two distinct curators must approve. This rejects

    /// single-signature minting attempts before any asset is created.

    fn require_multisig_approval(env: &Env, approvers: &Vec<Address>) {

        let curators: Vec<Address> = env.storage().instance()

            .get(&DataKey::Curators)

            .expect("Curators not configured: call set_curators first");


        let mut distinct = Vec::<Address>::new(env);

        for approver in approvers.iter() {

            // Every signer must be a designated curator.

            let mut is_curator = false;

            for curator in curators.iter() {

                if curator == approver {

                    is_curator = true;

                    break;

                }

            }

            if !is_curator {

                panic_with_error!(env, Error::NotACurator);

            }


            // A single signer cannot satisfy the threshold twice, and

            // `require_auth` may only be invoked once per address per

            // invocation frame.

            let mut already_seen = false;

            for existing in distinct.iter() {

                if existing == approver {

                    already_seen = true;

                    break;

                }

            }

            if already_seen {

                continue;

            }


            distinct.push_back(approver.clone());


            // Require Soroban authorization from this curator so the

            // transaction must carry their signature.

            approver.require_auth();

        }


        if distinct.len() < 2 {

            panic_with_error!(env, Error::InsufficientApprovals);

        }

    }


    // -- Asset Registration --------------------------------------

    pub fn register_asset(

        env: Env,

        name: String,

        asset_type: AssetType,

        metadata_uri: String,

        total_supply: u32,

        pricing_model: PricingModel,

        fixed_price: i128,

        payment_token: Address,

        treasury: Address,

        approvers: Vec<Address>,

    ) -> u64 {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        // Multi-sig approval (Issue #595): at least 2-of-3 designated

        // curators must sign off before the fractional asset is minted.

        Self::require_multisig_approval(&env, &approvers);


        if total_supply == 0 {

            panic_with_error!(&env, Error::InvalidAmount);

        }

        if fixed_price <= 0 && pricing_model == PricingModel::Fixed {

            panic_with_error!(&env, Error::InvalidPricingModel);

        }


        let count: u64 = env.storage().instance().get(&DataKey::AssetCount).unwrap_or(0);

        let asset_id = count + 1;


        let now = env.ledger().timestamp();

        let info = AssetInfo {

            asset_id,

            name: name.clone(),

            asset_type: asset_type.clone(),

            metadata_uri: metadata_uri.clone(),

            total_supply,

            available_supply: total_supply,

            status: AssetStatus::Draft,

            pricing_model: pricing_model.clone(),

            payment_token: payment_token.clone(),

            treasury: treasury.clone(),

            created_at: now,

            updated_at: now,

        };


        let pricing = AssetPricing {

            model: pricing_model.clone(),

            fixed_price,

            tier_thresholds: Vec::new(&env),

            tier_prices: Vec::new(&env),

            reserve_price: 0,

        };


        let restrictions = AssetRestrictions {

            requires_kyc: false,

            min_investment: 1,

            max_per_investor: 0,

            restricted_jurisdictions: Vec::new(&env),

            transfer_lockup_days: 0,

            requires_accreditation: false,

        };


        let analytics = AssetAnalytics {

            total_holders: 0,

            total_volume: 0,

            avg_price: 0,

            last_trade_at: 0,

            buy_count: 0,

            sell_count: 0,

        };


        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &info);

        env.storage().persistent().set(&DataKey::AssetPricing(asset_id), &pricing);

        env.storage().persistent().set(&DataKey::AssetRestrictions(asset_id), &restrictions);

        env.storage().persistent().set(&DataKey::AssetAnalytics(asset_id), &analytics);

        env.storage().persistent().set(&DataKey::AssetHolders(asset_id), &Vec::<Address>::new(&env));


        env.storage().instance().set(&DataKey::AssetCount, &asset_id);


        EventAssetRegistered {

            asset_id,

            name,

            asset_type,

            total_supply,

            pricing_model,

        }.publish(&env);


        asset_id

    }


    // -- Asset Queries -------------------------------------------

    pub fn get_asset(env: Env, asset_id: u64) -> Option<AssetInfo> {

        env.storage().persistent().get(&DataKey::AssetInfo(asset_id))

    }


    pub fn get_asset_pricing(env: Env, asset_id: u64) -> Option<AssetPricing> {

        env.storage().persistent().get(&DataKey::AssetPricing(asset_id))

    }


    pub fn get_asset_restrictions(env: Env, asset_id: u64) -> Option<AssetRestrictions> {

        env.storage().persistent().get(&DataKey::AssetRestrictions(asset_id))

    }


    pub fn get_asset_analytics(env: Env, asset_id: u64) -> Option<AssetAnalytics> {

        env.storage().persistent().get(&DataKey::AssetAnalytics(asset_id))

    }


    pub fn get_asset_count(env: Env) -> u64 {

        env.storage().instance().get(&DataKey::AssetCount).unwrap_or(0)

    }


    // -- Asset Lifecycle Management ------------------------------

    pub fn update_asset_metadata(env: Env, asset_id: u64, name: String, metadata_uri: String) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        let mut info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        info.name = name.clone();

        info.metadata_uri = metadata_uri.clone();

        info.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &info);

    }


    pub fn update_asset_restrictions(env: Env, asset_id: u64, restrictions: AssetRestrictions) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        let _info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        env.storage().persistent().set(&DataKey::AssetRestrictions(asset_id), &restrictions);

    }


    pub fn activate_asset(env: Env, asset_id: u64) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        let mut info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        if info.status == AssetStatus::Active {

            panic_with_error!(&env, Error::AssetAlreadyActive);

        }

        if info.status == AssetStatus::Archived {

            panic_with_error!(&env, Error::AssetArchived);

        }


        info.status = AssetStatus::Active;

        info.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &info);


        EventAssetActivated { asset_id }.publish(&env);

    }


    pub fn deactivate_asset(env: Env, asset_id: u64) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        let mut info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        if info.status != AssetStatus::Active {

            panic_with_error!(&env, Error::AssetAlreadyInactive);

        }


        info.status = AssetStatus::Paused;

        info.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &info);


        EventAssetDeactivated { asset_id }.publish(&env);

    }


    pub fn archive_asset(env: Env, asset_id: u64) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        let mut info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        info.status = AssetStatus::Archived;

        info.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &info);


        EventAssetArchived { asset_id }.publish(&env);

    }


    pub fn update_pricing(

        env: Env,

        asset_id: u64,

        model: PricingModel,

        fixed_price: i128,

        tier_thresholds: Vec<i128>,

        tier_prices: Vec<i128>,

        reserve_price: i128,

    ) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        let mut info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        let pricing = AssetPricing { model: model.clone(), fixed_price, tier_thresholds, tier_prices, reserve_price };

        env.storage().persistent().set(&DataKey::AssetPricing(asset_id), &pricing);

        info.pricing_model = model.clone();

        info.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &info);


        EventAssetPricingUpdated { asset_id, model, fixed_price }.publish(&env);

    }


    // -- Buy / Transfer Shares -----------------------------------

    pub fn buy_asset_shares(env: Env, asset_id: u64, buyer: Address, amount: u32) {

        buyer.require_auth();


        if amount == 0 {

            panic_with_error!(&env, Error::InvalidAmount);

        }


        let info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        if info.status != AssetStatus::Active {

            panic_with_error!(&env, Error::AssetArchived);

        }


        if amount > info.available_supply {

            panic_with_error!(&env, Error::InsufficientShares);

        }


        let pricing: AssetPricing = env.storage().persistent()

            .get(&DataKey::AssetPricing(asset_id))

            .expect("Pricing not found");


        let total_cost = checked_mul_i128(&env, pricing.fixed_price, amount as i128);


        // Transfer payment from buyer to treasury

        let client = soroban_sdk::token::Client::new(&env, &info.payment_token);

        client.transfer(&buyer, &info.treasury, &total_cost);


        // Update supplies

        let mut updated_info = info.clone();

        updated_info.available_supply = checked_sub_u32(&env, updated_info.available_supply, amount);

        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &updated_info);


        // Update buyer balance

        let prev_balance: u32 = env.storage().persistent()

            .get(&DataKey::AssetBalance(asset_id, buyer.clone()))

            .unwrap_or(0);

        let new_balance = checked_add_u32(&env, prev_balance, amount);

        env.storage().persistent().set(&DataKey::AssetBalance(asset_id, buyer.clone()), &new_balance);


        // Register holder if new

        let mut holders: Vec<Address> = env.storage().persistent()

            .get(&DataKey::AssetHolders(asset_id))

            .unwrap_or_else(|| Vec::new(&env));

        let mut is_new_holder = true;

        for h in holders.iter() {

            if h == buyer {

                is_new_holder = false;

                break;

            }

        }

        if is_new_holder {

            holders.push_back(buyer.clone());

            env.storage().persistent().set(&DataKey::AssetHolders(asset_id), &holders);

        }


        // Update analytics

        let mut analytics: AssetAnalytics = env.storage().persistent()

            .get(&DataKey::AssetAnalytics(asset_id))

            .expect("Analytics not found");

        analytics.total_holders = if is_new_holder { analytics.total_holders + 1 } else { analytics.total_holders };

        analytics.total_volume = analytics.total_volume.saturating_add(total_cost);

        analytics.avg_price = analytics.total_volume / (analytics.buy_count + 1).max(1) as i128;

        analytics.last_trade_at = env.ledger().timestamp();

        analytics.buy_count += 1;

        env.storage().persistent().set(&DataKey::AssetAnalytics(asset_id), &analytics);


        EventAssetSharesBought { asset_id, buyer, amount, total_cost }.publish(&env);

    }


    pub fn get_asset_balance(env: Env, asset_id: u64, owner: Address) -> u32 {

        env.storage().persistent()

            .get(&DataKey::AssetBalance(asset_id, owner))

            .unwrap_or(0)

    }


    /// Burn all fractions when one owner has acquired the complete supply and
    /// permanently lock the asset for reconstitution.
    pub fn burn_and_reconstitute(env: Env, asset_id: u64, owner: Address) {

        owner.require_auth();

        let mut info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");

        if info.status != AssetStatus::Active {

            panic_with_error!(&env, Error::AssetArchived);

        }

        let balance: u32 = env.storage().persistent()

            .get(&DataKey::AssetBalance(asset_id, owner.clone()))

            .unwrap_or(0);

        if info.available_supply != 0 || balance != info.total_supply {

            panic_with_error!(&env, Error::InsufficientShares);

        }

        let burned_supply = info.total_supply;

        env.storage().persistent().set(&DataKey::AssetBalance(asset_id, owner.clone()), &0u32);

        info.total_supply = 0;
        info.available_supply = 0;
        info.status = AssetStatus::Archived;
        info.updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::AssetInfo(asset_id), &info);

        EventReconstituted { asset_id, owner, burned_supply }.publish(&env);

    }


    pub fn transfer_asset_shares(env: Env, asset_id: u64, from: Address, to: Address, amount: u32) {

        from.require_auth();


        if amount == 0 {

            panic_with_error!(&env, Error::InvalidAmount);

        }


        let info = env.storage().persistent()

            .get::<DataKey, AssetInfo>(&DataKey::AssetInfo(asset_id))

            .expect("Asset not found");


        if info.status != AssetStatus::Active {

            panic_with_error!(&env, Error::AssetArchived);

        }


        let restrictions: AssetRestrictions = env.storage().persistent()

            .get(&DataKey::AssetRestrictions(asset_id))

            .expect("Restrictions not found");


        // Check lockup

        if restrictions.transfer_lockup_days > 0 {

            let analytics: AssetAnalytics = env.storage().persistent()

                .get(&DataKey::AssetAnalytics(asset_id))

                .expect("Analytics not found");

            let lockup_seconds = (restrictions.transfer_lockup_days as u64) * 86400;

            if analytics.last_trade_at > 0 && env.ledger().timestamp() < analytics.last_trade_at.saturating_add(lockup_seconds) {

                panic_with_error!(&env, Error::NotAuthorized);

            }

        }


        let from_balance: u32 = env.storage().persistent()

            .get(&DataKey::AssetBalance(asset_id, from.clone()))

            .unwrap_or(0);


        if amount > from_balance {

            panic_with_error!(&env, Error::InsufficientShares);

        }


        let new_from = checked_sub_u32(&env, from_balance, amount);

        let to_balance: u32 = env.storage().persistent()

            .get(&DataKey::AssetBalance(asset_id, to.clone()))

            .unwrap_or(0);

        let new_to = checked_add_u32(&env, to_balance, amount);


        env.storage().persistent().set(&DataKey::AssetBalance(asset_id, from.clone()), &new_from);

        env.storage().persistent().set(&DataKey::AssetBalance(asset_id, to.clone()), &new_to);


        EventAssetSharesTransferred { asset_id, from, to, amount }.publish(&env);

    }


    // -- Asset Listing -------------------------------------------

    pub fn list_assets(env: Env, start: u64, limit: u32) -> Vec<AssetInfo> {

        let count = Self::get_asset_count(env.clone());

        let mut result: Vec<AssetInfo> = Vec::new(&env);

        let end = core::cmp::min(count, start.saturating_add(limit as u64));

        let mut i = start;

        while i < end {

            if let Some(info) = env.storage().persistent().get::<DataKey, AssetInfo>(&DataKey::AssetInfo(i + 1)) {

                result.push_back(info);

            }

            i += 1;

        }

        result

    }


    pub fn list_assets_by_status(env: Env, status: AssetStatus, start: u64, limit: u32) -> Vec<AssetInfo> {

        let count = Self::get_asset_count(env.clone());

        let mut result: Vec<AssetInfo> = Vec::new(&env);

        let mut i: u64 = 1;

        let mut collected: u32 = 0;

        let mut to_skip = start;


        while i <= count && collected < limit {

            if let Some(info) = env.storage().persistent().get::<DataKey, AssetInfo>(&DataKey::AssetInfo(i)) {

                if info.status == status {

                    if to_skip > 0 {

                        to_skip -= 1;

                        } else {

                        result.push_back(info);

                        collected += 1;

                    }

                }

            }

            i += 1;

        }

        result

    }


    // -- Asset Templates -----------------------------------------

    pub fn create_template(env: Env, name: String, asset_type: AssetType, restrictions: AssetRestrictions, default_pricing: PricingModel) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();


        let template = AssetTemplate {

            name: name.clone(),

            asset_type: asset_type.clone(),

            default_restrictions: restrictions,

            default_pricing_model: default_pricing,

        };


        env.storage().persistent().set(&DataKey::Template(name.clone()), &template);


        EventTemplateCreated { name, asset_type }.publish(&env);

    }


    pub fn get_template(env: Env, name: String) -> Option<AssetTemplate> {

        env.storage().persistent().get(&DataKey::Template(name))

    }


    // -- Oracle Integration --------------------------------------

    pub fn set_oracle(env: Env, oracle: Address) {

        let admin: Address = Self::get_admin(env.clone());

        admin.require_auth();

        env.storage().instance().set(&DataKey::OracleAddress, &oracle);

    }


    pub fn get_oracle(env: Env) -> Option<Address> {

        env.storage().instance().get(&DataKey::OracleAddress)

    }

}


// -- Tests --------------------------------------------------------

#[cfg(test)]

mod tests {

    use super::*;

    use soroban_sdk::testutils::Address as _;    // `#![no_std]` crate: link `std` in the test build so `format!` works.

    extern crate std;

    use std::format;


    fn setup() -> (Env, Address, MultiAssetManagerClient<'static>) {

        let env = Env::default();

        // Admin-only functions call `require_auth`; the test env must mock
        // authorization the same way the main contract's tests do.

        env.mock_all_auths();

        let admin = Address::generate(&env);

        let contract_id = env.register(MultiAssetManager, ());

        let client = MultiAssetManagerClient::new(&env, &contract_id);

        client.init(&admin);

        (env, admin, client)

    }


    /// Build a `Vec<Address>` of approvers for the 2-of-3 multi-sig check.

    fn approval_vec(env: &Env, addresses: &[&Address]) -> Vec<Address> {

        let mut result = Vec::new(env);

        for address in addresses {

            result.push_back((*address).clone());

        }

        result

    }


    /// `setup()` plus the three designated curators required by the

    /// multi-sig minting workflow (Issue #595).

    fn setup_with_curators() -> (Env, Address, MultiAssetManagerClient<'static>, Address, Address, Address) {

        let (env, admin, client) = setup();

        let c1 = Address::generate(&env);

        let c2 = Address::generate(&env);

        let c3 = Address::generate(&env);

        let curators = approval_vec(&env, &[&c1, &c2, &c3]);

        client.set_curators(&curators);

        (env, admin, client, c1, c2, c3)

    }


    #[test]

    fn test_init() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        assert!(client.is_initialized());

        assert_eq!(client.get_admin(), admin);

        assert_eq!(client.get_asset_count(), 0);

    }


    #[test]

    #[should_panic(expected = "Error(Contract, #2)")]

    fn test_double_init() {

        let env = Env::default();

        env.mock_all_auths();

        let admin = Address::generate(&env);

        let contract_id = env.register(MultiAssetManager, ());

        let client = MultiAssetManagerClient::new(&env, &contract_id);

        client.init(&admin);

        client.init(&admin);

    }


    #[test]

    fn test_register_and_query_asset() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);


        let name = String::from_str(&env, "Luxury Tower Fund");

        let metadata = String::from_str(&env, "ipfs://QmXyZ123");

        let asset_type = AssetType::RealEstate;

        let pricing_model = PricingModel::Fixed;


        let approvers = approval_vec(&env, &[&c1, &c2]);

        let asset_id = client.register_asset(

            &name,

            &asset_type,

            &metadata,

            &10000u32,

            &pricing_model,

            &100i128,

            &payment_token,

            &treasury,

            &approvers,

        );


        assert_eq!(asset_id, 1);

        assert_eq!(client.get_asset_count(), 1);


        let info = client.get_asset(&1).unwrap();

        assert_eq!(info.name, name);

        assert_eq!(info.total_supply, 10000);

        assert_eq!(info.available_supply, 10000);

        assert_eq!(info.status, AssetStatus::Draft);


        let pricing = client.get_asset_pricing(&1).unwrap();

        assert_eq!(pricing.fixed_price, 100);

        assert_eq!(pricing.model, PricingModel::Fixed);

    }


    #[test]

    fn test_register_multiple_assets() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);


        for i in 1..=3 {

            let name = String::from_str(&env, &format!("Asset {}", i));

            let meta = String::from_str(&env, &format!("meta{}", i));

            let approvers = approval_vec(&env, &[&c1, &c2]);

            let asset_id = client.register_asset(

                &name,

                &AssetType::Agriculture,

                &meta,

                &5000u32,

                &PricingModel::Fixed,

                &50i128,

                &payment_token,

                &treasury,

                &approvers,

            );

            assert_eq!(asset_id, i as u64);

        }

        assert_eq!(client.get_asset_count(), 3);


        let list = client.list_assets(&0, &10);

        assert_eq!(list.len(), 3);

    }


    #[test]

    fn test_asset_lifecycle() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        let name = String::from_str(&env, "Green Bond");

        let meta = String::from_str(&env, "ipfs://bond");

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(&name, &AssetType::Debt, &meta, &1000u32, &PricingModel::Fixed, &200i128, &payment_token, &treasury, &approvers);


        // Draft -> Active

        client.activate_asset(&id);

        let info = client.get_asset(&id).unwrap();

        assert_eq!(info.status, AssetStatus::Active);


        // Active -> Paused

        client.deactivate_asset(&id);

        let info = client.get_asset(&id).unwrap();

        assert_eq!(info.status, AssetStatus::Paused);


        // Paused -> Active again

        client.activate_asset(&id);

        let info = client.get_asset(&id).unwrap();

        assert_eq!(info.status, AssetStatus::Active);


        // Active -> Archived (one-way)

        client.archive_asset(&id);

        let info = client.get_asset(&id).unwrap();

        assert_eq!(info.status, AssetStatus::Archived);

    }


    #[test]

    fn test_update_pricing() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        let name = String::from_str(&env, "Dynamic Asset");

        let meta = String::from_str(&env, "ipfs://dyn");

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(&name, &AssetType::Equity, &meta, &500u32, &PricingModel::Fixed, &100i128, &payment_token, &treasury, &approvers);


        let thresholds = Vec::new(&env);

        let prices = Vec::new(&env);

        client.update_pricing(&id, &PricingModel::Auction, &0i128, &thresholds, &prices, &50i128);


        let pricing = client.get_asset_pricing(&id).unwrap();

        assert_eq!(pricing.model, PricingModel::Auction);

        assert_eq!(pricing.reserve_price, 50);

    }


    #[test]

    fn test_buy_asset_shares() {        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        // Deploy a real Stellar Asset Contract so `StellarAssetClient::mint`

        // and the contract's token `transfer` calls succeed.

        let payment_token = env.register_stellar_asset_contract(admin.clone());

        let treasury = Address::generate(&env);

        // Register asset

        let name = String::from_str(&env, "Test Asset");

        let meta = String::from_str(&env, "ipfs://test");

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(&name, &AssetType::RealEstate, &meta, &1000u32, &PricingModel::Fixed, &50i128, &payment_token, &treasury, &approvers);


        // Activate

        client.activate_asset(&id);


        // Setup the buyer with tokens

        let buyer = Address::generate(&env);

        let sac = soroban_sdk::token::StellarAssetClient::new(&env, &payment_token);
        sac.mint(&buyer, &100000i128);


        // Buy shares

        client.buy_asset_shares(&id, &buyer, &100);


        let balance = client.get_asset_balance(&id, &buyer);

        assert_eq!(balance, 100);


        let info = client.get_asset(&id).unwrap();

        assert_eq!(info.available_supply, 900);


        let analytics = client.get_asset_analytics(&id).unwrap();

        assert_eq!(analytics.total_holders, 1);

        assert_eq!(analytics.buy_count, 1);

        assert!(analytics.total_volume > 0);

    }


    #[test]

    fn test_burn_and_reconstitute() {

        let (env, _admin, client, c1, c2, _c3) = setup_with_curators();

        // Deploy a real Stellar Asset Contract so `StellarAssetClient::mint`

        // and the contract's token `transfer` calls succeed.

        let payment_token = env.register_stellar_asset_contract(_admin.clone());

        let treasury = Address::generate(&env);

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(
            &String::from_str(&env, "Reconstitutable Asset"),
            &AssetType::RealEstate,
            &String::from_str(&env, "ipfs://reconstitute"),
            &100u32,
            &PricingModel::Fixed,
            &50i128,
            &payment_token,
            &treasury,
            &approvers,
        );

        client.activate_asset(&id);

        let owner = Address::generate(&env);

        soroban_sdk::token::StellarAssetClient::new(&env, &payment_token).mint(&owner, &5000i128);

        client.buy_asset_shares(&id, &owner, &100);
        client.burn_and_reconstitute(&id, &owner);

        assert_eq!(client.get_asset_balance(&id, &owner), 0);

        let info = client.get_asset(&id).unwrap();

        assert_eq!(info.total_supply, 0);

        assert_eq!(info.available_supply, 0);

        assert_eq!(info.status, AssetStatus::Archived);

    }


    #[test]

    #[should_panic(expected = "Error(Contract, #8)")]

    fn test_burn_and_reconstitute_requires_full_supply() {

        let (env, _admin, client, c1, c2, _c3) = setup_with_curators();

        // Deploy a real Stellar Asset Contract so `StellarAssetClient::mint`

        // and the contract's token `transfer` calls succeed.

        let payment_token = env.register_stellar_asset_contract(_admin.clone());

        let treasury = Address::generate(&env);

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(
            &String::from_str(&env, "Partially Owned Asset"),
            &AssetType::RealEstate,
            &String::from_str(&env, "ipfs://partial"),
            &100u32,
            &PricingModel::Fixed,
            &50i128,
            &payment_token,
            &treasury,
            &approvers,
        );

        client.activate_asset(&id);

        let owner = Address::generate(&env);

        soroban_sdk::token::StellarAssetClient::new(&env, &payment_token).mint(&owner, &5000i128);

        client.buy_asset_shares(&id, &owner, &99);
        client.burn_and_reconstitute(&id, &owner);

    }


    #[test]

    fn test_transfer_asset_shares() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        // Deploy a real Stellar Asset Contract so `StellarAssetClient::mint`

        // and the contract's token `transfer` calls succeed.

        let payment_token = env.register_stellar_asset_contract(admin.clone());

        let treasury = Address::generate(&env);

        let name = String::from_str(&env, "Transferable Asset");

        let meta = String::from_str(&env, "ipfs://transfer");

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(&name, &AssetType::RealEstate, &meta, &1000u32, &PricingModel::Fixed, &50i128, &payment_token, &treasury, &approvers);

        client.activate_asset(&id);


        let buyer = Address::generate(&env);

        let sac = soroban_sdk::token::StellarAssetClient::new(&env, &payment_token);
        sac.mint(&buyer, &100000i128);

        client.buy_asset_shares(&id, &buyer, &200);


        let recipient = Address::generate(&env);

        client.transfer_asset_shares(&id, &buyer, &recipient, &50);


        assert_eq!(client.get_asset_balance(&id, &buyer), 150);

        assert_eq!(client.get_asset_balance(&id, &recipient), 50);

    }


    #[test]

    fn test_asset_restrictions() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        let name = String::from_str(&env, "KYC Asset");

        let meta = String::from_str(&env, "ipfs://kyc");

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(&name, &AssetType::Equity, &meta, &1000u32, &PricingModel::Fixed, &100i128, &payment_token, &treasury, &approvers);


        let restricted = AssetRestrictions {

            requires_kyc: true,

            min_investment: 10,

            max_per_investor: 500,

            restricted_jurisdictions: Vec::new(&env),

            transfer_lockup_days: 90,

            requires_accreditation: true,

        };


        client.update_asset_restrictions(&id, &restricted);


        let result = client.get_asset_restrictions(&id).unwrap();

        assert!(result.requires_kyc);

        assert_eq!(result.min_investment, 10);

        assert_eq!(result.max_per_investor, 500);

        assert_eq!(result.transfer_lockup_days, 90);

    }


    #[test]

    fn test_templates() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        let name = String::from_str(&env, "RealEstateTemplate");

        let restrictions = AssetRestrictions {

            requires_kyc: true,

            min_investment: 1,

            max_per_investor: 0,

            restricted_jurisdictions: Vec::new(&env),

            transfer_lockup_days: 0,

            requires_accreditation: false,

        };


        client.create_template(&name, &AssetType::RealEstate, &restrictions, &PricingModel::Fixed);


        let template = client.get_template(&name).unwrap();

        assert_eq!(template.name, name);

        assert_eq!(template.asset_type, AssetType::RealEstate);

        assert_eq!(template.default_pricing_model, PricingModel::Fixed);

        assert!(template.default_restrictions.requires_kyc);

    }


    #[test]

    fn test_list_by_status() {

        let (env, admin, client, c1, c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);


        // Create assets with different statuses

        for i in 1..=4 {

            let name = String::from_str(&env, &format!("Asset {}", i));

            let meta = String::from_str(&env, &format!("meta{}", i));

            let approvers = approval_vec(&env, &[&c1, &c2]);

            let id = client.register_asset(&name, &AssetType::Other, &meta, &100u32, &PricingModel::Fixed, &10i128, &payment_token, &treasury, &approvers);

            if i % 2 == 0 {

                client.activate_asset(&id);

            }

        }


        let active = client.list_assets_by_status(&AssetStatus::Active, &0, &10);

        assert_eq!(active.len(), 2);


        let draft = client.list_assets_by_status(&AssetStatus::Draft, &0, &10);

        assert_eq!(draft.len(), 2);

    }


    // -- Multi-Sig Approval Tests (Issue #595) --------------------

    #[test]

    fn test_register_asset_two_of_three_success() {

        let (env, _admin, client, c1, c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        let approvers = approval_vec(&env, &[&c1, &c2]);

        let id = client.register_asset(

            &String::from_str(&env, "Two-Sig Asset"),

            &AssetType::RealEstate,

            &String::from_str(&env, "ipfs://two-sig"),

            &100u32,

            &PricingModel::Fixed,

            &50i128,

            &payment_token,

            &treasury,

            &approvers,

        );

        assert_eq!(id, 1);

        let info = client.get_asset(&1).unwrap();

        assert_eq!(info.total_supply, 100);

        assert_eq!(info.status, AssetStatus::Draft);

    }


    #[test]

    fn test_register_asset_three_of_three_success() {

        let (env, _admin, client, c1, c2, c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        let approvers = approval_vec(&env, &[&c1, &c2, &c3]);

        let id = client.register_asset(

            &String::from_str(&env, "Three-Sig Asset"),

            &AssetType::Commodities,

            &String::from_str(&env, "ipfs://three-sig"),

            &500u32,

            &PricingModel::Fixed,

            &25i128,

            &payment_token,

            &treasury,

            &approvers,

        );

        assert_eq!(id, 1);

    }


    #[test]

    #[should_panic(expected = "Error(Contract, #17)")]

    fn test_register_asset_rejects_single_signature() {

        let (env, _admin, client, c1, _c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        // Only one curator approves -> minting must be rejected.

        let approvers = approval_vec(&env, &[&c1]);

        client.register_asset(

            &String::from_str(&env, "Single-Sig Asset"),

            &AssetType::Art,

            &String::from_str(&env, "ipfs://single-sig"),

            &100u32,

            &PricingModel::Fixed,

            &10i128,

            &payment_token,

            &treasury,

            &approvers,

        );

    }


    #[test]

    #[should_panic(expected = "Error(Contract, #17)")]

    fn test_register_asset_rejects_duplicate_single_signer() {

        let (env, _admin, client, c1, _c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        // The same curator listed twice must not count as two approvals.

        let approvers = approval_vec(&env, &[&c1, &c1]);

        client.register_asset(

            &String::from_str(&env, "Dup-Sig Asset"),

            &AssetType::Debt,

            &String::from_str(&env, "ipfs://dup-sig"),

            &100u32,

            &PricingModel::Fixed,

            &10i128,

            &payment_token,

            &treasury,

            &approvers,

        );

    }


    #[test]

    #[should_panic(expected = "Error(Contract, #18)")]

    fn test_register_asset_rejects_non_curator_signer() {

        let (env, _admin, client, c1, _c2, _c3) = setup_with_curators();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        let outsider = Address::generate(&env);

        // A curator plus an address outside the designated set must fail.

        let approvers = approval_vec(&env, &[&c1, &outsider]);

        client.register_asset(

            &String::from_str(&env, "Outsider Asset"),

            &AssetType::Equity,

            &String::from_str(&env, "ipfs://outsider"),

            &100u32,

            &PricingModel::Fixed,

            &10i128,

            &payment_token,

            &treasury,

            &approvers,

        );

    }


    #[test]

    #[should_panic(expected = "Error(Contract, #16)")]

    fn test_set_curators_requires_exactly_three() {

        let (env, _admin, client, c1, c2, _c3) = setup_with_curators();

        // Attempting to reconfigure with only two curators is invalid.

        let curators = approval_vec(&env, &[&c1, &c2]);

        client.set_curators(&curators);

    }


    #[test]

    #[should_panic(expected = "Error(Contract, #16)")]

    fn test_set_curators_rejects_duplicates() {

        let (env, _admin, client, c1, _c2, _c3) = setup_with_curators();

        let c4 = Address::generate(&env);

        let curators = approval_vec(&env, &[&c1, &c1, &c4]);

        client.set_curators(&curators);

    }


    #[test]

    #[should_panic(expected = "Curators not configured")]

    fn test_register_asset_requires_curator_setup() {

        let (env, _admin, client) = setup();

        let payment_token = Address::generate(&env);

        let treasury = Address::generate(&env);

        let approvers = approval_vec(&env, &[&treasury]);

        client.register_asset(

            &String::from_str(&env, "No Curators"),

            &AssetType::Other,

            &String::from_str(&env, "ipfs://no-curators"),

            &100u32,

            &PricingModel::Fixed,

            &10i128,

            &payment_token,

            &treasury,

            &approvers,

        );

    }

}

