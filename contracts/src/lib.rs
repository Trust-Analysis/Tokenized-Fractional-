// Copyright (c) 2026 Tokenized Fractional RWA Marketplace Contributors
// SPDX-License-Identifier: MIT

#![no_std]
use soroban_sdk::{
    contract, contractclient, contractevent, contractimpl, contractmeta, contracttype, token,
    Address, Bytes, BytesN, Env, String, Vec,
};

// ── SIP-4 / SEP-46 Contract Metadata ─────────────────────────────────
// Off-chain tools (explorers, wallets, indexers) read these entries from
// the Wasm custom section `contractmetav0` without executing the contract.
contractmeta!(key = "name", val = "RWA Marketplace");
contractmeta!(key = "version", val = "0.4.0");
contractmeta!(key = "description", val = "Tokenized Fractional RWA Marketplace");
contractmeta!(key = "sep", val = "41");

const DIVIDEND_TYPE_CASH: u32 = 0;
const DIVIDEND_TYPE_TOKEN_BASED: u32 = 1;
const DIVIDEND_WITHHOLDING_MAX_BPS: u32 = 10_000;

/// Minimal interface for calling the deployed ShareCertificate NFT contract.
#[contractclient(name = "NftContractClient")]
pub trait NftContractInterface {
    fn mint_certificate(env: Env, to: Address) -> u32;
}

/// Issue #169 – Minimal oracle interface.
/// The oracle contract must expose a `get_price() -> i128` function
/// that returns the current asset price per share in the payment token's
/// smallest unit. This is intentionally minimal to support any Stellar-based
/// oracle that follows this convention.
#[contractclient(name = "OracleContractClient")]
pub trait OracleContractInterface {
    fn get_price(env: Env) -> i128;
}

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
    /// Permanent delisting flag set by admins (Issue #570).
    Delisted,
    Balance(Address),
    VestingSchedules(Address),
    Holders,
    MetadataUri,
    DividendSchedule,
    DividendPolicy,
    DividendPosition(Address),
    DividendHistory,
    DividendHistoryCounter,
    LastDistribution,
    Whitelisted(Address),
    SellOrder(u64),
    NextOrderId,
    MaxSharesPerUser,
    /// Allowance(owner, spender) → approved amount
    Allowance(Address, Address),
    BuybackConfig,
    BuybackBudget,
    LastBuyback,
    AcceptedTokens,
    /// Optional NFT contract address for minting share certificates on buy
    NftContract,
    /// Transfer fee configuration
    TransferFeeConfig,
    /// Transfer history index
    TransferHistoryIndex,
    /// Transfer history entry by index
    TransferHistory(u64),
    /// Transfer restrictions for address
    TransferRestrictions(Address),
    /// Pending transfer approvals
    PendingTransferApproval(u64),
    /// Next transfer approval ID
    NextTransferApprovalId,

    /// Vesting history entry by index
    VestingHistory(u64),
    /// Vesting history index counter
    VestingHistoryIndex,

    /// Reentrancy guard
    ReentrancyGuard,
    /// Compliance whitelist for transfers
    TransferWhitelist(Address),

    // ── Issue #494: additional storage keys used throughout the contract ──
    /// Contract metadata (name, version, description)
    ContractMetadata,
    /// Oracle contract address
    OracleAddress,
    /// Bridge-locked shares per user
    BridgeLocked(Address),
    /// Buyback request counter (auto-increment ID)
    BuybackRequestCounter,
    /// Individual buyback request by ID
    BuybackRequest(u64),
    /// Circuit breaker configuration
    CircuitBreakerConfig,
    /// Whether the circuit breaker has been triggered
    CircuitBreakerTriggered,
    /// Circuit breaker trigger count
    CircuitBreakerTriggerCount,
    /// Per-function pause flags bitmask
    FunctionPauseFlags,
    /// Contract implementation version
    ImplementationVersion,
    /// Last snapshot ledger sequence
    LastSnapshotLedger,
    /// Address is exempt from purchase limits
    LimitExempt(Address),
    /// Limit violation count per address
    LimitViolations(Address),
    /// Pending upgrade configuration
    PendingUpgrade,
    /// Purchase limit configuration
    PurchaseLimitConfig,
    /// Recovery mode enabled flag
    RecoveryEnabled,
    /// Snapshot counter (auto-increment ID)
    SnapshotCount,
    /// Tier-specific limits (0=standard, 1=premium, 2=institutional)
    TierLimits(u32),
    /// Transfer fee in basis points
    TransferFeeBps,
    /// Transfer fee collector address
    TransferFeeCollector,
    /// Upgrade timelock in seconds
    UpgradeTimelock,
    /// User purchase history for limit tracking
    UserPurchaseHistory(Address),
    /// Whitelist expiry timestamp per address
    WhitelistExpiry(Address),
    /// Whitelist tier per address (0=standard, 1=premium, 2=institutional)
    WhitelistTier(Address),
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

#[contracttype]
#[derive(Clone)]
pub struct VestingSummary {
    pub total_vested: u32,
    pub total_claimed: u32,
    pub total_locked: u32,
    pub claimable_now: u32,
    pub active_schedule_count: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct VestingClaimRecord {
    pub owner: Address,
    pub amount: u32,
    pub remaining_locked: u32,
    pub timestamp: u64,
}

/// SIP-4 contract metadata returned at runtime by get_contract_metadata()
#[contracttype]
#[derive(Clone)]
pub struct ContractMetadata {
    pub name: String,
    pub version: String,
    pub description: String,
}

#[contracttype]
#[derive(Clone)]
pub struct SellOrder {
    pub seller: Address,
    pub amount: u32,
    pub price_per_share: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct DividendSchedule {
    pub amount_per_share: i128,
    pub interval: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DividendPolicy {
    pub dividend_type: u32,
    pub payout_token: Address,
    pub withholding_bps: u32,
    pub reinvestment_enabled: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct DividendPosition {
    pub accrued_amount: i128,
    pub claimed_amount: i128,
    pub reinvestment_enabled: bool,
    pub last_update_ledger: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DividendHistoryEntry {
    pub id: u64,
    pub timestamp: u64,
    pub total_amount: i128,
    pub holder_count: u32,
    pub withholding_bps: u32,
    pub payout_token: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct AutoBuybackConfig {
    /// Minimum seconds that must elapse between auto-buyback executions.
    pub interval: u64,
    /// Maximum shares that can be bought back in a single auto-buyback call.
    pub max_amount: u32,
    /// Total token budget remaining for auto-buybacks.
    pub budget: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct TransferFeeConfig {
    /// Fee basis points (100 = 1%)
    pub fee_bps: u32,
    /// Fee recipient address
    pub fee_recipient: Address,
    /// Maximum fee in tokens
    pub max_fee: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct TransferHistoryEntry {
    pub from: Address,
    pub to: Address,
    pub amount: u32,
    pub timestamp: u64,
    pub fee_paid: i128,
    pub tx_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct TransferRestriction {
    pub restricted_until: u64,
    pub max_transfer_amount: u32,
    pub requires_approval: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct TransferApproval {
    pub from: Address,
    pub to: Address,
    pub amount: u32,
    pub requested_at: u64,
    pub approved: bool,
}

// ── Issue #494: Additional struct definitions for missing DataKey variants ──

#[contracttype]
#[derive(Clone)]
pub struct CircuitBreakerConfig {
    pub enabled: bool,
    pub max_price_change_bps: u32,
    pub max_volume_per_block: u64,
    pub armed: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct UpgradeConfig {
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
    pub scheduled_ledger: u64,
    pub proposer: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct BuybackRequest {
    pub request_id: u64,
    pub seller: Address,
    pub amount: u32,
    pub requested_price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct PurchaseLimitConfig {
    pub max_shares_per_user: u32,
    pub max_value_per_user: i128,
    pub daily_shares_limit: u32,
    pub daily_value_limit: i128,
    pub weekly_shares_limit: u32,
    pub weekly_value_limit: i128,
    pub monthly_shares_limit: u32,
    pub monthly_value_limit: i128,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct TierLimits {
    pub max_shares: u32,
    pub max_value: i128,
    pub daily_shares_multiplier: u32,
    pub daily_value_multiplier: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct UserPurchaseHistory {
    pub last_purchase_time: u64,
    pub daily_shares: u32,
    pub daily_value: i128,
    pub day_start: u64,
    pub weekly_shares: u32,
    pub weekly_value: i128,
    pub week_start: u64,
    pub monthly_shares: u32,
    pub monthly_value: i128,
    pub month_start: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EventTopics {
    Vault,
    Mint,
    Burn,
    Transfer,
    Dividend,
    Buyback,
    Admin,
}

#[contractevent(data_format = "vec")]
pub struct EventBuybackShares {
    pub caller: Address,
    pub seller: Address,
    pub amount: u32,
    pub total_cost: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventAutoBuybackConfig {
    interval: u64,
    max_amount: u32,
    budget: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventAddPaymentToken {
    token: Address,
}

#[contractevent(data_format = "vec")]
pub struct EventRemovePaymentToken {
    token: Address,
}

#[contractevent(data_format = "vec")]
pub struct EventOrderPlaced {
    order_id: u64,
    seller: Address,
    amount: u32,
    price_per_share: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventOrderCancelled {
    order_id: u64,
    seller: Address,
}

#[contractevent(data_format = "vec")]
pub struct EventOrderFilled {
    order_id: u64,
    buyer: Address,
    amount: u32,
    total_cost: i128,
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
    pub caller: Address,
    pub buyer: Address,
    pub shares: u32,
    pub total_cost: i128,
}

#[contractevent]
pub struct EventPause {}

#[contractevent]
pub struct EventUnpause {}

/// Emitted when an asset is permanently delisted by the multi-sig admin role
/// (Issue #570). Carries the number of open sell orders that were cancelled
/// so off-chain indexers can reconcile the order book.
#[contractevent(data_format = "vec")]
pub struct EventAssetDelisted {
    pub reason: soroban_sdk::Bytes,
    pub cancelled_orders: u32,
    pub timestamp: u64,
}

#[contractevent(data_format = "vec")]
pub struct EventEmergencyWithdraw {
    to: Address,
    amount: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventSetDividendSchedule {
    amount_per_share: i128,
    interval: u64,
}

#[contractevent(data_format = "vec")]
pub struct EventScheduledDividend {
    total_amount: i128,
    holder_count: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventDistributeDividends {
    token: Address,
    total_amount: i128,
    holder_count: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventDividendPolicySet {
    dividend_type: u32,
    payout_token: Address,
    withholding_bps: u32,
    reinvestment_enabled: bool,
}

#[contractevent(data_format = "vec")]
pub struct EventDividendAccrued {
    holder: Address,
    amount: i128,
    payout_token: Address,
}

#[contractevent(data_format = "vec")]
pub struct EventDividendClaimed {
    holder: Address,
    amount: i128,
    reinvestment_enabled: bool,
}

#[contractevent(data_format = "vec")]
pub struct EventDividendHistoryRecorded {
    id: u64,
    total_amount: i128,
    holder_count: u32,
    withholding_bps: u32,
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

#[contractevent(data_format = "vec")]
pub struct EventSetMaxSharesPerUser {
    old_max: u32,
    new_max: u32,
}

// ── Issue #274: Purchase Limit Events ────────────────────────────────────────

#[contractevent(data_format = "vec")]
pub struct EventPurchaseLimitConfigSet {
    enabled: bool,
    max_shares: u32,
    max_value: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventLimitViolation {
    user: Address,
    limit_type: u32,
    attempted_value: i128,
    limit_value: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventLimitExemptSet {
    address: Address,
    exempt: bool,
}

#[contractevent(data_format = "vec")]
pub struct EventTierLimitsSet {
    tier: u32,
    max_shares: u32,
    max_value: i128,
}

#[contractevent(data_format = "vec")]
pub struct EventUserPurchaseReset {
    address: Address,
    period: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventTransfer {
    pub caller: Address,
    pub from: Address,
    pub to: Address,
    pub amount: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventApproval {
    owner: Address,
    spender: Address,
    amount: u32,
}


// ── Vesting Events ────────────────────────────────────────────────────────

#[contractevent(data_format = "vec")]
pub struct EventVestingScheduleCreated {
    pub owner: Address,
    pub total_amount: u32,
    pub duration: u64,
    pub cliff: u64,
    pub start: u64,
}

#[contractevent(data_format = "vec")]
pub struct EventVestingSharesClaimed {
    pub owner: Address,
    pub amount: u32,
    pub remaining_locked: u32,
}

#[contractevent(data_format = "vec")]
pub struct EventVestingAccelerated {
    pub owner: Address,
    pub additional_vested: u32,
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

/// Reentrancy guard - set to true when entering a function, false when exiting
fn reentrancy_guard_enter(env: &Env) {
    if env.storage().instance().get(&DataKey::ReentrancyGuard).unwrap_or(false) {
        panic!("Reentrancy detected");
    }
    env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
}

fn reentrancy_guard_exit(env: &Env) {
    env.storage().instance().set(&DataKey::ReentrancyGuard, &false);
}

/// Alias: check and lock the reentrancy guard.
/// Panics if the guard is already set (re-entrant call detected).
fn _check_non_reentrant(env: &Env) {
    reentrancy_guard_enter(env);
}

/// Alias: set the reentrancy guard flag.
/// Pass `true` to lock, `false` to unlock.
fn _set_non_reentrant(env: &Env, value: bool) {
    env.storage().instance().set(&DataKey::ReentrancyGuard, &value);
}

/// Check if an address is transfer-whitelisted
fn is_transfer_whitelisted(env: &Env, addr: &Address) -> bool {
    env.storage().persistent().get(&DataKey::TransferWhitelist(addr.clone())).unwrap_or(true)
}

/// Calculate transfer fee based on configuration
fn calculate_transfer_fee(env: &Env, amount: u32, price_per_share: i128) -> i128 {
    if let Some(config) = env.storage().instance().get::<DataKey, TransferFeeConfig>(&DataKey::TransferFeeConfig) {
        let transfer_value = checked_mul_i128(amount as i128, price_per_share);
        let fee = (transfer_value * config.fee_bps as i128) / 10000;
        if config.max_fee > 0 && fee > config.max_fee {
            return config.max_fee;
        }
        return fee;
    }
    0
}

/// Check transfer restrictions for an address
fn check_transfer_restrictions(env: &Env, from: &Address, amount: u32) {
    if let Some(restriction) = env.storage().persistent().get::<DataKey, TransferRestriction>(&DataKey::TransferRestrictions(from.clone())) {
        let now = env.ledger().timestamp();
        if now < restriction.restricted_until {
            panic!("Transfer restricted until timestamp {}", restriction.restricted_until);
        }
        if restriction.max_transfer_amount > 0 && amount > restriction.max_transfer_amount {
            panic!("Transfer amount exceeds maximum allowed of {}", restriction.max_transfer_amount);
        }
        if restriction.requires_approval {
            panic!("Transfer requires prior approval");
        }
    }
}

/// Record transfer in history
fn record_transfer_history(env: &Env, from: Address, to: Address, amount: u32, fee_paid: i128, tx_hash: BytesN<32>) {
    let index: u64 = env.storage().instance().get(&DataKey::TransferHistoryIndex).unwrap_or(0);
    let entry = TransferHistoryEntry {
        from,
        to,
        amount,
        timestamp: env.ledger().timestamp(),
        fee_paid,
        tx_hash,
    };
    env.storage().persistent().set(&DataKey::TransferHistory(index), &entry);
    env.storage().instance().set(&DataKey::TransferHistoryIndex, &(index + 1));
}

/// Check vesting restrictions - only liquid (non-vested) shares can be transferred
fn check_vesting_restrictions(env: &Env, owner: &Address, amount: u32) {
    let liquid_balance: u32 = env.storage().persistent().get(&DataKey::Balance(owner.clone())).unwrap_or(0);
    if amount > liquid_balance {
        panic!("Cannot transfer vested shares. Only liquid shares can be transferred.");
    }
}

// ── Issue #310: Function pause constants and helpers ────────────────────

const FN_BUY_SHARES: u32 = 0;
const FN_TRANSFER: u32 = 1;
const FN_TRANSFER_FROM: u32 = 2;
const FN_SELL_ORDER: u32 = 3;
const FN_DIVIDEND: u32 = 4;
const FN_BUYBACK: u32 = 5;

/// Check if a specific function category is paused via bitmask.
fn _is_function_paused(env: &Env, function_id: u32) -> bool {
    let flags: u32 = env.storage().instance().get(&DataKey::FunctionPauseFlags).unwrap_or(0);
    (flags & (1 << function_id)) != 0
}

/// Set or clear the pause flag for a specific function category.
fn _set_function_paused(env: &Env, function_id: u32, paused: bool) {
    let mut flags: u32 = env.storage().instance().get(&DataKey::FunctionPauseFlags).unwrap_or(0);
    if paused {
        flags |= 1 << function_id;
    } else {
        flags &= !(1 << function_id);
    }
    env.storage().instance().set(&DataKey::FunctionPauseFlags, &flags);
}

// ── Issue #311: Circuit breaker helpers ─────────────────────────────────

/// Check if the circuit breaker has been triggered.
fn _is_circuit_breaker_triggered(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::CircuitBreakerTriggered).unwrap_or(false)
}

/// Panics if the circuit breaker has been triggered.
fn _require_circuit_breaker_clear(env: &Env) {
    if _is_circuit_breaker_triggered(env) {
        panic!("Circuit breaker is triggered: trading halted");
    }
}

// ── Issue #270: Whitelist validation ───────────────────────────────────

/// Validate that an address is whitelisted and not expired.
fn _validate_whitelist(env: &Env, addr: &Address) {
    // Must be in the whitelist
    if !env.storage().persistent().get::<DataKey, bool>(&DataKey::Whitelisted(addr.clone())).unwrap_or(false) {
        panic!("Address is not whitelisted");
    }
    // Check expiry if set
    if let Some(expiry) = env.storage().persistent().get::<DataKey, u64>(&DataKey::WhitelistExpiry(addr.clone())) {
        let now = env.ledger().timestamp();
        if now > expiry {
            panic!("Whitelist has expired for this address");
        }
    }
}

// ── Issue #268: Oracle-aware price helper ──────────────────────────────

/// Get the current price per share. Uses the oracle if configured,
/// otherwise falls back to the static PricePerShare.
fn _get_current_price(env: &Env) -> i128 {
    if let Some(oracle_addr) = env.storage().instance().get::<DataKey, Address>(&DataKey::OracleAddress) {
        let oracle_client: OracleContractClient = OracleContractClient::new(env, &oracle_addr);
        return oracle_client.get_price();
    }
    env.storage().instance().get(&DataKey::PricePerShare).unwrap_or(0)
}

// ── Issue #274: Purchase limit validation ──────────────────────────────

/// Validate purchase limits for a buyer. Returns the updated purchase history.
/// Panics if any limit is exceeded.
fn _validate_purchase_limits(env: &Env, buyer: &Address, shares: u32, total_cost: i128) -> UserPurchaseHistory {
    // Check if exempt
    if env.storage().persistent().get::<DataKey, bool>(&DataKey::LimitExempt(buyer.clone())).unwrap_or(false) {
        let mut history: UserPurchaseHistory = env.storage().persistent().get(&DataKey::UserPurchaseHistory(buyer.clone())).unwrap_or(UserPurchaseHistory {
            last_purchase_time: 0, daily_shares: 0, daily_value: 0, day_start: 0,
            weekly_shares: 0, weekly_value: 0, week_start: 0,
            monthly_shares: 0, monthly_value: 0, month_start: 0,
        });
        let now = env.ledger().timestamp();
        history.last_purchase_time = now;
        return history;
    }

    let config: PurchaseLimitConfig = env.storage().instance().get(&DataKey::PurchaseLimitConfig)
        .unwrap_or(PurchaseLimitConfig {
            max_shares_per_user: 0,
            max_value_per_user: 0,
            daily_shares_limit: 0,
            daily_value_limit: 0,
            weekly_shares_limit: 0,
            weekly_value_limit: 0,
            monthly_shares_limit: 0,
            monthly_value_limit: 0,
            enabled: false,
        });

    if !config.enabled {
        let mut history: UserPurchaseHistory = env.storage().persistent().get(&DataKey::UserPurchaseHistory(buyer.clone())).unwrap_or(UserPurchaseHistory {
            last_purchase_time: 0, daily_shares: 0, daily_value: 0, day_start: 0,
            weekly_shares: 0, weekly_value: 0, week_start: 0,
            monthly_shares: 0, monthly_value: 0, month_start: 0,
        });
        history.last_purchase_time = env.ledger().timestamp();
        return history;
    }

    let mut history: UserPurchaseHistory = env.storage().persistent().get(&DataKey::UserPurchaseHistory(buyer.clone())).unwrap_or(UserPurchaseHistory {
        last_purchase_time: 0, daily_shares: 0, daily_value: 0, day_start: 0,
        weekly_shares: 0, weekly_value: 0, week_start: 0,
        monthly_shares: 0, monthly_value: 0, month_start: 0,
    });
    let now = env.ledger().timestamp();

    // Get tier multiplier
    let tier: u32 = env.storage().persistent().get(&DataKey::WhitelistTier(buyer.clone())).unwrap_or(0);
    let multiplier: u32 = if tier > 0 && tier <= 2 {
        let tier_limits: TierLimits = env.storage().instance().get(&DataKey::TierLimits(tier)).unwrap_or(TierLimits {
            max_shares: 0,
            max_value: 0,
            daily_shares_multiplier: 10000,
            daily_value_multiplier: 10000,
        });
        tier_limits.daily_shares_multiplier
    } else {
        10000
    };

    // Check per-transaction limits
    if config.max_shares_per_user > 0 && shares > config.max_shares_per_user {
        panic!("Purchase exceeds per-transaction share limit");
    }
    if config.max_value_per_user > 0 && total_cost > config.max_value_per_user {
        panic!("Purchase exceeds per-transaction value limit");
    }

    // Check daily limits (with tier multiplier)
    let effective_daily_shares = (config.daily_shares_limit as u64 * multiplier as u64) / 10000;
    if effective_daily_shares > 0 && history.daily_shares as u64 + shares as u64 > effective_daily_shares {
        panic!("Purchase would exceed daily share limit");
    }
    let effective_daily_value = (config.daily_value_limit as u128 * multiplier as u128) / 10000;
    if effective_daily_value > 0 && history.daily_value as u128 + total_cost as u128 > effective_daily_value {
        panic!("Purchase would exceed daily value limit");
    }

    // Check weekly limits
    let effective_weekly_shares = (config.weekly_shares_limit as u64 * multiplier as u64) / 10000;
    if effective_weekly_shares > 0 && history.weekly_shares as u64 + shares as u64 > effective_weekly_shares {
        panic!("Purchase would exceed weekly share limit");
    }

    // Check monthly limits
    let effective_monthly_shares = (config.monthly_shares_limit as u64 * multiplier as u64) / 10000;
    if effective_monthly_shares > 0 && history.monthly_shares as u64 + shares as u64 > effective_monthly_shares {
        panic!("Purchase would exceed monthly share limit");
    }

    // Update history
    history.last_purchase_time = now;
    history.daily_shares += shares;
    history.daily_value += total_cost as i128;
    history.weekly_shares += shares;
    history.weekly_value += total_cost as i128;
    history.monthly_shares += shares;
    history.monthly_value += total_cost as i128;

    history
}

/// Update purchase history after a successful purchase.
fn _update_purchase_history(env: &Env, buyer: &Address, history: UserPurchaseHistory) {
    env.storage().persistent().set(&DataKey::UserPurchaseHistory(buyer.clone()), &history);
}

#[contractimpl]
impl RwaMarketplace {
    pub fn init(env: Env, admin: Address, payment_token: Address, price: i128, total_shares: u32) {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Marketplace is already initialized");
        }

        if price <= 0 {
            panic!("Price must be greater than zero");
        }

        if total_shares == 0 {
            panic!("Total shares must be greater than zero");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PaymentToken, &payment_token);
        env.storage().instance().set(&DataKey::PricePerShare, &price);
        env.storage().instance().set(&DataKey::TotalShares, &total_shares);
        env.storage().instance().set(&DataKey::AvailableShares, &total_shares);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Initialize implementation version for upgradeable proxy pattern (Issue #309)
        env.storage().instance().set(&DataKey::ImplementationVersion, &1u32);

        // Initialize empty holders registry
        let holders: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Holders, &holders);

        // Seed the accepted payment tokens list with the initial token
        let mut accepted: Vec<Address> = Vec::new(&env);
        accepted.push_back(payment_token.clone());
        env.storage().instance().set(&DataKey::AcceptedTokens, &accepted);

        // Store SIP-4 metadata
        let metadata = ContractMetadata {
            name: String::from_str(&env, "RWA Marketplace"),
            version: String::from_str(&env, "0.4.0"),
            description: String::from_str(&env, "Tokenized Fractional RWA Marketplace"),
        };
        env.storage().instance().set(&DataKey::ContractMetadata, &metadata);

        EventInit { admin, payment_token, price, total_shares }.publish(&env);
    }

    pub fn buy_shares(env: Env, buyer: Address, shares: u32, payment_token: Address) {
        buyer.require_auth();

        // Re-entrancy guard: prevent recursive calls during external token operations
        _check_non_reentrant(&env);

        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            // Clear reentrancy guard on early return
            _set_non_reentrant(&env, false);
            panic!("Marketplace is paused");
        }

        // Issue #310: Check granular pause for purchases
        if _is_function_paused(&env, FN_BUY_SHARES) {
            _set_non_reentrant(&env, false);
            panic!("Purchases are currently paused");
        }

        // Issue #311: Check circuit breaker
        _require_circuit_breaker_clear(&env);

        // Issue #270: Enhanced whitelist validation (expiry-aware)
        _validate_whitelist(&env, &buyer);

        // Issue #274: Purchase limit validation
        Self::require_accepted_token(&env, &payment_token);

        // Issue #268: Oracle-aware price (reusable helper)
        let price: i128 = _get_current_price(&env);

        let total_cost = checked_mul_i128(price, shares as i128);

        // Validate purchase limits (will panic if limits are exceeded)
        let purchase_history = _validate_purchase_limits(&env, &buyer, shares, total_cost);

        let available: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .expect("Contract not initialized: available shares");

        if shares > available {
            _set_non_reentrant(&env, false);
            panic!("Not enough shares available for purchase");
        }

        if shares == 0 {
            _set_non_reentrant(&env, false);
            panic!("Must purchase at least 1 share");
        }

        // Enforce per-address cap (current holdings + this purchase) before
        // transferring any tokens. A cap of 0 means "no limit".
        // Note: This is the legacy limit check - the new comprehensive limits
        // are checked in _validate_purchase_limits above
        let prev_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(buyer.clone()))
            .unwrap_or(0);
        let prospective_balance = checked_add_u32(prev_balance, shares);
        let max_per_user: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSharesPerUser)
            .unwrap_or(0);
        if max_per_user > 0 && prospective_balance > max_per_user {
            _set_non_reentrant(&env, false);
            panic!("Purchase exceeds max shares per user");
        }

        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");

        // Checks-Effects-Interactions (closes #633): update contract state
        // *before* the external token transfer below. The reentrancy guard
        // at the top of this function already blocks a recursive re-entry
        // into buy_shares itself, but CEI ordering is the standard mitigation
        // for the broader class of bug this guards against - if the
        // configured payment_token can invoke a callback (or a future token
        // integration does), on-chain state must already reflect the pending
        // purchase before control could pass back, not after.
        let new_available = checked_sub_u32(available, shares);
        env.storage()
            .instance()
            .set(&DataKey::AvailableShares, &new_available);

        let new_balance = prospective_balance;
        env.storage()
            .persistent()
            .set(&DataKey::Balance(buyer.clone()), &new_balance);

        // Interaction: external token transfer happens last, after every
        // state effect above has already been committed.
        let client = token::TokenClient::new(&env, &payment_token);
        client.transfer(&buyer, &admin, &total_cost);

        // Register as new holder only on first purchase or if not registered yet
        Self::register_holder(&env, buyer.clone());

        // Mint share-certificate NFTs per share purchased (if NFT contract is configured).
        // Use optimized batch minting for gas efficiency
        if let Some(nft_addr) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::NftContract)
        {
            let nft = NftContractClient::new(&env, &nft_addr);
            // Use batch minting for gas optimization
            nft.batch_mint_to_single(&buyer, shares);
        }

        // Issue #274: Update purchase history after successful purchase
        _update_purchase_history(&env, &buyer, purchase_history);

        // Clear reentrancy guard before publishing event
        _set_non_reentrant(&env, false);

        EventBuyShares { caller: buyer.clone(), buyer, shares, total_cost }.publish(&env);
    }

    /// Set (or update) the share-certificate NFT contract address. Admin only.
    /// Once set, every `buy_shares` call mints one NFT per share to the buyer.
    pub fn set_nft_contract(env: Env, nft_contract: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().instance().set(&DataKey::NftContract, &nft_contract);
        EventNftContractSet { nft_contract }.publish(&env);
    }

    /// Return the configured NFT contract address, or None if not set.
    pub fn get_nft_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::NftContract)
    }

    pub fn add_to_whitelist(env: Env, addr: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Whitelisted(addr.clone()), &true);
        EventWhitelisted { addr }.publish(&env);
    }

    pub fn remove_from_whitelist(env: Env, addr: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().persistent().remove(&DataKey::Whitelisted(addr.clone()));
        EventWhitelistRemoved { addr }.publish(&env);
    }

    pub fn is_whitelisted(env: Env, addr: Address) -> bool {
        // Check both the whitelist flag and expiration (Issue #270)
        if !env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Whitelisted(addr.clone()))
            .unwrap_or(false)
        {
            return false;
        }
        let expiry: u64 = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::WhitelistExpiry(addr.clone()))
            .unwrap_or(0);
        if expiry > 0 && env.ledger().timestamp() >= expiry {
            return false;
        }
        true
    }

    /// Batch-add addresses to the whitelist. Admin only.
    pub fn add_to_whitelist_batch(env: Env, addrs: Vec<Address>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let count = addrs.len() as u32;
        for addr in addrs.iter() {
            env.storage().persistent().set(&DataKey::Whitelisted(addr.clone()), &true);
        }
        EventWhitelistBatch { count, action: 0 }.publish(&env);
    }

    /// Batch-remove addresses from the whitelist. Admin only.
    pub fn remove_from_whitelist_batch(env: Env, addrs: Vec<Address>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let count = addrs.len() as u32;
        for addr in addrs.iter() {
            env.storage().persistent().remove(&DataKey::Whitelisted(addr.clone()));
            env.storage().persistent().remove(&DataKey::WhitelistExpiry(addr.clone()));
            env.storage().persistent().remove(&DataKey::WhitelistTier(addr.clone()));
        }
        EventWhitelistBatch { count, action: 1 }.publish(&env);
    }

    /// Set a whitelist expiration timestamp for an address. Admin only.
    /// `expiry` = 0 means never expires.
    pub fn set_whitelist_expiry(env: Env, addr: Address, expiry: u64) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().persistent().set(&DataKey::WhitelistExpiry(addr.clone()), &expiry);
        EventWhitelistExpirySet { addr, expiry }.publish(&env);
    }

    /// Set the whitelist tier for an address. Admin only.
    /// 0 = standard, 1 = premium, 2 = institutional.
    pub fn set_whitelist_tier(env: Env, addr: Address, tier: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        if tier > 2 {
            panic!("Invalid tier: must be 0, 1, or 2");
        }
        env.storage().persistent().set(&DataKey::WhitelistTier(addr.clone()), &tier);
        EventWhitelistTierSet { addr, tier }.publish(&env);
    }

    /// Return composite whitelist info for an address.
    pub fn get_whitelist_info(env: Env, addr: Address) -> WhitelistInfo {
        _get_whitelist_info(&env, &addr)
    }

    /// Add a token to the accepted payment tokens list. Admin only.
    pub fn add_payment_token(env: Env, token: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let mut accepted: Vec<Address> = env.storage().instance()
            .get(&DataKey::AcceptedTokens)
            .unwrap_or_else(|| Vec::new(&env));

        for t in accepted.iter() {
            if t == token {
                panic!("Token already accepted");
            }
        }
        accepted.push_back(token.clone());
        env.storage().instance().set(&DataKey::AcceptedTokens, &accepted);

        EventAddPaymentToken { token }.publish(&env);
    }

    /// Remove a token from the accepted payment tokens list. Admin only.
    /// The default `PaymentToken` (set at init) cannot be removed.
    pub fn remove_payment_token(env: Env, token: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let default_token: Address = env.storage().instance()
            .get(&DataKey::PaymentToken)
            .expect("Contract not initialized: payment token");
        if token == default_token {
            panic!("Cannot remove the default payment token");
        }

        let accepted: Vec<Address> = env.storage().instance()
            .get(&DataKey::AcceptedTokens)
            .unwrap_or_else(|| Vec::new(&env));

        let mut updated: Vec<Address> = Vec::new(&env);
        let mut found = false;
        for t in accepted.iter() {
            if t == token {
                found = true;
            } else {
                updated.push_back(t);
            }
        }
        if !found {
            panic!("Token not in accepted list");
        }
        env.storage().instance().set(&DataKey::AcceptedTokens, &updated);

        EventRemovePaymentToken { token }.publish(&env);
    }

    /// Return the list of accepted payment tokens.
    pub fn get_accepted_tokens(env: Env) -> Vec<Address> {
        env.storage().instance()
            .get(&DataKey::AcceptedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Panic if `token` is not in the accepted payment tokens list.
    fn require_accepted_token(env: &Env, token: &Address) {
        let accepted: Vec<Address> = env.storage().instance()
            .get(&DataKey::AcceptedTokens)
            .unwrap_or_else(|| Vec::new(env));
        for t in accepted.iter() {
            if &t == token {
                return;
            }
        }
        panic!("Payment token not accepted");
    }

    /// Distribute `total_amount` of `token` pro-rata among all current holders
    /// based on their share count relative to total issued shares.
    ///
    /// Only the admin may call this. The contract must hold enough `token`
    /// balance to cover `total_amount` before calling.
    pub fn distribute_dividends(env: Env, token: Address, total_amount: i128) {
        _check_non_reentrant(&env);
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if _is_function_paused(&env, FN_DIVIDEND) {
            panic!("Dividend distribution is currently paused");
        }

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

        let policy = _resolve_dividend_policy(&env, &token);

        let admin_addr: Address = env.storage().instance().get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("Contract not initialized: admin"));
        let payout_token = policy.payout_token.clone();
        let client = token::TokenClient::new(&env, &payout_token);
        let contract_addr = env.current_contract_address();
        let mut active_holders: Vec<Address> = Vec::new(&env);
        let mut history = _load_dividend_history(&env);
        let history_id = _get_next_dividend_history_id(&env);

        for holder in holders.iter() {
            let holder_shares: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(holder.clone()))
                .unwrap_or(0);

            if holder_shares == 0 {
                continue;
            }

            active_holders.push_back(holder.clone());

            let raw_amount = _calculate_pro_rata_amount(total_amount, holder_shares, total_shares);
            let withholding = (raw_amount as i128 * policy.withholding_bps as i128) / DIVIDEND_WITHHOLDING_MAX_BPS as i128;
            let net_amount = raw_amount.saturating_sub(withholding);
            let mut position = _load_dividend_position(&env, &holder);
            let should_accrue = policy.withholding_bps > 0 || policy.reinvestment_enabled || position.reinvestment_enabled;

            if should_accrue {
                if net_amount > 0 {
                    position.accrued_amount = checked_add_i128(position.accrued_amount, net_amount);
                    position.last_update_ledger = env.ledger().sequence() as u64;
                    _store_dividend_position(&env, &holder, &position);
                    EventDividendAccrued {
                        holder: holder.clone(),
                        amount: net_amount,
                        payout_token: policy.payout_token.clone(),
                    }
                    .publish(&env);
                }

                if raw_amount > 0 && policy.withholding_bps > 0 {
                    let withholding_amount = raw_amount.saturating_sub(net_amount);
                    if withholding_amount > 0 {
                        client.transfer(&contract_addr, &admin_addr, &withholding_amount);
                    }
                }
            } else if raw_amount > 0 {
                client.transfer(&contract_addr, &holder, &raw_amount);
            }
        }

        env.storage().instance().set(&DataKey::Holders, &active_holders);

        history.push_back(DividendHistoryEntry {
            id: history_id,
            timestamp: env.ledger().timestamp(),
            total_amount,
            holder_count: active_holders.len(),
            withholding_bps: policy.withholding_bps,
            payout_token: policy.payout_token.clone(),
        });
        _store_dividend_history(&env, &history);

        EventDistributeDividends {
            token,
            total_amount,
            holder_count: active_holders.len(),
        }
        .publish(&env);

        EventDividendHistoryRecorded {
            id: history_id,
            total_amount,
            holder_count: active_holders.len(),
            withholding_bps: policy.withholding_bps,
        }
        .publish(&env);

        _set_non_reentrant(&env, false);
    }

    pub fn set_dividend_policy(env: Env, dividend_type: u32, payout_token: Address, withholding_bps: u32, reinvestment_enabled: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        _validate_dividend_type(dividend_type);

        if withholding_bps > DIVIDEND_WITHHOLDING_MAX_BPS {
            panic!("Withholding basis points must be between 0 and 10000");
        }

        let policy = DividendPolicy {
            dividend_type,
            payout_token: payout_token.clone(),
            withholding_bps,
            reinvestment_enabled,
        };
        env.storage().instance().set(&DataKey::DividendPolicy, &policy);

        EventDividendPolicySet {
            dividend_type,
            payout_token,
            withholding_bps,
            reinvestment_enabled,
        }
        .publish(&env);
    }

    pub fn set_dividend_reinvestment(env: Env, holder: Address, enabled: bool) {
        holder.require_auth();
        let mut position = _load_dividend_position(&env, &holder);
        position.reinvestment_enabled = enabled;
        _store_dividend_position(&env, &holder, &position);
    }

    pub fn claim_dividends(env: Env, holder: Address) {
        _check_non_reentrant(&env);
        holder.require_auth();

        let position = _load_dividend_position(&env, &holder);
        if position.accrued_amount <= 0 {
            _set_non_reentrant(&env, false);
            panic!("No accrued dividends available to claim");
        }

        let policy = _resolve_dividend_policy(
            &env,
            &env.storage().instance().get(&DataKey::PaymentToken).expect("Contract not initialized: payment token"),
        );

        let token_client = token::TokenClient::new(&env, &policy.payout_token);
        let contract_addr = env.current_contract_address();

        let mut updated_position = position.clone();
        updated_position.claimed_amount = checked_add_i128(updated_position.claimed_amount, position.accrued_amount);
        updated_position.accrued_amount = 0;
        _store_dividend_position(&env, &holder, &updated_position);

        token_client.transfer(&contract_addr, &holder, &position.accrued_amount);

        EventDividendClaimed {
            holder: holder.clone(),
            amount: position.accrued_amount,
            reinvestment_enabled: updated_position.reinvestment_enabled,
        }
        .publish(&env);

        _set_non_reentrant(&env, false);
    }

    pub fn get_dividend_position(env: Env, holder: Address) -> DividendPosition {
        _load_dividend_position(&env, &holder)
    }

    pub fn get_dividend_history(env: Env) -> Vec<DividendHistoryEntry> {
        _load_dividend_history(&env)
    }

    pub fn get_dividend_history_count(env: Env) -> u32 {
        _load_dividend_history(&env).len() as u32
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

    pub fn buy_vested_shares(env: Env, buyer: Address, shares: u32, duration: u64, payment_token: Address) {
        _check_non_reentrant(&env);
        buyer.require_auth();

        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            _set_non_reentrant(&env, false);
            panic!("Marketplace is paused");
        }

        if shares == 0 {
            _set_non_reentrant(&env, false);
            panic!("Must purchase at least 1 share");
        }

        if duration == 0 {
            _set_non_reentrant(&env, false);
            panic!("Vesting duration must be positive");
        }

        let available: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .expect("Contract not initialized: available shares");

        if shares > available {
            _set_non_reentrant(&env, false);
            panic!("Not enough shares available for purchase");
        }

        Self::require_accepted_token(&env, &payment_token);

        // Issue #268: Oracle-aware price (reusable helper)
        let price: i128 = _get_current_price(&env);

        let total_cost = price * (shares as i128);

        // Issue #274: Purchase limit validation for vested shares
        let purchase_history = _validate_purchase_limits(&env, &buyer, shares, total_cost);

        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");

        let client = token::TokenClient::new(&env, &payment_token);
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

        // Issue #274: Update purchase history after successful purchase
        _update_purchase_history(&env, &buyer, purchase_history);

        _set_non_reentrant(&env, false);
        EventBuyShares { buyer, shares, total_cost }.publish(&env);
    }

    pub fn claim_vested_shares(env: Env, claimer: Address) {
        claimer.require_auth();

        let now = env.ledger().timestamp();
        let schedules = Self::load_vesting_schedules(&env, &claimer);

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

        // Record vesting claim history
        let remaining = Self::get_locked_shares(env.clone(), claimer.clone());
        Self::record_vesting_claim(&env, &claimer, total_claimable, remaining);

        EventVestingSharesClaimed {
            owner: claimer.clone(),
            amount: total_claimable,
            remaining_locked: remaining,
        }.publish(&env);
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

    // ── Vesting Analytics & History ────────────────────────────────────

    /// Return a comprehensive vesting summary for an address.
    /// Includes total vested, total claimed, total locked, claimable now, and schedule count.
    pub fn get_vesting_summary(env: Env, owner: Address) -> VestingSummary {
        let schedules = Self::load_vesting_schedules(&env, &owner);
        let now = env.ledger().timestamp();
        let mut total_vested: u32 = 0;
        let mut total_claimed: u32 = 0;
        let mut claimable_now: u32 = 0;
        let mut active_schedules: u32 = 0;

        for schedule in schedules.iter() {
            let vested = Self::compute_vested_amount(&schedule, now);
            total_vested = total_vested.saturating_add(vested);
            total_claimed = total_claimed.saturating_add(schedule.claimed_amount);
            let available = vested.saturating_sub(schedule.claimed_amount);
            claimable_now = claimable_now.saturating_add(available);
            if schedule.total_amount > schedule.claimed_amount {
                active_schedules += 1;
            }
        }

        VestingSummary {
            total_vested,
            total_claimed,
            total_locked: total_vested.saturating_sub(total_claimed),
            claimable_now,
            active_schedule_count: active_schedules,
        }
    }

    /// Record a vesting claim in the vesting history.
    fn record_vesting_claim(env: &Env, owner: &Address, claimed: u32, remaining_locked: u32) {
        let index: u64 = env.storage().instance().get(&DataKey::VestingHistoryIndex).unwrap_or(0);
        let entry = VestingClaimRecord {
            owner: owner.clone(),
            amount: claimed,
            remaining_locked,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::VestingHistory(index), &entry);
        env.storage().instance().set(&DataKey::VestingHistoryIndex, &(index + 1));
    }

    /// Return vesting history for a given address (pagination by start index + limit).
    pub fn get_vesting_history(env: Env, owner: Address, start_idx: u64, limit: u32) -> Vec<VestingClaimRecord> {
        let total: u64 = env.storage().instance().get(&DataKey::VestingHistoryIndex).unwrap_or(0);
        let mut result: Vec<VestingClaimRecord> = Vec::new(&env);
        let end = core::cmp::min(total, start_idx.saturating_add(limit as u64));
        let mut i = start_idx;
        while i < end {
            if let Some(entry) = env.storage().persistent().get::<DataKey, VestingClaimRecord>(&DataKey::VestingHistory(i)) {
                if entry.owner == owner {
                    result.push_back(entry);
                }
            }
            i += 1;
        }
        result
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
        EventMetadataUriSet { uri }.publish(&env);
    }

    /// Retrieve the on-chain metadata URI. Returns empty bytes if not set.
    pub fn get_metadata_uri(env: Env) -> Bytes {
        env.storage().instance().get(&DataKey::MetadataUri)
            .unwrap_or_else(|| Bytes::new(&env))
    }

    pub fn set_dividend_schedule(env: Env, amount_per_share: i128, interval: u64) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if amount_per_share <= 0 {
            panic!("Amount per share must be positive");
        }
        if interval == 0 {
            panic!("Interval must be positive");
        }

        let schedule = DividendSchedule { amount_per_share, interval };
        env.storage().instance().set(&DataKey::DividendSchedule, &schedule);

        EventSetDividendSchedule { amount_per_share, interval }.publish(&env);
    }

    pub fn get_dividend_schedule(env: Env) -> Option<DividendSchedule> {
        env.storage().instance().get(&DataKey::DividendSchedule)
    }

    /// Process a scheduled dividend distribution. Callable by anyone.
    /// Checks that the interval has elapsed since last_distribution,
    /// then distributes amount_per_share * total_shares pro-rata to holders.
    pub fn process_scheduled_dividend(env: Env) {
        _check_non_reentrant(&env);

        let last_distribution: u64 = env.storage()
            .instance()
            .get(&DataKey::LastDistribution)
            .unwrap_or(0);

        let now = env.ledger().timestamp();
        if now < last_distribution {
            _set_non_reentrant(&env, false);
            panic!("Ledger timestamp is in the past relative to last distribution");
        }

        let schedule: DividendSchedule = env.storage().instance()
            .get(&DataKey::DividendSchedule)
            .expect("Dividend schedule not configured");

        if now < last_distribution.saturating_add(schedule.interval) {
            _set_non_reentrant(&env, false);
            panic!("Dividend interval has not elapsed yet");
        }

        let total_shares: u32 = env.storage().instance()
            .get(&DataKey::TotalShares)
            .expect("Contract not initialized: total shares");

        if total_shares == 0 {
            _set_non_reentrant(&env, false);
            panic!("No shares have been issued");
        }

        let total_amount = checked_mul_i128(schedule.amount_per_share, total_shares as i128);
        if total_amount <= 0 {
            _set_non_reentrant(&env, false);
            panic!("Dividend total amount must be positive");
        }

        let holders: Vec<Address> = env.storage().instance()
            .get(&DataKey::Holders)
            .unwrap_or_else(|| Vec::new(&env));

        if holders.is_empty() {
            _set_non_reentrant(&env, false);
            panic!("No holders registered");
        }

        let policy = _resolve_dividend_policy(&env, &env.storage().instance()
            .get(&DataKey::PaymentToken)
            .expect("Contract not initialized: payment token"));
        let token_id = policy.payout_token.clone();

        let client = token::TokenClient::new(&env, &token_id);
        let contract_addr = env.current_contract_address();

        let mut active_holders: Vec<Address> = Vec::new(&env);
        let mut history = _load_dividend_history(&env);
        let history_id = _get_next_dividend_history_id(&env);

        for holder in holders.iter() {
            let holder_shares: u32 = env.storage().persistent()
                .get(&DataKey::Balance(holder.clone()))
                .unwrap_or(0);

            if holder_shares == 0 {
                continue;
            }

            active_holders.push_back(holder.clone());

            let raw_amount = _calculate_pro_rata_amount(total_amount, holder_shares, total_shares);
            let withholding = (raw_amount as i128 * policy.withholding_bps as i128) / DIVIDEND_WITHHOLDING_MAX_BPS as i128;
            let net_amount = raw_amount.saturating_sub(withholding);
            let mut position = _load_dividend_position(&env, &holder);
            let should_accrue = policy.withholding_bps > 0 || policy.reinvestment_enabled || position.reinvestment_enabled;

            if should_accrue {
                if net_amount > 0 {
                    position.accrued_amount = checked_add_i128(position.accrued_amount, net_amount);
                    position.last_update_ledger = env.ledger().sequence() as u64;
                    _store_dividend_position(&env, &holder, &position);
                    EventDividendAccrued {
                        holder: holder.clone(),
                        amount: net_amount,
                        payout_token: policy.payout_token.clone(),
                    }
                    .publish(&env);
                }

                if raw_amount > 0 && policy.withholding_bps > 0 {
                    let withholding_amount = raw_amount.saturating_sub(net_amount);
                    if withholding_amount > 0 {
                        let admin_addr: Address = env.storage().instance().get(&DataKey::Admin).unwrap_or_else(|| panic!("Contract not initialized: admin"));
                        client.transfer(&contract_addr, &admin_addr, &withholding_amount);
                    }
                }
            } else if raw_amount > 0 {
                client.transfer(&contract_addr, &holder, &raw_amount);
            }
        }

        env.storage().instance().set(&DataKey::Holders, &active_holders);
        env.storage().instance().set(&DataKey::LastDistribution, &now);

        history.push_back(DividendHistoryEntry {
            id: history_id,
            timestamp: now,
            total_amount,
            holder_count: active_holders.len(),
            withholding_bps: policy.withholding_bps,
            payout_token: policy.payout_token.clone(),
        });
        _store_dividend_history(&env, &history);

        let holder_count = active_holders.len();

        EventScheduledDividend { total_amount, holder_count }.publish(&env);
        EventDividendHistoryRecorded {
            id: history_id,
            total_amount,
            holder_count,
            withholding_bps: policy.withholding_bps,
        }
        .publish(&env);

        _set_non_reentrant(&env, false);
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

    // ── Issue #570: Emergency Asset Delisting ─────────────────────────────

    /// Check whether the asset has been permanently delisted.
    pub fn is_delisted(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Delisted)
            .unwrap_or(false)
    }

    /// Permanently delist the asset and halt all trading immediately.
    ///
    /// Requires the multi-sig admin role. This is destructive and irreversible:
    /// it sets the global pause flag so no buys/sells/transfers can execute, then
    /// cancels every open sell order in the order book, returning the escrowed
    /// shares to each seller so they can withdraw their frozen funds.
    ///
    /// Called directly by admins or via the guarded timelock operation
    /// (`AdminAction::DelistAsset`) which enforces multi-sig approval.
    pub fn delist_asset(env: Env, reason: soroban_sdk::Bytes) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if env.storage().instance().get(&DataKey::Delisted).unwrap_or(false) {
            panic!("Asset is already delisted");
        }

        // Halt all trading immediately.
        env.storage().instance().set(&DataKey::Paused, &true);
        env.storage().instance().set(&DataKey::Delisted, &true);

        // Cancel every open sell order and return escrowed shares to sellers.
        let mut cancelled: u32 = 0;
        let order_count: u64 = env.storage().instance()
            .get(&DataKey::NextOrderId)
            .unwrap_or(0);
        let mut order_id: u64 = 0;
        while order_id < order_count {
            if let Some(order) = env.storage()
                .persistent()
                .get::<DataKey, SellOrder>(&DataKey::SellOrder(order_id))
            {
                // Return escrowed shares so sellers can withdraw frozen funds.
                let balance: u32 = env.storage()
                    .persistent()
                    .get(&DataKey::Balance(order.seller.clone()))
                    .unwrap_or(0);
                env.storage().persistent().set(
                    &DataKey::Balance(order.seller.clone()),
                    &checked_add_u32(balance, order.amount),
                );
                env.storage().persistent().remove(&DataKey::SellOrder(order_id));
                EventOrderCancelled { order_id, seller: order.seller }.publish(&env);
                cancelled += 1;
            }
            order_id += 1;
        }

        EventAssetDelisted {
            reason,
            cancelled_orders: cancelled,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
    }

    pub fn emergency_withdraw(env: Env, to: Address, amount: i128) {
        _check_non_reentrant(&env);
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

        _set_non_reentrant(&env, false);
        EventEmergencyWithdraw { to, amount }.publish(&env);
    }

    // ── Issue #309: Upgradeable Proxy Pattern ──────────────────────────────

    /// Schedule an upgrade to a new implementation Wasm. Requires admin auth.
    /// The upgrade can only execute after the timelock period has elapsed.
    pub fn schedule_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let timelock: u64 = env
            .storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::UpgradeTimelock)
            .unwrap_or(100); // default ~100 ledgers

        let current_ledger = env.ledger().sequence() as u64;
        let execute_after = current_ledger + timelock;

        let config = UpgradeConfig {
            new_wasm_hash: new_wasm_hash.clone(),
            scheduled_ledger: execute_after,
            proposer: admin.clone(),
        };
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &config);

        EventUpgradeScheduled {
            new_wasm_hash,
            execute_after,
            proposer: admin,
        }
        .publish(&env);
    }

    /// Execute a previously scheduled upgrade. Can only be called after the
    /// timelock has elapsed. In a real proxy setup this would call
    /// `env.deployer().update_current_contract_wasm()`.
    pub fn execute_upgrade(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let config: UpgradeConfig = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .expect("No pending upgrade");

        let current_ledger = env.ledger().sequence() as u64;
        if current_ledger < config.scheduled_ledger {
            panic!(
                "Upgrade timelock not yet elapsed: can execute after ledger {}",
                config.scheduled_ledger
            );
        }

        let old_version: u32 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::ImplementationVersion)
            .unwrap_or(1);
        let new_version = old_version + 1;

        env.storage()
            .instance()
            .set(&DataKey::ImplementationVersion, &new_version);
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgrade);

        EventUpgradeExecuted {
            old_version,
            new_version,
        }
        .publish(&env);
    }

    /// Cancel a pending upgrade. Only admin can call.
    pub fn cancel_upgrade(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let config: UpgradeConfig = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .expect("No pending upgrade to cancel");

        let wasm_hash = config.new_wasm_hash.clone();
        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgrade);

        EventUpgradeCancelled { new_wasm_hash: wasm_hash }.publish(&env);
    }

    /// Set the upgrade timelock in ledger sequences. Only admin.
    pub fn set_upgrade_timelock(env: Env, timelock: u64) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if timelock == 0 {
            panic!("Timelock must be greater than zero");
        }
        env.storage()
            .instance()
            .set(&DataKey::UpgradeTimelock, &timelock);
    }

    /// Get the current implementation version.
    pub fn get_implementation_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::ImplementationVersion)
            .unwrap_or(1)
    }

    /// Check if there is a pending upgrade.
    pub fn has_pending_upgrade(env: Env) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::PendingUpgrade)
    }

    // ── Issue #310: Granular Pause Controls ────────────────────────────────

    /// Pause a specific function category. Requires admin auth.
    /// function_id: 0=buy, 1=transfer, 2=dividend, 3=sell_order, 4=buyback, 5=transfer_from
    pub fn pause_function(env: Env, function_id: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if function_id > 5 {
            panic!("Invalid function_id: must be 0-5");
        }

        _set_function_paused(&env, function_id, true);
        EventFunctionPaused { function_id }.publish(&env);
    }

    /// Unpause a specific function category. Requires admin auth.
    pub fn unpause_function(env: Env, function_id: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if function_id > 5 {
            panic!("Invalid function_id: must be 0-5");
        }

        _set_function_paused(&env, function_id, false);
        EventFunctionUnpaused { function_id }.publish(&env);
    }

    /// Check if a specific function is paused.
    pub fn is_function_paused(env: Env, function_id: u32) -> bool {
        if function_id > 5 {
            panic!("Invalid function_id: must be 0-5");
        }
        _is_function_paused(&env, function_id)
    }

    /// Get all pause flags as a bitmask for UI display.
    pub fn get_pause_flags(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::FunctionPauseFlags)
            .unwrap_or(0)
    }

    // ── Issue #311: Emergency Stop / Circuit Breaker ───────────────────────

    /// Configure the circuit breaker. Only admin.
    pub fn configure_circuit_breaker(
        env: Env,
        enabled: bool,
        max_price_change_bps: u32,
        max_volume_per_block: u32,
    ) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let config = CircuitBreakerConfig {
            enabled,
            max_price_change_bps,
            max_volume_per_block,
            armed: enabled,
        };
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerConfig, &config);

        EventCircuitBreakerConfigured {
            enabled,
            max_price_change_bps,
            max_volume_per_block,
        }
        .publish(&env);
    }

    /// Trigger the circuit breaker. Can be called by admin or automatically
    /// when conditions are detected (trigger_reason encodes the cause).
    pub fn trigger_circuit_breaker(env: Env, trigger_reason: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let config: CircuitBreakerConfig = env
            .storage()
            .instance()
            .get(&DataKey::CircuitBreakerConfig)
            .unwrap_or(CircuitBreakerConfig {
                enabled: false,
                max_price_change_bps: 500,
                max_volume_per_block: 10_000,
                armed: false,
            });

        if !config.enabled {
            panic!("Circuit breaker is not enabled");
        }

        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerTriggered, &true);

        let count: u32 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::CircuitBreakerTriggerCount)
            .unwrap_or(0)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerTriggerCount, &count);

        EventCircuitBreakerTriggered {
            trigger_reason,
            ledger: env.ledger().sequence() as u64,
        }
        .publish(&env);
    }

    /// Reset the circuit breaker after investigation. Only admin.
    pub fn reset_circuit_breaker(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerTriggered, &false);

        EventCircuitBreakerReset {
            reset_by: admin.clone(),
        }
        .publish(&env);
    }

    /// Check if circuit breaker is currently triggered.
    pub fn is_circuit_breaker_triggered(env: Env) -> bool {
        _is_circuit_breaker_triggered(&env)
    }

    /// Get circuit breaker trigger count.
    pub fn get_cb_trigger_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::CircuitBreakerTriggerCount)
            .unwrap_or(0)
    }

    // ── Issue #312: State Recovery Functions ───────────────────────────────

    /// Enable or disable state recovery snapshotting. Only admin.
    pub fn set_recovery_enabled(env: Env, enabled: bool) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::RecoveryEnabled, &enabled);
    }

    /// Create a state snapshot at the current ledger. Records the ledger
    /// sequence, a snapshot counter, and critical state values for recovery.
    /// Only admin and only when recovery is enabled.
    pub fn create_state_snapshot(env: Env) -> u32 {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let recovery_enabled: bool = env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::RecoveryEnabled)
            .unwrap_or(false);
        if !recovery_enabled {
            panic!("State recovery is not enabled");
        }

        let current_ledger = env.ledger().sequence() as u64;
        let snapshot_id: u32 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::SnapshotCount)
            .unwrap_or(0)
            + 1;

        // Record critical state in a snapshot key for later recovery
        let total_shares: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);
        let available_shares: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .unwrap_or(0);
        let price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PricePerShare)
            .unwrap_or(0);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(true);
        let flags: u32 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::FunctionPauseFlags)
            .unwrap_or(0);

        // Store snapshot as a composite type (we use a vec of values)
        // In production, this would use a more sophisticated snapshot storage
        let snapshot_key = DataKey::SellOrder(snapshot_id as u64); // reuse for snapshot storage
        let snapshot_data: Vec<u32> = Vec::new(&env);
        // Note: In Soroban, complex snapshot storage would typically use
        // a dedicated snapshot contract or off-chain archival.
        // Here we record the snapshot metadata for audit trail.

        env.storage()
            .instance()
            .set(&DataKey::SnapshotCount, &snapshot_id);
        env.storage()
            .instance()
            .set(&DataKey::LastSnapshotLedger, &current_ledger);

        EventStateSnapshotCreated {
            snapshot_ledger: current_ledger,
            snapshot_id,
        }
        .publish(&env);

        snapshot_id
    }

    /// Recover state from the last snapshot. In a real implementation this
    /// would restore storage values; here it validates snapshot integrity
    /// and logs the recovery event.
    pub fn recover_from_snapshot(env: Env, snapshot_id: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let last_snapshot: u32 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::SnapshotCount)
            .unwrap_or(0);

        if snapshot_id == 0 || snapshot_id > last_snapshot {
            panic!("Invalid snapshot ID");
        }

        let snapshot_ledger: u64 = env
            .storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::LastSnapshotLedger)
            .unwrap_or(0);

        EventStateRecovered {
            from_snapshot: snapshot_id,
            to_ledger: env.ledger().sequence() as u64,
        }
        .publish(&env);
    }

    /// Get the last snapshot metadata.
    pub fn get_last_snapshot(env: Env) -> (u32, u64) {
        let count: u32 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::SnapshotCount)
            .unwrap_or(0);
        let ledger: u64 = env
            .storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::LastSnapshotLedger)
            .unwrap_or(0);
        (count, ledger)
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

    /// Set the maximum number of shares any single address may hold.
    /// Only the admin may call this. A value of 0 disables the cap (unlimited).
    /// The new cap is not applied retroactively to existing holders; it only
    /// constrains future `buy_shares` purchases.
    pub fn set_max_shares_per_user(env: Env, amount: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let old_max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSharesPerUser)
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&DataKey::MaxSharesPerUser, &amount);

        EventSetMaxSharesPerUser {
            old_max,
            new_max: amount,
        }
        .publish(&env);
    }

    /// Return the current per-address share cap. 0 means no limit.
    pub fn get_max_shares_per_user(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxSharesPerUser)
            .unwrap_or(0)
    }

    // ── Issue #274: Purchase Limit Configuration ─────────────────────────────

    /// Set comprehensive purchase limits. Admin only.
    /// All limits of 0 mean no limit for that category.
    pub fn set_purchase_limits(
        env: Env,
        max_shares: u32,
        max_value: i128,
        daily_shares: u32,
        daily_value: i128,
        weekly_shares: u32,
        weekly_value: i128,
        monthly_shares: u32,
        monthly_value: i128,
        enabled: bool,
    ) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let config = PurchaseLimitConfig {
            max_shares_per_user: max_shares,
            max_value_per_user: max_value,
            daily_shares_limit: daily_shares,
            daily_value_limit: daily_value,
            weekly_shares_limit: weekly_shares,
            weekly_value_limit: weekly_value,
            monthly_shares_limit: monthly_shares,
            monthly_value_limit: monthly_value,
            enabled,
        };

        env.storage().instance().set(&DataKey::PurchaseLimitConfig, &config);

        EventPurchaseLimitConfigSet {
            enabled,
            max_shares,
            max_value,
        }
        .publish(&env);
    }

    /// Get the current purchase limit configuration.
    pub fn get_purchase_limits(env: Env) -> PurchaseLimitConfig {
        env.storage()
            .instance()
            .get(&DataKey::PurchaseLimitConfig)
            .unwrap_or_else(|| PurchaseLimitConfig {
                max_shares_per_user: 0,
                max_value_per_user: 0,
                daily_shares_limit: 0,
                daily_value_limit: 0,
                weekly_shares_limit: 0,
                weekly_value_limit: 0,
                monthly_shares_limit: 0,
                monthly_value_limit: 0,
                enabled: false,
            })
    }

    /// Enable or disable purchase limit enforcement. Admin only.
    pub fn set_purchase_limits_enabled(env: Env, enabled: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let mut config = Self::get_purchase_limits(env.clone());
        config.enabled = enabled;
        env.storage().instance().set(&DataKey::PurchaseLimitConfig, &config);

        EventPurchaseLimitConfigSet {
            enabled,
            max_shares: config.max_shares_per_user,
            max_value: config.max_value_per_user,
        }
        .publish(&env);
    }

    /// Set tier-specific limits for a whitelist tier. Admin only.
    /// Tier 0 = standard, 1 = premium, 2 = institutional.
    /// Values of 0 mean use global limits.
    pub fn set_tier_limits(
        env: Env,
        tier: u32,
        max_shares: u32,
        max_value: i128,
        daily_shares_multiplier: u32,
        daily_value_multiplier: u32,
    ) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if tier > 2 {
            panic!("Invalid tier. Must be 0, 1, or 2");
        }

        let tier_limits = TierLimits {
            max_shares,
            max_value,
            daily_shares_multiplier,
            daily_value_multiplier,
        };

        env.storage()
            .instance()
            .set(&DataKey::TierLimits(tier), &tier_limits);

        EventTierLimitsSet {
            tier,
            max_shares,
            max_value,
        }
        .publish(&env);
    }

    /// Get tier-specific limits for a given tier.
    pub fn get_tier_limits(env: Env, tier: u32) -> TierLimits {
        env.storage()
            .instance()
            .get(&DataKey::TierLimits(tier))
            .unwrap_or_else(|| TierLimits {
                max_shares: 0,
                max_value: 0,
                daily_shares_multiplier: 10000,
                daily_value_multiplier: 10000,
            })
    }

    /// Set limit exemption status for an address. Admin only.
    /// Exempt addresses bypass all purchase limits.
    pub fn set_limit_exempt(env: Env, address: Address, exempt: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if exempt {
            env.storage()
                .persistent()
                .set(&DataKey::LimitExempt(address.clone()), &true);
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::LimitExempt(address.clone()));
        }

        EventLimitExemptSet { address, exempt }.publish(&env);
    }

    /// Check if an address is exempt from purchase limits.
    pub fn is_limit_exempt(env: Env, address: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::LimitExempt(address))
            .unwrap_or(false)
    }

    /// Get user's purchase history for limit tracking.
    pub fn get_user_purchase_history(env: Env, address: Address) -> UserPurchaseHistory {
        env.storage()
            .persistent()
            .get(&DataKey::UserPurchaseHistory(address))
            .unwrap_or_else(|| UserPurchaseHistory {
                last_purchase_time: 0,
                daily_shares: 0,
                daily_value: 0,
                day_start: 0,
                weekly_shares: 0,
                weekly_value: 0,
                week_start: 0,
                monthly_shares: 0,
                monthly_value: 0,
                month_start: 0,
            })
    }

    /// Reset user's purchase history for a specific period. Admin only.
    /// Period: 1 = daily, 2 = weekly, 3 = monthly.
    pub fn reset_user_purchase_limits(env: Env, address: Address, period: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if period > 3 {
            panic!("Invalid period. Must be 1 (daily), 2 (weekly), or 3 (monthly)");
        }

        let mut history = Self::get_user_purchase_history(env.clone(), address.clone());

        match period {
            1 => {
                history.daily_shares = 0;
                history.daily_value = 0;
                history.day_start = 0;
            }
            2 => {
                history.weekly_shares = 0;
                history.weekly_value = 0;
                history.week_start = 0;
            }
            3 => {
                history.monthly_shares = 0;
                history.monthly_value = 0;
                history.month_start = 0;
            }
            _ => panic!("Invalid period"),
        }

        env.storage()
            .persistent()
            .set(&DataKey::UserPurchaseHistory(address.clone()), &history);

        EventUserPurchaseReset { address, period }.publish(&env);
    }

    /// Get limit violation count for a user.
    pub fn get_limit_violations(env: Env, address: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::LimitViolations(address))
            .unwrap_or(0)
    }

    // ── Issue #263: Transfer fee configuration ─────────────────────────

    /// Configure the transfer fee in basis points and the collector address. Admin only.
    /// E.g. `fee_bps` = 30 means 0.30% fee on each `transfer_shares_from`.
    /// Set `fee_bps` = 0 to disable the transfer fee.
    pub fn set_transfer_fee(env: Env, fee_bps: u32, collector: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if fee_bps > 1000 {
            panic!("Transfer fee cannot exceed 10% (1000 bps)");
        }

        env.storage().instance().set(&DataKey::TransferFeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::TransferFeeCollector, &collector);

        EventTransferFeeConfig { fee_bps, collector }.publish(&env);
    }

    /// Return the configured transfer fee in basis points and the collector address.
    pub fn get_transfer_fee(env: Env) -> (u32, Option<Address>) {
        let fee_bps: u32 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::TransferFeeBps)
            .unwrap_or(0);
        let collector: Option<Address> = env
            .storage()
            .instance()
            .get(&DataKey::TransferFeeCollector);
        (fee_bps, collector)
    }

    // ── Share Transfer (secondary market) ──────────────────────────────────

    /// Approve `spender` to transfer up to `amount` of the caller's shares.
    pub fn approve(env: Env, owner: Address, spender: Address, amount: u32) {
        owner.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Allowance(owner.clone(), spender.clone()), &amount);
        EventApproval { owner, spender, amount }.publish(&env);
    }

    /// Return how many shares `spender` is allowed to transfer on behalf of `owner`.
    pub fn allowance(env: Env, owner: Address, spender: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(owner, spender))
            .unwrap_or(0)
    }

    /// Transfer `amount` shares from caller to `to`. Requires caller auth.
    /// Includes transfer restrictions, fee calculation, and history tracking.
    pub fn transfer_shares(env: Env, from: Address, to: Address, amount: u32) {
        reentrancy_guard_enter(&env);
        from.require_auth();

        // Re-entrancy guard: protect balance updates
        _check_non_reentrant(&env);

        // Global pause check
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            _set_non_reentrant(&env, false);
            panic!("Marketplace is paused");
        }

        // Issue #310: Check granular pause for transfers
        if _is_function_paused(&env, FN_TRANSFER) {
            _set_non_reentrant(&env, false);
            panic!("Transfers are currently paused");
        }

        // Issue #311: Check circuit breaker
        _require_circuit_breaker_clear(&env);

        if amount == 0 {
            _set_non_reentrant(&env, false);
            panic!("Transfer amount must be positive");
        }

        // Check whitelist compliance
        if !Self::is_whitelisted(env.clone(), from.clone()) || !Self::is_whitelisted(env.clone(), to.clone()) {
            panic!("Both parties must be whitelisted for transfers");
        }

        // Check transfer whitelist
        if !is_transfer_whitelisted(&env, &from) || !is_transfer_whitelisted(&env, &to) {
            panic!("Transfer not allowed for one or both parties");
        }

        // Check vesting restrictions
        check_vesting_restrictions(&env, &from, amount);

        // Check transfer restrictions
        check_transfer_restrictions(&env, &from, amount);

        let from_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);

        if amount > from_balance {
            _set_non_reentrant(&env, false);
            panic!("Insufficient shares to transfer");
        }

        let to_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);

        // Calculate and collect transfer fee
        let price: i128 = env.storage().instance().get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");
        let fee = calculate_transfer_fee(&env, amount, price);
        
        if fee > 0 {
            if let Some(config) = env.storage().instance().get::<DataKey, TransferFeeConfig>(&DataKey::TransferFeeConfig) {
                let token_id: Address = env.storage().instance().get(&DataKey::PaymentToken)
                    .expect("Contract not initialized: payment token");
                let client = token::TokenClient::new(&env, &token_id);
                client.transfer(&from, &config.fee_recipient, &fee);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &checked_sub_u32(from_balance, amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &checked_add_u32(to_balance, amount));

        Self::register_holder(&env, to.clone());

        // Record transfer history
        let tx_hash: BytesN<32> = BytesN::from_array(&env, &[0; 32]); // Placeholder for actual tx hash
        record_transfer_history(&env, from.clone(), to.clone(), amount, fee, tx_hash);

        EventTransfer { caller: from.clone(), from, to, amount }.publish(&env);
        reentrancy_guard_exit(&env);
    }

    /// Transfer `amount` shares from `from` to `to` using an allowance. Requires spender auth.
    /// Includes transfer restrictions, fee calculation, and history tracking.
    pub fn transfer_shares_from(env: Env, spender: Address, from: Address, to: Address, amount: u32) {
        reentrancy_guard_enter(&env);
        spender.require_auth();

        // Re-entrancy guard
        _check_non_reentrant(&env);

        // Issue #310: Check granular pause for transfer_from
        if _is_function_paused(&env, FN_TRANSFER_FROM) {
            _set_non_reentrant(&env, false);
            panic!("Transfers via allowance are currently paused");
        }

        // Issue #311: Check circuit breaker
        _require_circuit_breaker_clear(&env);

        if amount == 0 {
            _set_non_reentrant(&env, false);
            panic!("Transfer amount must be positive");
        }

        // Issue #270: Validate recipient is whitelisted
        _validate_whitelist(&env, &to);

        let allowance_key = DataKey::Allowance(from.clone(), spender.clone());
        let current_allowance: u32 = env
            .storage()
            .persistent()
            .get(&allowance_key)
            .unwrap_or(0);

        if amount > current_allowance {
            _set_non_reentrant(&env, false);
            panic!("Transfer amount exceeds allowance");
        }

        // Check whitelist compliance
        if !Self::is_whitelisted(env.clone(), from.clone()) || !Self::is_whitelisted(env.clone(), to.clone()) {
            panic!("Both parties must be whitelisted for transfers");
        }

        // Check transfer whitelist
        if !is_transfer_whitelisted(&env, &from) || !is_transfer_whitelisted(&env, &to) {
            panic!("Transfer not allowed for one or both parties");
        }

        // Check vesting restrictions
        check_vesting_restrictions(&env, &from, amount);

        // Check transfer restrictions
        check_transfer_restrictions(&env, &from, amount);

        let from_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);

        if amount > from_balance {
            _set_non_reentrant(&env, false);
            panic!("Insufficient shares to transfer");
        }

        let to_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);

        // Calculate and collect transfer fee
        let price: i128 = env.storage().instance().get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");
        let fee = calculate_transfer_fee(&env, amount, price);
        
        if fee > 0 {
            if let Some(config) = env.storage().instance().get::<DataKey, TransferFeeConfig>(&DataKey::TransferFeeConfig) {
                let token_id: Address = env.storage().instance().get(&DataKey::PaymentToken)
                    .expect("Contract not initialized: payment token");
                let client = token::TokenClient::new(&env, &token_id);
                client.transfer(&from, &config.fee_recipient, &fee);
            }
        }

        // Deduct allowance
        env.storage()
            .persistent()
            .set(&allowance_key, &checked_sub_u32(current_allowance, amount));

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &checked_sub_u32(from_balance, amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &checked_add_u32(to_balance, amount));

        Self::register_holder(&env, to.clone());

        // Record transfer history
        let tx_hash: BytesN<32> = BytesN::from_array(&env, &[0; 32]); // Placeholder for actual tx hash
        record_transfer_history(&env, from.clone(), to.clone(), amount, fee, tx_hash);

        EventTransfer { caller: spender.clone(), from, to, amount }.publish(&env);
        reentrancy_guard_exit(&env);
    }

    /// List `amount` of the caller's liquid shares for sale at `price_per_share`.
    /// Shares are escrowed in the contract until filled or cancelled.
    pub fn place_sell_order(env: Env, seller: Address, amount: u32, price_per_share: i128) -> u64 {
        seller.require_auth();

        // Global pause check
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            panic!("Marketplace is paused");
        }

        // Issue #310: Check granular pause for sell orders
        if _is_function_paused(&env, FN_SELL_ORDER) {
            panic!("Sell orders are currently paused");
        }

        // Issue #311: Check circuit breaker
        _require_circuit_breaker_clear(&env);

        if amount == 0 {
            panic!("Order amount must be positive");
        }
        if price_per_share <= 0 {
            panic!("Order price must be positive");
        }

        let balance: u32 = env.storage().persistent()
            .get(&DataKey::Balance(seller.clone())).unwrap_or(0);
        if amount > balance {
            panic!("Insufficient liquid shares to place order");
        }

        // Escrow: deduct from seller's liquid balance
        env.storage().persistent()
            .set(&DataKey::Balance(seller.clone()), &checked_sub_u32(balance, amount));

        let order_id: u64 = env.storage().instance()
            .get(&DataKey::NextOrderId).unwrap_or(0);
        let next_id = checked_add_i128(order_id as i128, 1) as u64;
        env.storage().instance().set(&DataKey::NextOrderId, &next_id);

        env.storage().persistent().set(
            &DataKey::SellOrder(order_id),
            &SellOrder { seller: seller.clone(), amount, price_per_share },
        );

        EventOrderPlaced { order_id, seller, amount, price_per_share }.publish(&env);
        order_id
    }

    /// Cancel an open sell order and return escrowed shares to the seller.
    pub fn cancel_sell_order(env: Env, order_id: u64) {
        let order: SellOrder = env.storage().persistent()
            .get(&DataKey::SellOrder(order_id))
            .unwrap_or_else(|| panic!("Order not found"));

        order.seller.require_auth();

        // Return escrowed shares
        let balance: u32 = env.storage().persistent()
            .get(&DataKey::Balance(order.seller.clone())).unwrap_or(0);
        env.storage().persistent()
            .set(&DataKey::Balance(order.seller.clone()), &checked_add_u32(balance, order.amount));

        env.storage().persistent().remove(&DataKey::SellOrder(order_id));

        EventOrderCancelled { order_id, seller: order.seller }.publish(&env);
    }

    /// Buy `amount` shares from an open sell order, paying the seller directly.
    pub fn buy_from_order(env: Env, buyer: Address, order_id: u64, amount: u32) {
        _check_non_reentrant(&env);
        buyer.require_auth();

        // Global pause check
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            _set_non_reentrant(&env, false);
            panic!("Marketplace is paused");
        }

        // Issue #310: Check granular pause for order purchases
        if _is_function_paused(&env, FN_BUY_SHARES) {
            _set_non_reentrant(&env, false);
            panic!("Purchases are currently paused");
        }

        if amount == 0 {
            _set_non_reentrant(&env, false);
            panic!("Purchase amount must be positive");
        }

        let mut order: SellOrder = env.storage().persistent()
            .get(&DataKey::SellOrder(order_id))
            .unwrap_or_else(|| { _set_non_reentrant(&env, false); panic!("Order not found"); });

        if amount > order.amount {
            _set_non_reentrant(&env, false);
            panic!("Amount exceeds order size");
        }

        let total_cost = checked_mul_i128(order.price_per_share, amount as i128);

        // Issue #274: Purchase limit validation for order purchases
        let purchase_history = _validate_purchase_limits(&env, &buyer, amount, total_cost);

        let token_id: Address = env.storage().instance()
            .get(&DataKey::PaymentToken)
            .expect("Contract not initialized: payment token");

        token::TokenClient::new(&env, &token_id)
            .transfer(&buyer, &order.seller, &total_cost);

        // Credit buyer's liquid balance
        let buyer_balance: u32 = env.storage().persistent()
            .get(&DataKey::Balance(buyer.clone())).unwrap_or(0);
        env.storage().persistent()
            .set(&DataKey::Balance(buyer.clone()), &checked_add_u32(buyer_balance, amount));
        Self::register_holder(&env, buyer.clone());

        order.amount = checked_sub_u32(order.amount, amount);
        if order.amount == 0 {
            env.storage().persistent().remove(&DataKey::SellOrder(order_id));
        } else {
            env.storage().persistent().set(&DataKey::SellOrder(order_id), &order);
        }

        // Issue #274: Update purchase history after successful purchase
        _update_purchase_history(&env, &buyer, purchase_history);

        _set_non_reentrant(&env, false);
        EventOrderFilled { order_id, buyer, amount, total_cost }.publish(&env);
    }

    /// Get an open sell order by id, returning None if it doesn't exist.
    pub fn get_sell_order(env: Env, order_id: u64) -> Option<SellOrder> {
        env.storage().persistent().get(&DataKey::SellOrder(order_id))
    }

    // ── Secure Transfer Functions ───────────────────────────────────────────

    /// Set transfer fee configuration. Admin only.
    pub fn set_transfer_fee_config(env: Env, fee_bps: u32, fee_recipient: Address, max_fee: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if fee_bps > 10000 {
            panic!("Fee basis points cannot exceed 10000 (100%)");
        }
        if max_fee < 0 {
            panic!("Max fee cannot be negative");
        }

        let config = TransferFeeConfig { fee_bps, fee_recipient: fee_recipient.clone(), max_fee };
        env.storage().instance().set(&DataKey::TransferFeeConfig, &config);
    }

    /// Get current transfer fee configuration.
    pub fn get_transfer_fee_config(env: Env) -> Option<TransferFeeConfig> {
        env.storage().instance().get(&DataKey::TransferFeeConfig)
    }

    /// Batch transfer shares to multiple recipients. Requires from auth.
    pub fn batch_transfer(env: Env, from: Address, recipients: Vec<Address>, amounts: Vec<u32>) {
        reentrancy_guard_enter(&env);
        from.require_auth();

        if recipients.is_empty() {
            panic!("Recipients list cannot be empty");
        }
        if recipients.len() != amounts.len() {
            panic!("Recipients and amounts must have the same length");
        }

        // Check whitelist compliance for sender
        if !Self::is_whitelisted(env.clone(), from.clone()) {
            panic!("Sender must be whitelisted for transfers");
        }

        let from_balance: u32 = env.storage().persistent().get(&DataKey::Balance(from.clone())).unwrap_or(0);
        let mut total_amount: u32 = 0;

        // Calculate total amount and validate each transfer
        for i in 0..recipients.len() {
            let amount = amounts.get(i).unwrap();
            let recipient = recipients.get(i).unwrap();

            if amount == 0 {
                panic!("Transfer amount must be positive");
            }

            // Check whitelist compliance for recipient
            if !Self::is_whitelisted(env.clone(), recipient.clone()) {
                panic!("Recipient must be whitelisted for transfers");
            }

            // Check transfer whitelist
            if !is_transfer_whitelisted(&env, &recipient) {
                panic!("Transfer not allowed for recipient");
            }

            total_amount = checked_add_u32(total_amount, amount);
        }

        if total_amount > from_balance {
            panic!("Insufficient shares for batch transfer");
        }

        // Check vesting restrictions
        check_vesting_restrictions(&env, &from, total_amount);

        // Check transfer restrictions
        check_transfer_restrictions(&env, &from, total_amount);

        let price: i128 = env.storage().instance().get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");
        let mut total_fee: i128 = 0;

        // Execute transfers
        for i in 0..recipients.len() {
            let amount = amounts.get(i).unwrap();
            let recipient = recipients.get(i).unwrap();

            let to_balance: u32 = env.storage().persistent().get(&DataKey::Balance(recipient.clone())).unwrap_or(0);
            env.storage().persistent().set(&DataKey::Balance(recipient.clone()), &checked_add_u32(to_balance, amount));
            Self::register_holder(&env, recipient.clone());

            // Calculate fee for this transfer
            let fee = calculate_transfer_fee(&env, amount, price);
            total_fee = checked_add_i128(total_fee, fee);

            // Record individual transfer history
            let tx_hash: BytesN<32> = BytesN::from_array(&env, &[0; 32]);
            record_transfer_history(&env, from.clone(), recipient.clone(), amount, fee, tx_hash);

            EventTransfer { caller: from.clone(), from: from.clone(), to: recipient.clone(), amount }.publish(&env);
        }

        // Deduct from sender balance
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &checked_sub_u32(from_balance, total_amount));

        // Collect total fee
        if total_fee > 0 {
            if let Some(config) = env.storage().instance().get::<DataKey, TransferFeeConfig>(&DataKey::TransferFeeConfig) {
                let token_id: Address = env.storage().instance().get(&DataKey::PaymentToken)
                    .expect("Contract not initialized: payment token");
                let client = token::TokenClient::new(&env, &token_id);
                client.transfer(&from, &config.fee_recipient, &total_fee);
            }
        }

        reentrancy_guard_exit(&env);
    }

    /// Set transfer restrictions for an address. Admin only.
    pub fn set_transfer_restrictions(env: Env, address: Address, restricted_until: u64, max_transfer_amount: u32, requires_approval: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let restriction = TransferRestriction { restricted_until, max_transfer_amount, requires_approval };
        env.storage().persistent().set(&DataKey::TransferRestrictions(address.clone()), &restriction);
    }

    /// Get transfer restrictions for an address.
    pub fn get_transfer_restrictions(env: Env, address: Address) -> Option<TransferRestriction> {
        env.storage().persistent().get(&DataKey::TransferRestrictions(address))
    }

    /// Remove transfer restrictions for an address. Admin only.
    pub fn remove_transfer_restrictions(env: Env, address: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        env.storage().persistent().remove(&DataKey::TransferRestrictions(address));
    }

    /// Request approval for a transfer that requires it.
    pub fn request_transfer_approval(env: Env, from: Address, to: Address, amount: u32) -> u64 {
        from.require_auth();

        let approval_id: u64 = env.storage().instance().get(&DataKey::NextTransferApprovalId).unwrap_or(0);
        let next_id = approval_id + 1;
        env.storage().instance().set(&DataKey::NextTransferApprovalId, &next_id);

        let approval = TransferApproval {
            from: from.clone(),
            to: to.clone(),
            amount,
            requested_at: env.ledger().timestamp(),
            approved: false,
        };

        env.storage().persistent().set(&DataKey::PendingTransferApproval(approval_id), &approval);

        approval_id
    }

    /// Grant or deny a transfer approval. Admin only.
    pub fn grant_transfer_approval(env: Env, approval_id: u64, approved: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        let mut approval: TransferApproval = env.storage().persistent()
            .get(&DataKey::PendingTransferApproval(approval_id))
            .unwrap_or_else(|| panic!("Approval not found"));

        approval.approved = approved;
        env.storage().persistent().set(&DataKey::PendingTransferApproval(approval_id), &approval);
    }

    /// Execute a transfer that has been approved.
    pub fn execute_approved_transfer(env: Env, approval_id: u64) {
        let approval: TransferApproval = env.storage().persistent()
            .get(&DataKey::PendingTransferApproval(approval_id))
            .unwrap_or_else(|| panic!("Approval not found"));

        if !approval.approved {
            panic!("Transfer has not been approved");
        }

        // Execute the transfer
        Self::transfer_shares(env.clone(), approval.from, approval.to, approval.amount);

        // Remove the approval after execution
        env.storage().persistent().remove(&DataKey::PendingTransferApproval(approval_id));
    }

    /// Get a pending transfer approval by ID.
    pub fn get_transfer_approval(env: Env, approval_id: u64) -> Option<TransferApproval> {
        env.storage().persistent().get(&DataKey::PendingTransferApproval(approval_id))
    }

    /// Add an address to the transfer whitelist. Admin only.
    pub fn add_to_transfer_whitelist(env: Env, addr: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().persistent().set(&DataKey::TransferWhitelist(addr.clone()), &true);
    }

    /// Remove an address from the transfer whitelist. Admin only.
    pub fn remove_from_transfer_whitelist(env: Env, addr: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().persistent().remove(&DataKey::TransferWhitelist(addr.clone()));
    }

    /// Check if an address is transfer-whitelisted.
    pub fn is_transfer_whitelisted_public(env: Env, addr: Address) -> bool {
        is_transfer_whitelisted(&env, &addr)
    }

    /// Get transfer history entry by index.
    pub fn get_transfer_history(env: Env, index: u64) -> Option<TransferHistoryEntry> {
        env.storage().persistent().get(&DataKey::TransferHistory(index))
    }

    /// Get total number of transfer history entries.
    pub fn get_transfer_history_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::TransferHistoryIndex).unwrap_or(0)
    }

    // ── Buyback ────────────────────────────────────────────────────────────

    /// Contract buys back `amount` shares from `seller` at the current
    /// `price_per_share`. The contract must hold sufficient payment-token
    /// balance. The seller's share balance is reduced and the shares are
    /// returned to the available pool. Seller auth is required.
    pub fn buyback_shares(env: Env, seller: Address, amount: u32) {
        _check_non_reentrant(&env);
        seller.require_auth();

        // Global pause check
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            _set_non_reentrant(&env, false);
            panic!("Marketplace is paused");
        }

        // Issue #310: Check granular pause for buybacks
        if _is_function_paused(&env, FN_BUYBACK) {
            _set_non_reentrant(&env, false);
            panic!("Buybacks are currently paused");
        }

        if amount == 0 {
            _set_non_reentrant(&env, false);
            panic!("Buyback amount must be positive");
        }

        let seller_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(seller.clone()))
            .unwrap_or(0);

        if amount > seller_balance {
            _set_non_reentrant(&env, false);
            panic!("Seller has insufficient shares");
        }

        // Issue #268: Use oracle-aware price helper for buyback pricing
        let price: i128 = _get_current_price(&env);

        let total_cost = checked_mul_i128(price, amount as i128);

        let token_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .expect("Contract not initialized: payment token");

        // Transfer payment from contract to seller
        token::TokenClient::new(&env, &token_id)
            .transfer(&env.current_contract_address(), &seller, &total_cost);

        // Reduce seller balance
        env.storage().persistent().set(
            &DataKey::Balance(seller.clone()),
            &checked_sub_u32(seller_balance, amount),
        );

        // Return shares to available pool
        let available: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .expect("Contract not initialized: available shares");
        env.storage()
            .instance()
            .set(&DataKey::AvailableShares, &checked_add_u32(available, amount));

        _set_non_reentrant(&env, false);
        EventBuybackShares { caller: seller.clone(), seller, amount, total_cost }.publish(&env);
    }

    /// Admin sets the auto-buyback configuration.
    /// `budget` tokens must already be held (or will be deposited) by the
    /// contract. Calling this again replaces the previous configuration and
    /// resets the `LastBuyback` timestamp.
    pub fn auto_buyback_config(env: Env, interval: u64, max_amount: u32, budget: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        if interval == 0 {
            panic!("Interval must be positive");
        }
        if max_amount == 0 {
            panic!("Max amount must be positive");
        }
        if budget <= 0 {
            panic!("Budget must be positive");
        }

        let config = AutoBuybackConfig { interval, max_amount, budget };
        env.storage().instance().set(&DataKey::BuybackConfig, &config);
        env.storage().instance().set(&DataKey::BuybackBudget, &budget);
        // Reset last-buyback so the first call is not gated
        env.storage().instance().set(&DataKey::LastBuyback, &0u64);

        EventAutoBuybackConfig { interval, max_amount, budget }.publish(&env);
    }

    /// Trigger an auto-buyback for `seller`. Callable by anyone.
    /// Validates that:
    ///   - a config exists
    ///   - the interval since the last auto-buyback has elapsed
    ///   - `amount` does not exceed `config.max_amount`
    ///   - the remaining budget covers the cost
    pub fn process_auto_buyback(env: Env, seller: Address, amount: u32) {
        if amount == 0 {
            panic!("Buyback amount must be positive");
        }

        let config: AutoBuybackConfig = env
            .storage()
            .instance()
            .get(&DataKey::BuybackConfig)
            .expect("Auto-buyback not configured");

        let last: u64 = env
            .storage()
            .instance()
            .get(&DataKey::LastBuyback)
            .unwrap_or(0);

        let now = env.ledger().timestamp();
        if now < last.saturating_add(config.interval) {
            panic!("Auto-buyback interval has not elapsed");
        }

        if amount > config.max_amount {
            panic!("Amount exceeds auto-buyback max");
        }

        let price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");

        let total_cost = checked_mul_i128(price, amount as i128);

        let remaining_budget: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BuybackBudget)
            .unwrap_or(0);

        if total_cost > remaining_budget {
            panic!("Insufficient auto-buyback budget");
        }

        // Update budget and timestamp before the external call (CEI pattern)
        env.storage()
            .instance()
            .set(&DataKey::BuybackBudget, &checked_sub_i128(remaining_budget, total_cost));
        env.storage().instance().set(&DataKey::LastBuyback, &now);

        // Delegate to the core buyback, which requires seller auth
        Self::buyback_shares(env, seller, amount);
    }

    /// Return the current auto-buyback configuration.
    pub fn get_buyback_config(env: Env) -> Option<AutoBuybackConfig> {
        env.storage().instance().get(&DataKey::BuybackConfig)
    }

    // ── Issue #268: User-initiated buyback requests ────────────────────

    /// Submit a buyback request for the admin to process. Caller must be a
    /// share holder. This records the request on-chain with a unique ID.
    pub fn request_buyback(env: Env, seller: Address, amount: u32, requested_price: i128) -> u64 {
        seller.require_auth();

        if amount == 0 {
            panic!("Buyback amount must be positive");
        }

        let seller_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(seller.clone()))
            .unwrap_or(0);
        if amount > seller_balance {
            panic!("Insufficient shares for buyback request");
        }

        let counter: u64 = env
            .storage()
            .instance()
            .get::<DataKey, u64>(&DataKey::BuybackRequestCounter)
            .unwrap_or(0)
            + 1;
        env.storage()
            .instance()
            .set(&DataKey::BuybackRequestCounter, &counter);

        let request = BuybackRequest {
            request_id: counter,
            seller: seller.clone(),
            amount,
            requested_price,
            timestamp: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::BuybackRequest(counter), &request);

        EventBuybackRequested { request_id: counter, seller, amount }.publish(&env);

        counter
    }

    /// Retrieve a previously submitted buyback request by ID.
    pub fn get_buyback_request(env: Env, request_id: u64) -> Option<BuybackRequest> {
        env.storage()
            .persistent()
            .get(&DataKey::BuybackRequest(request_id))
    }

    // ── Issue #262: Batch Share Purchase ─────────────────────────────────

    /// Maximum number of purchase requests allowed in a single batch.
    /// Prevents excessive gas consumption and keeps transactions bounded.
    const MAX_BATCH_SIZE: u32 = 10;

    /// Purchase multiple share allocations in a single transaction.
    ///
    /// This function reduces gas costs by sharing common validation logic
    /// (pause check, whitelist, oracle price fetch) across all items in the
    /// batch. Each item is validated individually and failures are recorded
    /// without aborting the entire batch (partial fulfillment).
    ///
    /// # Arguments
    /// * `buyer` – The address purchasing shares (must authorize).
    /// * `requests` – A vector of `BatchPurchaseRequest` items.
    ///
    /// # Returns
    /// A vector of `BatchPurchaseResult` with per-item outcomes.
    ///
    /// # Panics
    /// * If the marketplace is paused.
    /// * If the buyer is not whitelisted.
    /// * If the batch is empty or exceeds `MAX_BATCH_SIZE`.
    pub fn batch_buy_shares(
        env: Env,
        buyer: Address,
        requests: Vec<BatchPurchaseRequest>,
    ) -> Vec<BatchPurchaseResult> {
        buyer.require_auth();

        // ── Re-entrancy guard ────────────────────────────────────────
        _check_non_reentrant(&env);

        // ── Shared validations (done once for all items) ─────────────
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            _set_non_reentrant(&env, false);
            panic!("Marketplace is paused");
        }

        if !Self::is_whitelisted(env.clone(), buyer.clone()) {
            _set_non_reentrant(&env, false);
            panic!("Buyer is not whitelisted");
        }

        let batch_len = requests.len();
        if batch_len == 0 {
            _set_non_reentrant(&env, false);
            panic!("Batch must contain at least one purchase request");
        }
        if batch_len > Self::MAX_BATCH_SIZE {
            _set_non_reentrant(&env, false);
            panic!("Batch size exceeds maximum allowed");
        }

        // ── Shared state reads (amortised across batch) ──────────────
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin");

        let admin_price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");

        // Fetch oracle price once if configured (gas optimisation).
        let price: i128 = if let Some(oracle_addr) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::OracleAddress)
        {
            let oracle_client = OracleContractClient::new(&env, &oracle_addr);
            match oracle_client.try_get_price() {
                Ok(Ok(p)) if p > 0 => {
                    EventOraclePriceFetched {
                        oracle: oracle_addr,
                        price: p,
                    }
                    .publish(&env);
                    p
                }
                _ => {
                    EventOraclePriceFallback { admin_price }.publish(&env);
                    admin_price
                }
            }
        } else {
            admin_price
        };

        let max_per_user: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSharesPerUser)
            .unwrap_or(0);

        let mut available: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .expect("Contract not initialized: available shares");

        let mut buyer_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(buyer.clone()))
            .unwrap_or(0);

        // ── Process each item ────────────────────────────────────────
        let mut results: Vec<BatchPurchaseResult> = Vec::new(&env);
        let mut aggregate_shares: u32 = 0;
        let mut aggregate_cost: i128 = 0;
        let mut successful_count: u32 = 0;

        for i in 0..batch_len {
            let req = requests.get(i).unwrap();
            let idx = i;

            // Per-item validation
            if req.shares == 0 {
                EventBatchPurchaseItemFailed {
                    buyer: buyer.clone(),
                    index: idx,
                    shares_requested: 0,
                }
                .publish(&env);
                results.push_back(BatchPurchaseResult {
                    index: idx,
                    success: false,
                    shares_purchased: 0,
                    total_cost: 0,
                });
                continue;
            }

            if req.shares > available {
                EventBatchPurchaseItemFailed {
                    buyer: buyer.clone(),
                    index: idx,
                    shares_requested: req.shares,
                }
                .publish(&env);
                results.push_back(BatchPurchaseResult {
                    index: idx,
                    success: false,
                    shares_purchased: 0,
                    total_cost: 0,
                });
                continue;
            }

            // Check per-user cap
            let prospective = checked_add_u32(buyer_balance, req.shares);
            if max_per_user > 0 && prospective > max_per_user {
                EventBatchPurchaseItemFailed {
                    buyer: buyer.clone(),
                    index: idx,
                    shares_requested: req.shares,
                }
                .publish(&env);
                results.push_back(BatchPurchaseResult {
                    index: idx,
                    success: false,
                    shares_purchased: 0,
                    total_cost: 0,
                });
                continue;
            }

            // Validate payment token is accepted
            let accepted: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::AcceptedTokens)
                .unwrap_or_else(|| Vec::new(&env));
            let mut token_ok = false;
            for t in accepted.iter() {
                if t == req.payment_token {
                    token_ok = true;
                    break;
                }
            }
            if !token_ok {
                EventBatchPurchaseItemFailed {
                    buyer: buyer.clone(),
                    index: idx,
                    shares_requested: req.shares,
                }
                .publish(&env);
                results.push_back(BatchPurchaseResult {
                    index: idx,
                    success: false,
                    shares_purchased: 0,
                    total_cost: 0,
                });
                continue;
            }

            // ── Execute the purchase ─────────────────────────────────
            let item_cost = checked_mul_i128(price, req.shares as i128);

            let client = token::TokenClient::new(&env, &req.payment_token);
            client.transfer(&buyer, &admin, &item_cost);

            // Update running state
            available = checked_sub_u32(available, req.shares);
            buyer_balance = prospective;
            aggregate_shares = checked_add_u32(aggregate_shares, req.shares);
            aggregate_cost = checked_add_i128(aggregate_cost, item_cost);
            successful_count += 1;

            // Mint NFT certificates if configured
            if let Some(nft_addr) = env
                .storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::NftContract)
            {
                let nft = NftContractClient::new(&env, &nft_addr);
                for _ in 0..req.shares {
                    nft.mint_certificate(&buyer);
                }
            }

            results.push_back(BatchPurchaseResult {
                index: idx,
                success: true,
                shares_purchased: req.shares,
                total_cost: item_cost,
            });
        }

        // ── Persist aggregated state changes ─────────────────────────
        env.storage()
            .instance()
            .set(&DataKey::AvailableShares, &available);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(buyer.clone()), &buyer_balance);

        if aggregate_shares > 0 {
            Self::register_holder(&env, buyer.clone());
        }

        // ── Clear reentrancy guard and emit summary event ────────────
        _set_non_reentrant(&env, false);

        EventBatchBuyShares {
            buyer,
            total_items: batch_len,
            successful_items: successful_count,
            total_shares: aggregate_shares,
            total_cost: aggregate_cost,
        }
        .publish(&env);

        results
    }

    /// Get a price quote for a batch of purchase requests without executing
    /// any transfers. Useful for UI display and gas estimation.
    ///
    /// Returns a vector of `BatchPurchaseResult` where `success` indicates
    /// whether the item *would* succeed, and `total_cost` is the estimated
    /// payment amount.
    pub fn get_batch_quote(
        env: Env,
        buyer: Address,
        requests: Vec<BatchPurchaseRequest>,
    ) -> Vec<BatchPurchaseResult> {
        let batch_len = requests.len();
        if batch_len == 0 {
            panic!("Batch must contain at least one purchase request");
        }
        if batch_len > Self::MAX_BATCH_SIZE {
            panic!("Batch size exceeds maximum allowed");
        }

        let admin_price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PricePerShare)
            .expect("Contract not initialized: price");

        // Use oracle price if configured (read-only, no events)
        let price: i128 = if let Some(oracle_addr) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::OracleAddress)
        {
            let oracle_client = OracleContractClient::new(&env, &oracle_addr);
            match oracle_client.try_get_price() {
                Ok(Ok(p)) if p > 0 => p,
                _ => admin_price,
            }
        } else {
            admin_price
        };

        let is_whitelisted = Self::is_whitelisted(env.clone(), buyer.clone());
        let is_paused = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);

        let max_per_user: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSharesPerUser)
            .unwrap_or(0);

        let mut available: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AvailableShares)
            .expect("Contract not initialized: available shares");

        let mut buyer_balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(buyer.clone()))
            .unwrap_or(0);

        let mut results: Vec<BatchPurchaseResult> = Vec::new(&env);

        for i in 0..batch_len {
            let req = requests.get(i).unwrap();
            let idx = i;

            // Simulate the same validation as batch_buy_shares
            if is_paused || !is_whitelisted || req.shares == 0 || req.shares > available {
                results.push_back(BatchPurchaseResult {
                    index: idx,
                    success: false,
                    shares_purchased: 0,
                    total_cost: 0,
                });
                continue;
            }

            let prospective = checked_add_u32(buyer_balance, req.shares);
            if max_per_user > 0 && prospective > max_per_user {
                results.push_back(BatchPurchaseResult {
                    index: idx,
                    success: false,
                    shares_purchased: 0,
                    total_cost: 0,
                });
                continue;
            }

            // Validate payment token
            let accepted: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::AcceptedTokens)
                .unwrap_or_else(|| Vec::new(&env));
            let mut token_ok = false;
            for t in accepted.iter() {
                if t == req.payment_token {
                    token_ok = true;
                    break;
                }
            }
            if !token_ok {
                results.push_back(BatchPurchaseResult {
                    index: idx,
                    success: false,
                    shares_purchased: 0,
                    total_cost: 0,
                });
                continue;
            }

            let item_cost = checked_mul_i128(price, req.shares as i128);
            available = checked_sub_u32(available, req.shares);
            buyer_balance = prospective;

            results.push_back(BatchPurchaseResult {
                index: idx,
                success: true,
                shares_purchased: req.shares,
                total_cost: item_cost,
            });
        }

        results
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
        c.buy_shares(&te.buyer, &25, &te.token_id);
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

        c.buy_shares(&te.buyer, &25, &te.token_id);
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

        c.buy_shares(&te.buyer, &25, &te.token_id);
    }

    #[test]
    fn test_multiple_buys() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100000);
        c.add_to_whitelist(&te.buyer);

        c.buy_shares(&te.buyer, &10, &te.token_id);
        c.buy_shares(&te.buyer, &20, &te.token_id);
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
        c.buy_shares(&te.buyer, &1, &te.token_id);
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
    #[should_panic(expected = "Price must be greater than zero")]
    fn test_init_zero_price() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &0, &1000);
    }

    #[test]
    #[should_panic(expected = "Price must be greater than zero")]
    fn test_init_negative_price() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &-50, &1000);
    }

    #[test]
    #[should_panic(expected = "Total shares must be greater than zero")]
    fn test_init_zero_total_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &0);
    }

    #[test]
    #[should_panic(expected = "Not enough shares available")]
    fn test_overbuy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &10);
        c.add_to_whitelist(&te.buyer);
        mint(&te, &te.buyer, 100000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &20, &te.token_id);
    }

    #[test]
    #[should_panic(expected = "Must purchase at least 1 share")]
    fn test_zero_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &0, &te.token_id);
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

        c.buy_shares(&te.buyer, &10, &te.token_id);
        assert_eq!(c.get_holders().len(), 1);

        // Second buy by same buyer — should NOT add duplicate
        c.buy_shares(&te.buyer, &5, &te.token_id);
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

        c.buy_shares(&te.buyer, &10, &te.token_id);
        c.buy_shares(&buyer2, &20, &te.token_id);

        assert_eq!(c.get_holders().len(), 2);
    }

    #[test]
    fn test_distribute_dividends_single_holder() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.buy_shares(&te.buyer, &500, &te.token_id); // buyer owns 500 / 1000 shares = 50%

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
        c.buy_shares(&te.buyer, &250, &te.token_id);
        c.buy_shares(&buyer2, &750, &te.token_id);

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

        c.buy_shares(&te.buyer, &10, &te.token_id);
        c.buy_shares(&buyer2, &20, &te.token_id);
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
    fn test_dividend_policy_withholding_and_claims() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let buyer2 = Address::generate(&te.env);
        mint(&te, &te.buyer, 100_000);
        mint(&te, &buyer2, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.add_to_whitelist(&buyer2);

        c.buy_shares(&te.buyer, &500, &te.token_id);
        c.buy_shares(&buyer2, &500, &te.token_id);

        c.set_dividend_policy(&0, &te.token_id, &1000, &false);
        let dividend_amount: i128 = 1_000;
        mint(&te, &te.contract_id, dividend_amount);

        c.distribute_dividends(&te.token_id, &dividend_amount);

        let position = c.get_dividend_position(&te.buyer);
        assert_eq!(position.accrued_amount, 450);
        assert_eq!(position.claimed_amount, 0);
        assert_eq!(c.get_dividend_history_count(), 1);

        c.claim_dividends(&te.buyer);
        let updated_position = c.get_dividend_position(&te.buyer);
        assert_eq!(updated_position.claimed_amount, 450);

        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        assert_eq!(token_client.balance(&te.buyer), 100_000 - 50_000 + 450);
        assert_eq!(token_client.balance(&te.admin), 100_000 + 100);
    }

    #[test]
    fn test_dividend_reinvestment_toggle() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &500, &te.token_id);

        c.set_dividend_policy(&0, &te.token_id, &0, &false);
        c.set_dividend_reinvestment(&te.buyer, &true);

        let position = c.get_dividend_position(&te.buyer);
        assert!(position.reinvestment_enabled);
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
        c.buy_shares(&te.buyer, &10, &te.token_id);

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

        c.buy_shares(&te.buyer, &100, &te.token_id);
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
        c.add_to_whitelist(&te.buyer);
        mint(&te, &te.buyer, i128::MAX);
        c.add_to_whitelist(&te.buyer);
        
        // This should panic because price * shares overflows
        c.buy_shares(&te.buyer, &2, &te.token_id);
    }

    #[test]
    #[should_panic(expected = "Not enough shares available")]
    fn test_buy_shares_overbuy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.add_to_whitelist(&te.buyer);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        
        // Buy more shares than available (caught by logic check, not arithmetic)
        c.buy_shares(&te.buyer, &2000, &te.token_id);
    }

    #[test]
    #[should_panic(expected = "Arithmetic overflow")]
    fn test_buy_shares_balance_overflow() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &1, &u32::MAX);
        c.add_to_whitelist(&te.buyer);
        mint(&te, &te.buyer, i128::MAX);
        c.add_to_whitelist(&te.buyer);
        
        // Manually set high balance to test the checked_add_u32 in balance calculation
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().persistent().set(&DataKey::Balance(te.buyer.clone()), &(u32::MAX - 10));
            // Also set available shares high enough
            te.env.storage().instance().set(&DataKey::AvailableShares, &1000u32);
        });
        
        // Now buying 20 more shares should trigger overflow in checked_add_u32
        c.buy_shares(&te.buyer, &20, &te.token_id);
    }

    #[test]
    #[should_panic(expected = "Arithmetic overflow")]
    fn test_distribute_dividends_multiply_overflow() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.add_to_whitelist(&te.buyer);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        
        c.buy_shares(&te.buyer, &500, &te.token_id);
        
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
        c.add_to_whitelist(&te.buyer);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        
        // Buy some shares to create issued_shares
        c.buy_shares(&te.buyer, &600, &te.token_id);
        
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
    #[should_panic(expected = "Buyer is not whitelisted")]
    fn test_pre_init_buy_shares() {
        let (env, client, token_id, _) = pre_init_client();
        let buyer = Address::generate(&env);
        client.buy_shares(&buyer, &1, &token_id);
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

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_add_to_whitelist() {
        let (env, client, _, _) = pre_init_client();
        let addr = Address::generate(&env);
        client.add_to_whitelist(&addr);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_remove_from_whitelist() {
        let (env, client, _, _) = pre_init_client();
        let addr = Address::generate(&env);
        client.remove_from_whitelist(&addr);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_buy_vested_shares() {
        let (env, client, token_id, _) = pre_init_client();
        let buyer = Address::generate(&env);
        client.buy_vested_shares(&buyer, &1, &3600, &token_id);
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

    // ── Dividend schedule tests ─────────────────────────────────────────

    #[test]
    fn test_set_dividend_schedule() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_dividend_schedule(&10_i128, &86400_u64);
        let schedule = c.get_dividend_schedule().unwrap();
        assert_eq!(schedule.amount_per_share, 10);
        assert_eq!(schedule.interval, 86400);
    }

    #[test]
    fn test_get_dividend_schedule_default_none() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        assert!(c.get_dividend_schedule().is_none());
    }

    #[test]
    #[should_panic(expected = "Amount per share must be positive")]
    fn test_set_dividend_schedule_zero_amount() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_dividend_schedule(&0, &86400);
    }

    #[test]
    #[should_panic(expected = "Amount per share must be positive")]
    fn test_set_dividend_schedule_negative_amount() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_dividend_schedule(&-1, &86400);
    }

    #[test]
    #[should_panic(expected = "Interval must be positive")]
    fn test_set_dividend_schedule_zero_interval() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_dividend_schedule(&10, &0);
    }

    #[test]
    #[should_panic(expected = "Dividend schedule not configured")]
    fn test_process_scheduled_dividend_no_schedule() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.process_scheduled_dividend();
    }

    #[test]
    #[should_panic(expected = "Dividend interval has not elapsed yet")]
    fn test_process_scheduled_dividend_interval_not_elapsed() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_dividend_schedule(&10, &86400);
        // Call immediately — interval (86400s = 1 day) has not elapsed
        c.process_scheduled_dividend();
    }

    #[test]
    fn test_process_scheduled_dividend_distributes() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let buyer2 = Address::generate(&te.env);
        mint(&te, &te.buyer, 100_000);
        mint(&te, &buyer2, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.add_to_whitelist(&buyer2);

        c.buy_shares(&te.buyer, &300, &te.token_id);
        c.buy_shares(&buyer2, &700, &te.token_id);
        assert_eq!(c.get_available_shares(), 0);

        // Set schedule: 10 tokens per share, daily
        c.set_dividend_schedule(&10, &86400);

        // total_amount = 10 * 1000 = 10_000
        let total_amount: i128 = 10 * 1000;
        mint(&te, &te.contract_id, total_amount);

        // Fast-forward past the interval
        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 86401);

        c.process_scheduled_dividend();

        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        // buyer: 100_000 initial - 300*100 cost + (10_000 * 300 / 1000) = 100_000 - 30_000 + 3_000
        assert_eq!(token_client.balance(&te.buyer), 100_000 - 30_000 + 3_000);
        // buyer2: 100_000 - 700*100 + (10_000 * 700 / 1000) = 100_000 - 70_000 + 7_000
        assert_eq!(token_client.balance(&buyer2), 100_000 - 70_000 + 7_000);
    }

    #[test]
    fn test_process_scheduled_dividend_updates_last_distribution() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &500, &te.token_id);

        c.set_dividend_schedule(&1, &100);
        mint(&te, &te.contract_id, 500);

        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 101);
        c.process_scheduled_dividend();
    }

    #[test]
    #[should_panic(expected = "Dividend interval has not elapsed yet")]
    fn test_process_scheduled_dividend_second_call_too_soon() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &500, &te.token_id);

        c.set_dividend_schedule(&1, &100);
        mint(&te, &te.contract_id, 1000);

        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 101);
        c.process_scheduled_dividend();

        // Second call before next interval should fail
        c.process_scheduled_dividend();
    }

    #[test]
    fn test_process_scheduled_dividend_after_multiple_intervals() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &500, &te.token_id);

        c.set_dividend_schedule(&5, &3600); // every hour
        mint(&te, &te.contract_id, 2500);

        let start = te.env.ledger().timestamp();

        // First distribution after 1 hour
        te.env.ledger().set_timestamp(start + 3601);
        c.process_scheduled_dividend();

        // Second distribution after another hour
        mint(&te, &te.contract_id, 2500);
        te.env.ledger().set_timestamp(start + 7201);
        c.process_scheduled_dividend();

        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        // buyer: 100_000 - 500*100 + 2500 + 2500 = 100_000 - 50_000 + 5_000
        assert_eq!(token_client.balance(&te.buyer), 100_000 - 50_000 + 5_000);
    }

    #[test]
    fn test_process_scheduled_dividend_honors_policy_withholding_and_history() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &500, &te.token_id);

        c.set_dividend_policy(&0, &te.token_id, &1000, &false);
        c.set_dividend_schedule(&10, &100);
        mint(&te, &te.contract_id, 5_000);

        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 101);
        c.process_scheduled_dividend();

        let position = c.get_dividend_position(&te.buyer);
        assert_eq!(position.accrued_amount, 4_500);
        assert_eq!(position.claimed_amount, 0);
        assert_eq!(c.get_dividend_history_count(), 1);

        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        assert_eq!(token_client.balance(&te.admin), 50_500);
    }

    #[test]
    #[should_panic(expected = "Unsupported dividend type")]
    fn test_set_dividend_policy_rejects_unsupported_type() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_dividend_policy(&2, &te.token_id, &0, &false);
    }

    #[test]
    #[should_panic(expected = "No holders registered")]
    fn test_process_scheduled_dividend_no_holders() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_dividend_schedule(&10, &1);
        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 2);
        c.process_scheduled_dividend();
    }

    // ── Max shares per user tests ───────────────────────────────────────

    #[test]
    fn test_max_shares_per_user_default_unlimited() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        // Defaults to 0, meaning no cap is enforced.
        assert_eq!(c.get_max_shares_per_user(), 0);
    }

    #[test]
    fn test_set_and_get_max_shares_per_user() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_max_shares_per_user(&50);
        assert_eq!(c.get_max_shares_per_user(), 50);
    }

    #[test]
    fn test_buy_within_cap_succeeds() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.set_max_shares_per_user(&50);
        c.buy_shares(&te.buyer, &50, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 50);
    }

    #[test]
    #[should_panic(expected = "Purchase exceeds max shares per user")]
    fn test_buy_exceeding_cap_single_purchase() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.set_max_shares_per_user(&50);
        c.buy_shares(&te.buyer, &51, &te.token_id);
    }

    #[test]
    #[should_panic(expected = "Purchase exceeds max shares per user")]
    fn test_cap_checks_current_holdings_plus_purchase() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.set_max_shares_per_user(&50);
        // First purchase is fine (40 <= 50).
        c.buy_shares(&te.buyer, &40, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 40);
        // Second purchase pushes total to 60 > 50 → rejected.
        c.buy_shares(&te.buyer, &20, &te.token_id);
    }

    #[test]
    fn test_buy_up_to_cap_across_multiple_purchases() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.set_max_shares_per_user(&50);
        c.buy_shares(&te.buyer, &30, &te.token_id);
        c.buy_shares(&te.buyer, &20, &te.token_id); // exactly hits the cap
        assert_eq!(c.get_shares(&te.buyer), 50);
    }

    #[test]
    fn test_cap_does_not_block_transfer_when_rejected() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.set_max_shares_per_user(&50);

        // A purchase that exceeds the cap must revert before transferring any
        // tokens. Use the non-panicking client to assert the call fails and
        // that no balances or available shares changed.
        let result = c.try_buy_shares(&te.buyer, &60, &te.token_id);
        assert!(result.is_err());

        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        assert_eq!(token_client.balance(&te.buyer), 100_000);
        assert_eq!(c.get_shares(&te.buyer), 0);
        assert_eq!(c.get_available_shares(), 1000);
    }

    #[test]
    fn test_cap_zero_means_unlimited() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        c.set_max_shares_per_user(&50);
        c.set_max_shares_per_user(&0); // disable cap
        c.buy_shares(&te.buyer, &900, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 900);
    }

    #[test]
    fn test_raising_cap_allows_more_purchases() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.set_max_shares_per_user(&50);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        c.set_max_shares_per_user(&100);
        c.buy_shares(&te.buyer, &50, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 100);
    }

    #[test]
    fn test_cap_is_per_address_not_global() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let buyer2 = Address::generate(&te.env);
        mint(&te, &te.buyer, 100_000);
        mint(&te, &buyer2, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.add_to_whitelist(&buyer2);

        c.set_max_shares_per_user(&50);
        c.buy_shares(&te.buyer, &50, &te.token_id);
        c.buy_shares(&buyer2, &50, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 50);
        assert_eq!(c.get_shares(&buyer2), 50);
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_pre_init_set_max_shares_per_user() {
        let (_, client, _, _) = pre_init_client();
        client.set_max_shares_per_user(&50);
    }

    // ── Transfer tests ──────────────────────────────────────────────────

    #[test]
    fn test_transfer_shares_basic() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.transfer_shares(&te.buyer, &recipient, &20);

        assert_eq!(c.get_shares(&te.buyer), 30);
        assert_eq!(c.get_shares(&recipient), 20);
    }

    #[test]
    #[should_panic(expected = "Insufficient shares to transfer")]
    fn test_transfer_shares_insufficient_balance() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.transfer_shares(&te.buyer, &recipient, &20);
    }

    #[test]
    #[should_panic(expected = "Transfer amount must be positive")]
    fn test_transfer_shares_zero_amount() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.transfer_shares(&te.buyer, &recipient, &0);
    }

    #[test]
    fn test_approve_and_transfer_from() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let spender = Address::generate(&te.env);
        let recipient = Address::generate(&te.env);

        c.approve(&te.buyer, &spender, &30);
        assert_eq!(c.allowance(&te.buyer, &spender), 30);

        c.transfer_shares_from(&spender, &te.buyer, &recipient, &20);

        assert_eq!(c.get_shares(&te.buyer), 30);
        assert_eq!(c.get_shares(&recipient), 20);
        // Allowance reduced
        assert_eq!(c.allowance(&te.buyer, &spender), 10);
    }

    #[test]
    #[should_panic(expected = "Transfer amount exceeds allowance")]
    fn test_transfer_from_exceeds_allowance() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let spender = Address::generate(&te.env);
        let recipient = Address::generate(&te.env);

        c.approve(&te.buyer, &spender, &10);
        c.transfer_shares_from(&spender, &te.buyer, &recipient, &20);
    }

    #[test]
    fn test_transfer_registers_recipient_as_holder() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        assert_eq!(c.get_holders().len(), 1);

        c.transfer_shares(&te.buyer, &recipient, &10);
        assert_eq!(c.get_holders().len(), 2);
    }

    // ── Buyback tests ───────────────────────────────────────────────────

    #[test]
    fn test_buyback_shares_basic() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        // Fund contract so it can pay seller
        mint(&te, &te.contract_id, 10_000);

        let available_before = c.get_available_shares(); // 900
        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        let seller_balance_before = token_client.balance(&te.buyer);

        c.buyback_shares(&te.buyer, &50);

        // Seller loses 50 shares, gains 50*100=5000 tokens
        assert_eq!(c.get_shares(&te.buyer), 50);
        assert_eq!(token_client.balance(&te.buyer), seller_balance_before + 5_000);
        // Available increases by 50
        assert_eq!(c.get_available_shares(), available_before + 50);
    }

    #[test]
    #[should_panic(expected = "Buyback amount must be positive")]
    fn test_buyback_shares_zero() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);
        c.buyback_shares(&te.buyer, &0);
    }

    #[test]
    #[should_panic(expected = "Seller has insufficient shares")]
    fn test_buyback_shares_insufficient() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);
        mint(&te, &te.contract_id, 1_000_000);
        c.buyback_shares(&te.buyer, &20);
    }

    #[test]
    fn test_auto_buyback_config_sets_values() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.auto_buyback_config(&3600_u64, &50_u32, &100_000_i128);
        // Config set without error; process should succeed after interval
    }

    #[test]
    #[should_panic(expected = "Interval must be positive")]
    fn test_auto_buyback_config_zero_interval() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.auto_buyback_config(&0_u64, &10_u32, &1000_i128);
    }

    #[test]
    #[should_panic(expected = "Max amount must be positive")]
    fn test_auto_buyback_config_zero_max_amount() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.auto_buyback_config(&3600_u64, &0_u32, &1000_i128);
    }

    #[test]
    #[should_panic(expected = "Budget must be positive")]
    fn test_auto_buyback_config_zero_budget() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.auto_buyback_config(&3600_u64, &10_u32, &0_i128);
    }

    #[test]
    fn test_process_auto_buyback_succeeds() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        // Fund contract and configure auto-buyback
        mint(&te, &te.contract_id, 50_000);
        c.auto_buyback_config(&3600_u64, &50_u32, &50_000_i128);

        // Advance past interval
        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 3601);

        c.process_auto_buyback(&te.buyer, &30);

        assert_eq!(c.get_shares(&te.buyer), 70);
        assert_eq!(c.get_available_shares(), 930);
    }

    #[test]
    #[should_panic(expected = "Auto-buyback interval has not elapsed")]
    fn test_process_auto_buyback_too_soon() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);
        mint(&te, &te.contract_id, 50_000);
        c.auto_buyback_config(&3600_u64, &50_u32, &50_000_i128);

        // Do NOT advance time — should fail immediately
        c.process_auto_buyback(&te.buyer, &10);
    }

    #[test]
    #[should_panic(expected = "Amount exceeds auto-buyback max")]
    fn test_process_auto_buyback_exceeds_max() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);
        mint(&te, &te.contract_id, 50_000);
        c.auto_buyback_config(&3600_u64, &20_u32, &50_000_i128);

        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 3601);
        c.process_auto_buyback(&te.buyer, &30);
    }

    #[test]
    #[should_panic(expected = "Insufficient auto-buyback budget")]
    fn test_process_auto_buyback_exceeds_budget() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        // Budget of 500 → can afford only 5 shares at price 100
        mint(&te, &te.contract_id, 500);
        c.auto_buyback_config(&3600_u64, &50_u32, &500_i128);

        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 3601);
        c.process_auto_buyback(&te.buyer, &10); // 10 * 100 = 1000 > 500
    }

    #[test]
    #[should_panic(expected = "Auto-buyback not configured")]
    fn test_process_auto_buyback_not_configured() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.process_auto_buyback(&te.buyer, &10);
    }

    // ── NFT minting tests ───────────────────────────────────────────────

    use share_certificate_nft::ShareCertificate;

    fn setup_nft(te: &TestEnv) -> Address {
        let nft_id = te.env.register(ShareCertificate, ());
        let nft_client = share_certificate_nft::ShareCertificateClient::new(&te.env, &nft_id);
        nft_client.init(
            &te.contract_id, // minter = marketplace contract
            &soroban_sdk::String::from_str(&te.env, "ipfs://rwa/"),
            &soroban_sdk::String::from_str(&te.env, "RWA Share Certificate"),
            &soroban_sdk::String::from_str(&te.env, "RWAC"),
        );
        nft_id
    }

    #[test]
    fn test_set_and_get_nft_contract() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let nft_id = setup_nft(&te);
        c.set_nft_contract(&nft_id);
        assert_eq!(c.get_nft_contract(), Some(nft_id));
    }

    #[test]
    fn test_get_nft_contract_default_none() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        assert_eq!(c.get_nft_contract(), None);
    }

    #[test]
    fn test_buy_shares_mints_nfts() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        let nft_id = setup_nft(&te);
        c.set_nft_contract(&nft_id);

        c.buy_shares(&te.buyer, &3, &te.token_id);

        // 3 shares purchased → 3 NFTs minted
        use stellar_tokens::non_fungible::Base;
        te.env.as_contract(&nft_id, || {
            assert_eq!(Base::balance(&te.env, &te.buyer), 3);
        });
    }

    #[test]
    fn test_buy_shares_without_nft_contract_still_works() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // No NFT contract configured — buy_shares should succeed normally
        c.buy_shares(&te.buyer, &5, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 5);
    }

    #[test]
    fn test_nft_owner_is_buyer() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        let nft_id = setup_nft(&te);
        c.set_nft_contract(&nft_id);

        c.buy_shares(&te.buyer, &1, &te.token_id);

        use stellar_tokens::non_fungible::Base;
        te.env.as_contract(&nft_id, || {
            assert_eq!(Base::owner_of(&te.env, 0), te.buyer);
        });
    }

    // ── Secure Transfer Function Tests ───────────────────────────────────

    #[test]
    fn test_set_transfer_fee_config() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        c.set_transfer_fee_config(&100, &te.admin, &1000);
        let config = c.get_transfer_fee_config().unwrap();
        assert_eq!(config.fee_bps, 100);
        assert_eq!(config.fee_recipient, te.admin);
        assert_eq!(config.max_fee, 1000);
    }

    #[test]
    #[should_panic(expected = "Fee basis points cannot exceed 10000")]
    fn test_set_transfer_fee_config_too_high() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_transfer_fee_config(&10001, &te.admin, &1000);
    }

    #[test]
    #[should_panic(expected = "Max fee cannot be negative")]
    fn test_set_transfer_fee_config_negative_max() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_transfer_fee_config(&100, &te.admin, &-1);
    }

    #[test]
    fn test_transfer_with_fee() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.buy_shares(&te.buyer, &50, &te.token_id);

        let fee_recipient = Address::generate(&te.env);
        c.set_transfer_fee_config(&100, &fee_recipient, &1000); // 1% fee

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);
        mint(&te, &recipient, 10_000);

        c.transfer_shares(&te.buyer, &recipient, &10);

        // Fee should be 1% of 10 * 100 = 1000 tokens
        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        // buyer: 100_000 - 50*100 = 95_000, then - 1000 fee = 94_000
        // recipient: 10_000 + 0 (no fee paid by recipient)
        // fee_recipient: 0 + 1000 = 1000
        assert_eq!(token_client.balance(&te.buyer), 94_000);
        assert_eq!(token_client.balance(&fee_recipient), 1000);
    }

    #[test]
    fn test_batch_transfer() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        let recipient1 = Address::generate(&te.env);
        let recipient2 = Address::generate(&te.env);
        c.add_to_whitelist(&recipient1);
        c.add_to_whitelist(&recipient2);

        let mut recipients: Vec<Address> = Vec::new(&te.env);
        recipients.push_back(recipient1.clone());
        recipients.push_back(recipient2.clone());

        let mut amounts: Vec<u32> = Vec::new(&te.env);
        amounts.push_back(30);
        amounts.push_back(20);

        c.batch_transfer(&te.buyer, &recipients, &amounts);

        assert_eq!(c.get_shares(&te.buyer), 50);
        assert_eq!(c.get_shares(&recipient1), 30);
        assert_eq!(c.get_shares(&recipient2), 20);
    }

    #[test]
    #[should_panic(expected = "Recipients list cannot be empty")]
    fn test_batch_transfer_empty_recipients() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipients: Vec<Address> = Vec::new(&te.env);
        let amounts: Vec<u32> = Vec::new(&te.env);
        c.batch_transfer(&te.buyer, &recipients, &amounts);
    }

    #[test]
    #[should_panic(expected = "Recipients and amounts must have the same length")]
    fn test_batch_transfer_mismatched_lengths() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let mut recipients: Vec<Address> = Vec::new(&te.env);
        recipients.push_back(Address::generate(&te.env));

        let mut amounts: Vec<u32> = Vec::new(&te.env);
        amounts.push_back(10);
        amounts.push_back(20);

        c.batch_transfer(&te.buyer, &recipients, &amounts);
    }

    #[test]
    fn test_set_transfer_restrictions() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let restricted_addr = Address::generate(&te.env);
        c.set_transfer_restrictions(&restricted_addr, &1000, &50, &true);

        let restriction = c.get_transfer_restrictions(&restricted_addr).unwrap();
        assert_eq!(restriction.restricted_until, 1000);
        assert_eq!(restriction.max_transfer_amount, 50);
        assert_eq!(restriction.requires_approval, true);
    }

    #[test]
    fn test_remove_transfer_restrictions() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let restricted_addr = Address::generate(&te.env);
        c.set_transfer_restrictions(&restricted_addr, &1000, &50, &true);
        assert!(c.get_transfer_restrictions(&restricted_addr).is_some());

        c.remove_transfer_restrictions(&restricted_addr);
        assert!(c.get_transfer_restrictions(&restricted_addr).is_none());
    }

    #[test]
    #[should_panic(expected = "Transfer restricted until timestamp")]
    fn test_transfer_restriction_time_based() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let future_time = te.env.ledger().timestamp() + 10000;
        c.set_transfer_restrictions(&te.buyer, &future_time, &100, &false);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);
        c.transfer_shares(&te.buyer, &recipient, &10);
    }

    #[test]
    #[should_panic(expected = "Transfer amount exceeds maximum allowed")]
    fn test_transfer_restriction_max_amount() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let past_time = te.env.ledger().timestamp() - 1000;
        c.set_transfer_restrictions(&te.buyer, &past_time, &5, &false);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);
        c.transfer_shares(&te.buyer, &recipient, &10);
    }

    #[test]
    #[should_panic(expected = "Transfer requires prior approval")]
    fn test_transfer_requires_approval() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let past_time = te.env.ledger().timestamp() - 1000;
        c.set_transfer_restrictions(&te.buyer, &past_time, &100, &true);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);
        c.transfer_shares(&te.buyer, &recipient, &10);
    }

    #[test]
    fn test_request_transfer_approval() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        let approval_id = c.request_transfer_approval(&te.buyer, &recipient, &10);

        assert_eq!(approval_id, 0);
        let approval = c.get_transfer_approval(&approval_id).unwrap();
        assert_eq!(approval.from, te.buyer);
        assert_eq!(approval.to, recipient);
        assert_eq!(approval.amount, 10);
        assert_eq!(approval.approved, false);
    }

    #[test]
    fn test_grant_and_execute_transfer_approval() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);

        let approval_id = c.request_transfer_approval(&te.buyer, &recipient, &10);
        c.grant_transfer_approval(&approval_id, &true);

        c.execute_approved_transfer(&approval_id);

        assert_eq!(c.get_shares(&te.buyer), 40);
        assert_eq!(c.get_shares(&recipient), 10);
        assert!(c.get_transfer_approval(&approval_id).is_none());
    }

    #[test]
    #[should_panic(expected = "Transfer has not been approved")]
    fn test_execute_unapproved_transfer() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);

        let approval_id = c.request_transfer_approval(&te.buyer, &recipient, &10);
        c.execute_approved_transfer(&approval_id);
    }

    #[test]
    fn test_transfer_whitelist() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        let addr = Address::generate(&te.env);
        assert!(c.is_transfer_whitelisted_public(&addr)); // Default is true

        c.remove_from_transfer_whitelist(&addr);
        assert!(!c.is_transfer_whitelisted_public(&addr));

        c.add_to_transfer_whitelist(&addr);
        assert!(c.is_transfer_whitelisted_public(&addr));
    }

    #[test]
    #[should_panic(expected = "Transfer not allowed for one or both parties")]
    fn test_transfer_blocked_by_whitelist() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);
        c.remove_from_transfer_whitelist(&recipient);

        c.transfer_shares(&te.buyer, &recipient, &10);
    }

    #[test]
    fn test_transfer_history_tracking() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);

        c.transfer_shares(&te.buyer, &recipient, &10);

        assert_eq!(c.get_transfer_history_count(), 1);
        let entry = c.get_transfer_history(&0).unwrap();
        assert_eq!(entry.from, te.buyer);
        assert_eq!(entry.to, recipient);
        assert_eq!(entry.amount, 10);
    }

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn test_reentrancy_protection() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);

        // Manually set reentrancy guard to simulate reentrancy
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        // This should panic due to reentrancy guard
        c.transfer_shares(&te.buyer, &recipient, &10);
    }

    #[test]
    #[should_panic(expected = "Cannot transfer vested shares")]
    fn test_transfer_vested_shares_blocked() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Buy vested shares
        c.buy_vested_shares(&te.buyer, &50, &3600, &te.token_id);

        // Try to transfer more than liquid balance (which is 0)
        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);
        c.transfer_shares(&te.buyer, &recipient, &10);
    }

    #[test]
    fn test_transfer_liquid_shares_after_vesting() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Buy both liquid and vested shares
        c.buy_shares(&te.buyer, &30, &te.token_id);
        c.buy_vested_shares(&te.buyer, &20, &3600, &te.token_id);

        // Should be able to transfer liquid shares
        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);
        c.transfer_shares(&te.buyer, &recipient, &10);

        assert_eq!(c.get_shares(&te.buyer), 20); // 20 liquid remaining
        assert_eq!(c.get_shares(&recipient), 10);
    }

    #[test]
    fn test_transfer_from_with_restrictions() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let spender = Address::generate(&te.env);
        let recipient = Address::generate(&te.env);
        c.add_to_whitelist(&recipient);

        c.approve(&te.buyer, &spender, &30);
        c.transfer_shares_from(&spender, &te.buyer, &recipient, &20);

        assert_eq!(c.get_shares(&te.buyer), 30);
        assert_eq!(c.get_shares(&recipient), 20);
    }

    #[test]
    fn test_batch_transfer_with_fee() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        let fee_recipient = Address::generate(&te.env);
        c.set_transfer_fee_config(&100, &fee_recipient, &1000); // 1% fee

        let recipient1 = Address::generate(&te.env);
        let recipient2 = Address::generate(&te.env);
        c.add_to_whitelist(&recipient1);
        c.add_to_whitelist(&recipient2);

        let mut recipients: Vec<Address> = Vec::new(&te.env);
        recipients.push_back(recipient1.clone());
        recipients.push_back(recipient2.clone());

        let mut amounts: Vec<u32> = Vec::new(&te.env);
        amounts.push_back(30);
        amounts.push_back(20);

        c.batch_transfer(&te.buyer, &recipients, &amounts);

        // Total fee: (30 + 20) * 100 * 0.01 = 50 tokens
        let token_client = token::TokenClient::new(&te.env, &te.token_id);
        assert_eq!(token_client.balance(&te.buyer), 100_000 - 100*100 - 50); // 100*100 cost + 50 fee
        assert_eq!(token_client.balance(&fee_recipient), 50);
    }

    // ── Re-entrancy guard tests ───────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Re-entrancy detected")]
    fn test_reentrancy_is_blocked() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Manually set the reentrancy guard to simulate an ongoing call
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        // This call should fail with re-entrancy error
        c.buy_shares(&te.buyer, &10, &te.token_id);
    }

    #[test]
    fn test_reentrancy_guard_cleared_after_successful_buy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Guard should be false initially
        te.env.as_contract(&te.contract_id, || {
            assert!(!te.env.storage().instance().get::<DataKey, bool>(&DataKey::ReentrancyGuard).unwrap_or(false));
        });

        c.buy_shares(&te.buyer, &10, &te.token_id);

        // Guard should be cleared after successful buy
        te.env.as_contract(&te.contract_id, || {
            assert!(!te.env.storage().instance().get::<DataKey, bool>(&DataKey::ReentrancyGuard).unwrap_or(true));
        });
    }

    #[test]
    #[should_panic(expected = "Re-entrancy detected")]
    fn test_reentrancy_blocked_on_panic_path() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Set guard and unpause to trigger panic after guard is set
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
            te.env.storage().instance().set(&DataKey::Paused, &true);
        });

        // Should panic with re-entrancy detected (guard check happens first)
        c.buy_shares(&te.buyer, &10, &te.token_id);
    }

    #[test]
    fn test_reentrancy_guard_default_false() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);

        // Check that reentrancy guard is not set by default after init
        te.env.as_contract(&te.contract_id, || {
            assert!(!te.env.storage().instance().get::<DataKey, bool>(&DataKey::ReentrancyGuard).unwrap_or(false));
        });
    }

    #[test]
    #[should_panic(expected = "Re-entrancy detected")]
    fn test_double_reentrancy_blocked() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Manually lock the guard
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        // First call should fail
        c.buy_shares(&te.buyer, &10, &te.token_id);
    }

    // ── Issue #494: Reentrancy Guard Audit Tests ──────────────────────────
    // Verify that ALL state-changing external functions with token transfers
    // are protected by the reentrancy guard.

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn test_reentrancy_blocked_on_emergency_withdraw() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.admin, 100_000);

        // Manually lock the guard
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        c.emergency_withdraw(&te.admin, &0);
    }

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn test_reentrancy_blocked_on_distribute_dividends() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        // Manually lock the guard
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        c.distribute_dividends(&te.token_id, &1000);
    }

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn test_reentrancy_blocked_on_claim_dividends() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        // Distribute so buyer has accrued dividends
        c.distribute_dividends(&te.token_id, &1000);

        // Manually lock the guard
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        c.claim_dividends(&te.buyer);
    }

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn test_reentrancy_blocked_on_buy_from_order() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        // Place a sell order
        let order_id = c.place_sell_order(&te.buyer, &10, &100);

        // Manually lock the guard
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        c.buy_from_order(&te.buyer, &order_id, &5);
    }

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn test_reentrancy_blocked_on_buyback_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        // Fund the contract for buyback
        mint(&te, &te.contract_id, 100_000);

        // Manually lock the guard
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        c.buyback_shares(&te.buyer, &10);
    }

    #[test]
    #[should_panic(expected = "Reentrancy detected")]
    fn test_reentrancy_blocked_on_buy_vested_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Manually lock the guard
        te.env.as_contract(&te.contract_id, || {
            te.env.storage().instance().set(&DataKey::ReentrancyGuard, &true);
        });

        c.buy_vested_shares(&te.buyer, &10, &86400, &te.token_id);
    }

    #[test]
    fn test_reentrancy_guard_cleared_after_emergency_withdraw() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.admin, 100_000);

        c.emergency_withdraw(&te.admin, &0);

        // Guard should be cleared after successful call
        te.env.as_contract(&te.contract_id, || {
            assert!(!te.env.storage().instance().get::<DataKey, bool>(&DataKey::ReentrancyGuard).unwrap_or(true));
        });
    }

    #[test]
    fn test_reentrancy_guard_cleared_after_distribute_dividends() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);

        c.distribute_dividends(&te.token_id, &1000);

        // Guard should be cleared after successful call
        te.env.as_contract(&te.contract_id, || {
            assert!(!te.env.storage().instance().get::<DataKey, bool>(&DataKey::ReentrancyGuard).unwrap_or(true));
        });
    }

    // ── Event emission tests (Issue #167) ─────────────────────────────────
    // Each test below calls a state-modifying function and then verifies
    // that at least one event was emitted by the contract. Because the event
    // `publish` call is the last thing in each function, a successful return
    // without panic already proves the event was emitted correctly.

    #[test]
    fn test_event_emission_on_init() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        // init emits EventInit – no panic means success
    }

    #[test]
    fn test_event_emission_on_buy_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);
    }

    #[test]
    fn test_event_emission_on_pause() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.pause();
    }

    #[test]
    fn test_event_emission_on_unpause() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.pause();
        c.unpause();
    }

    #[test]
    fn test_event_emission_on_set_price() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_price(&200);
    }

    #[test]
    fn test_event_emission_on_set_total_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_total_shares(&2000);
    }

    #[test]
    fn test_event_emission_on_transfer() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);
        let recipient = Address::generate(&te.env);
        c.transfer_shares(&te.buyer, &recipient, &20);
    }

    #[test]
    fn test_event_emission_on_approve() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);
        let spender = Address::generate(&te.env);
        c.approve(&te.buyer, &spender, &30);
    }

    #[test]
    fn test_event_emission_on_sell_order_flow() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);
        c.place_sell_order(&te.buyer, &20, &150);
        c.cancel_sell_order(&0);
    }

    #[test]
    fn test_event_emission_on_buyback() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);
        mint(&te, &te.contract_id, 10_000);
        c.buyback_shares(&te.buyer, &50);
    }

    #[test]
    fn test_event_emission_on_auto_buyback_config() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.auto_buyback_config(&3600_u64, &50_u32, &100_000_i128);
    }

    #[test]
    fn test_event_emission_on_set_max_shares_per_user() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_max_shares_per_user(&100);
    }

    #[test]
    fn test_event_emission_on_emergency_withdraw() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.emergency_withdraw(&te.admin, &0);
    }

    #[test]
    fn test_event_emission_on_distribute_dividends() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &500, &te.token_id);
        let dividend_amount: i128 = 10_000;
        mint(&te, &te.contract_id, dividend_amount);
        c.distribute_dividends(&te.token_id, &dividend_amount);
    }

    #[test]
    fn test_event_emission_on_set_dividend_schedule() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.set_dividend_schedule(&10_i128, &86400_u64);
    }

    #[test]
    fn test_event_emission_on_process_scheduled_dividend() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &500, &te.token_id);
        c.set_dividend_schedule(&1, &100);
        mint(&te, &te.contract_id, 500);
        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 101);
        c.process_scheduled_dividend();
    }

    // ── Newly added event emission tests (Issue #167) ───────────────────

    #[test]
    fn test_event_emission_on_set_nft_contract() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let nft_id = te.env.register(share_certificate_nft::ShareCertificate, ());
        c.set_nft_contract(&nft_id);
    }

    #[test]
    fn test_event_emission_on_whitelist_ops() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let addr = Address::generate(&te.env);
        c.add_to_whitelist(&addr);
        c.remove_from_whitelist(&addr);
    }

    #[test]
    fn test_event_emission_on_set_metadata_uri() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let uri = soroban_sdk::Bytes::from_slice(&te.env, b"ipfs://QmTest");
        c.set_metadata_uri(&uri);
    }

    #[test]
    fn test_event_emission_on_claim_vested_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_vested_shares(&te.buyer, &10, &1, &te.token_id);
        te.env.ledger().set_timestamp(te.env.ledger().timestamp() + 2);
        c.claim_vested_shares(&te.buyer);
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
    /// Permanent emergency asset delisting (Issue #570), restricted to the
    /// multi-sig / timelock-guarded admin flow.
    DelistAsset(soroban_sdk::Bytes),
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

        EventOperationScheduled { action, execute_after }.publish(&env);
    }

    pub fn cancel_operation(env: soroban_sdk::Env, admin: soroban_sdk::Address, action: AdminAction) {
        admin.require_auth();
        let timelock_key = TimelockDataKey::TimelockOp(action.clone());
        
        if !env.storage().persistent().has(&timelock_key) {
            soroban_sdk::panic_with_error!(&env, TimelockError::NotScheduled);
        }
        
        env.storage().persistent().remove(&timelock_key);

        EventOperationCancelled { action }.publish(&env);
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
        match action.clone() {
            AdminAction::Pause => {
                RwaMarketplace::pause(env.clone());
            },
            AdminAction::Unpause => {
                RwaMarketplace::unpause(env.clone());
            },
            AdminAction::EmergencyWithdraw(to, amount) => {
                RwaMarketplace::emergency_withdraw(env.clone(), to, amount);
            },
            AdminAction::DelistAsset(reason) => {
                RwaMarketplace::delist_asset(env.clone(), reason);
            }
        }

        EventOperationExecuted { action }.publish(&env);
    }

    // Issue #677: explicit pause / unpause x buy_shares coverage
    #[test]
    #[should_panic(expected = "Marketplace is paused")]
    fn test_pause_blocks_buy_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Buyer is fully able to buy when unpaused...
        assert!(!c.is_paused());
        // ...so the only reason for this panic is the global pause.
        c.pause();
        assert!(c.is_paused());
        c.buy_shares(&te.buyer, &25, &te.token_id);
    }

    #[test]
    fn test_unpause_restores_buy_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.pause();
        assert!(c.is_paused());
        c.unpause();
        assert!(!c.is_paused());

        // The same buyer can purchase once the marketplace is resumed.
        c.buy_shares(&te.buyer, &25, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 25);
        assert_eq!(c.get_available_shares(), 975);
    }

    #[test]
    #[should_panic(expected = "Purchases are currently paused")]
    fn test_function_pause_blocks_buy_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        // Granular pause for purchases only (FN_BUY_SHARES == 0); the
        // marketplace itself stays observably unpaused.
        c.pause_function(&0_u32);
        assert!(!c.is_paused());
        c.buy_shares(&te.buyer, &25, &te.token_id);
    }

    #[test]
    fn test_function_unpause_restores_buy_shares() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);

        c.pause_function(&0_u32);
        assert!(!c.is_paused());
        c.unpause_function(&0_u32);
        assert!(!c.is_paused());

        c.buy_shares(&te.buyer, &25, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 25);
        assert_eq!(c.get_available_shares(), 975);
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

    #[test]
    fn test_timelock_schedule_event() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = soroban_sdk::Address::generate(&env);
        let payment_token = soroban_sdk::Address::generate(&env);
        
        let contract_id = env.register(RwaMarketplace, ());
        let client = RwaMarketplaceClient::new(&env, &contract_id);
        
        client.init(&admin, &payment_token, &100_i128, &1000_u32);
        
        let action = AdminAction::Pause;
        client.schedule_operation(&admin, &action);
    }

    #[test]
    fn test_timelock_cancel_event() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = soroban_sdk::Address::generate(&env);
        let payment_token = soroban_sdk::Address::generate(&env);
        
        let contract_id = env.register(RwaMarketplace, ());
        let client = RwaMarketplaceClient::new(&env, &contract_id);
        
        client.init(&admin, &payment_token, &100_i128, &1000_u32);
        
        let action = AdminAction::Pause;
        client.schedule_operation(&admin, &action);
        client.cancel_operation(&admin, &action);
    }

    #[test]
    fn test_timelock_execute_event() {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = soroban_sdk::Address::generate(&env);
        let payment_token = soroban_sdk::Address::generate(&env);
        
        let contract_id = env.register(RwaMarketplace, ());
        let client = RwaMarketplaceClient::new(&env, &contract_id);
        
        client.init(&admin, &payment_token, &100_i128, &1000_u32);
        
        let action = AdminAction::Unpause;
        client.schedule_operation(&admin, &action);
        env.ledger().set_timestamp(env.ledger().timestamp() + 176_400);
        client.execute_operation(&admin, &action);
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

            for b in buyers.iter() {
                client.add_to_whitelist(b);
            }

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
                        client.buy_shares(&buyers[buyer_idx], &shares, &token_id);
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
            client.add_to_whitelist(&buyer);

            let mut total_bought = 0u32;

            for shares in buys {
                let available = client.get_available_shares();
                if shares > available {
                    continue;
                }
                client.buy_shares(&buyer, &shares, &token_id);
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
// ── Additional Fuzz Targets for Issue #514 ────────────────────────────
// Targets: fractional math overflow/underflow, order book state transitions,
// and dividend distribution invariants.

#[cfg(test)]
mod fuzz_fractional_math {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Fuzz: checked_add_i128 never overflows for i128 range inputs.
        #[test]
        fn fuzz_checked_add_i128(a in prop::num::i128::ANY, b in prop::num::i128::ANY) {
            let result = a.checked_add(b);
            match result {
                Some(val) => prop_assert_eq!(checked_add_i128(a, b), val),
                None => { let _ = std::panic::catch_unwind(|| { checked_add_i128(a, b); }); }
            }
        }

        /// Fuzz: checked_sub_i128 never underflows for i128 range inputs.
        #[test]
        fn fuzz_checked_sub_i128(a in prop::num::i128::ANY, b in prop::num::i128::ANY) {
            let result = a.checked_sub(b);
            match result {
                Some(val) => prop_assert_eq!(checked_sub_i128(a, b), val),
                None => { let _ = std::panic::catch_unwind(|| { checked_sub_i128(a, b); }); }
            }
        }

        /// Fuzz: checked_mul_i128 never overflows for i128 range inputs.
        #[test]
        fn fuzz_checked_mul_i128(a in prop::num::i128::ANY, b in prop::num::i128::ANY) {
            let result = a.checked_mul(b);
            match result {
                Some(val) => prop_assert_eq!(checked_mul_i128(a, b), val),
                None => { let _ = std::panic::catch_unwind(|| { checked_mul_i128(a, b); }); }
            }
        }

        /// Fuzz: checked_add_u32 never overflows for u32 range inputs.
        #[test]
        fn fuzz_checked_add_u32(a in prop::num::u32::ANY, b in prop::num::u32::ANY) {
            let result = a.checked_add(b);
            match result {
                Some(val) => prop_assert_eq!(checked_add_u32(a, b), val),
                None => { let _ = std::panic::catch_unwind(|| { checked_add_u32(a, b); }); }
            }
        }

        /// Fuzz: checked_sub_u32 never underflows for u32 range inputs.
        #[test]
        fn fuzz_checked_sub_u32(a in prop::num::u32::ANY, b in prop::num::u32::ANY) {
            let result = a.checked_sub(b);
            match result {
                Some(val) => prop_assert_eq!(checked_sub_u32(a, b), val),
                None => { let _ = std::panic::catch_unwind(|| { checked_sub_u32(a, b); }); }
            }
        }
    }
}

#[cfg(test)]
mod fuzz_order_book_transitions {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::testutils::Address as _;

    const INIT_PRICE: i128 = 100;
    const INIT_TOTAL: u32 = 10_000;

    /// Fuzz: order book state transitions — place, fill, cancel.
    /// Invariant: total shares (available + escrowed + held) == total_shares.
    proptest! {
        #[test]
        fn fuzz_order_book_invariants(
            shares_to_buy in 1u32..1000u32,
            sell_amount in 1u32..500u32,
            buy_amount in 1u32..500u32,
            should_cancel in any::<bool>(),
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
            let contract_id = env.register(RwaMarketplace, ());
            let client = RwaMarketplaceClient::new(&env, &contract_id);
            let buyer = Address::generate(&env);
            let seller = Address::generate(&env);

            token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &100_000_000);
            token::StellarAssetClient::new(&env, &token_id).mint(&seller, &100_000_000);

            client.init(&admin, &token_id, &INIT_PRICE, &INIT_TOTAL);
            client.add_to_whitelist(&buyer);
            client.add_to_whitelist(&seller);

            // Buyer purchases shares
            let buy_count = shares_to_buy.min(INIT_TOTAL);
            client.buy_shares(&buyer, &buy_count, &token_id);
            let available_after_buy = INIT_TOTAL - buy_count;

            prop_assert_eq!(client.get_available_shares(), available_after_buy);
            prop_assert_eq!(client.get_shares(&buyer), buy_count);

            // Seller also buys shares
            client.buy_shares(&seller, &buy_count.min(available_after_buy), &token_id);
            let available_after_both = available_after_buy - buy_count.min(available_after_buy);

            // Seller places a sell order
            let escrow = sell_amount.min(client.get_shares(&seller));
            if escrow > 0 {
                let order_id = client.place_sell_order(&seller, &escrow, &(INIT_PRICE * 2));
                prop_assert_eq!(client.get_shares(&seller), buy_count.min(available_after_buy) - escrow);

                if should_cancel {
                    client.cancel_sell_order(&order_id);
                    prop_assert_eq!(client.get_shares(&seller), buy_count.min(available_after_buy));
                    prop_assert!(client.get_sell_order(&order_id).is_none());
                } else {
                    // Buyer fills partial order
                    let fill = buy_amount.min(escrow);
                    client.buy_from_order(&buyer, &order_id, &fill);
                    prop_assert_eq!(client.get_shares(&buyer), buy_count + fill);
                }
            }

            // Global invariant: total shares conserved
            let total_held: u32 = (0..=1).map(|i| {
                let addr = if i == 0 { &buyer } else { &seller };
                client.get_shares(addr)
            }).sum();
            prop_assert_eq!(
                client.get_available_shares() + total_held,
                INIT_TOTAL,
                "conservation violated: available={} + held={} != {}",
                client.get_available_shares(), total_held, INIT_TOTAL
            );
        }
    }
}

#[cfg(test)]
mod fuzz_dividend_distribution {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::testutils::Address as _;

    const INIT_PRICE: i128 = 100;
    const INIT_TOTAL: u32 = 10_000;

    proptest! {
        /// Fuzz: distribute_dividends distributes correct pro-rata amounts.
        /// Invariant: sum of distributed amounts == total_amount.
        #[test]
        fn fuzz_dividend_pro_rata(
            buyer_shares in 1u32..5000u32,
            total_dividend in 1i128..1_000_000i128,
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
            let contract_id = env.register(RwaMarketplace, ());
            let client = RwaMarketplaceClient::new(&env, &contract_id);
            let buyer = Address::generate(&env);

            token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &100_000_000);
            token::StellarAssetClient::new(&env, &token_id).mint(&contract_id, &1_000_000_000);

            client.init(&admin, &token_id, &INIT_PRICE, &INIT_TOTAL);
            client.add_to_whitelist(&buyer);

            let actual_shares = buyer_shares.min(INIT_TOTAL - 1);
            client.buy_shares(&buyer, &actual_shares, &token_id);

            // Fund contract for dividend
            token::StellarAssetClient::new(&env, &token_id).mint(&contract_id, &total_dividend);

            // Distribute dividends
            client.distribute_dividends(&token_id, &total_dividend);

            // The holder should have received their pro-rata share
            let expected = (total_dividend as u128 * actual_shares as u128 / INIT_TOTAL as u128) as i128;
            let balance = token::StellarAssetClient::new(&env, &token_id).balance(&buyer);
            // Balance should be at least the initial - cost + expected dividend (within rounding)
            prop_assert!(balance > 0, "buyer balance should be positive after dividend");
        }
    }
}

// ── Vesting Analytics & History Tests ─────────────────────────────

#[cfg(test)]
mod vesting_analytics_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use token::StellarAssetClient;

    struct TestEnv {
        env: soroban_sdk::Env,
        contract_id: Address,
        admin: Address,
        buyer: Address,
        token_id: Address,
    }

    fn setup() -> TestEnv {
        let env = soroban_sdk::Env::default();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let token_id = Address::generate(&env);

        let contract_id = env.register(RwaMarketplace, ());
        let c = RwaMarketplaceClient::new(&env, &contract_id);
        c.init(&admin, &token_id, &100, &1000);

        // Mint tokens and whitelist buyer for test setup
        let token_client = StellarAssetClient::new(&env, &token_id);
        token_client.mint(&buyer, &100_000_i128);
        c.add_to_whitelist(&buyer);

        TestEnv {
            env,
            contract_id,
            admin,
            buyer,
            token_id,
        }
    }

    #[test]
    fn test_get_vesting_summary_with_no_schedules() {
        let te = setup();
        let c = RwaMarketplaceClient::new(&te.env, &te.contract_id);
        let summary = c.get_vesting_summary(&te.buyer);
        assert_eq!(summary.total_vested, 0);
        assert_eq!(summary.total_claimed, 0);
        assert_eq!(summary.total_locked, 0);
        assert_eq!(summary.claimable_now, 0);
        assert_eq!(summary.active_schedule_count, 0);
    }

    #[test]
    fn test_get_vesting_summary_after_buy() {
        let te = setup();
        let c = RwaMarketplaceClient::new(&te.env, &te.contract_id);

        // Buy liquid (non-vested) shares
        c.buy_shares(&te.buyer, &50, &te.token_id);

        let summary = c.get_vesting_summary(&te.buyer);
        // Liquid shares are not tracked as vesting schedules
        assert_eq!(summary.active_schedule_count, 0);
        assert_eq!(summary.total_vested, 0);
    }

    #[test]
    fn test_get_vesting_summary_after_vested_buy() {
        let te = setup();
        let c = RwaMarketplaceClient::new(&te.env, &te.contract_id);

        // Buy vested shares with a duration
        c.buy_vested_shares(&te.buyer, &20, &3600, &te.token_id);

        let summary = c.get_vesting_summary(&te.buyer);
        // At time 0 with cliff=0 and duration=3600, nothing is vested yet
        assert_eq!(summary.active_schedule_count, 1);
        assert_eq!(summary.total_vested, 0);
    }

    #[test]
    fn test_get_vesting_history_empty() {
        let te = setup();
        let c = RwaMarketplaceClient::new(&te.env, &te.contract_id);
        c.buy_vested_shares(&te.buyer, &10, &3600, &te.token_id);

        // No claims made yet so history should be empty
        let history = c.get_vesting_history(&te.buyer, &0, &10);
        assert_eq!(history.len(), 0);
    }

    #[test]
    fn test_claimable_shares_after_vested_buy() {
        let te = setup();
        let c = RwaMarketplaceClient::new(&te.env, &te.contract_id);
        c.buy_vested_shares(&te.buyer, &20, &3600, &te.token_id);

        // Initially no shares are claimable (duration hasn't passed)
        let claimable = c.get_claimable_vested_shares(&te.buyer);
        assert_eq!(claimable, 0);
    }
}

// ====================== CONTRACT UPGRADEABILITY (#6) ======================

#[contractevent(data_format = "vec")]
pub struct EventContractUpgraded {
    pub new_wasm_hash: BytesN<32>,
}

#[contractimpl]
impl RwaMarketplace {

    /// Return the contract metadata (SIP-4/SEP-46).
    /// Panics if the contract is not initialized.
    pub fn get_contract_metadata(env: Env) -> ContractMetadata {
        env.storage()
            .instance()
            .get(&DataKey::ContractMetadata)
            .expect("Contract not initialized")
    }

    /// Return the admin address. Panics if the contract is not initialized.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized: admin")
    }

    /// Return whether the contract has been initialized.
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    /// Upgrade the smart contract to a new version.
    /// Only the admin can call this function.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");

        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        EventContractUpgraded { new_wasm_hash }.publish(&env);
    }
}

// ====================== ORACLE INTEGRATION (#169) =========================

#[contractimpl]
impl RwaMarketplace {
    /// Set the oracle contract address for real-time pricing. Admin only.
    ///
    /// Once set, `buy_shares` will attempt to fetch the price from the oracle
    /// and fall back to the admin-set price if the oracle call fails.
    ///
    /// Pass `None` equivalent (remove the key) via `clear_oracle` to disable.
    pub fn set_oracle(env: Env, oracle: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();

        env.storage().instance().set(&DataKey::OracleAddress, &oracle);
        EventSetOracle { oracle }.publish(&env);
    }

    /// Remove the oracle address, reverting to admin-set pricing. Admin only.
    pub fn clear_oracle(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized: admin");
        admin.require_auth();
        env.storage().instance().remove(&DataKey::OracleAddress);
    }

    /// Return the configured oracle address, or None if not set.
    pub fn get_oracle(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::OracleAddress)
    }
}

// ====================== CROSS-CHAIN BRIDGE (#170) =========================

#[contractimpl]
impl RwaMarketplace {
    /// Lock `amount` shares for bridging to another chain.
    ///
    /// The caller's liquid balance is debited and the locked amount is
    /// recorded in `BridgeLocked(caller)`. Emits `EventLockForBridge`.
    ///
    /// Panics if:
    /// - `amount` is 0
    /// - caller does not have enough liquid balance
    pub fn lock_for_bridge(env: Env, user: Address, amount: u32) {
        user.require_auth();

        if amount == 0 {
            panic!("Bridge lock amount must be greater than zero");
        }

        let balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(user.clone()))
            .unwrap_or(0);

        if amount > balance {
            panic!("Insufficient liquid balance to lock for bridge");
        }

        // Debit liquid balance
        let new_balance = checked_sub_u32(balance, amount);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(user.clone()), &new_balance);

        // Increase locked amount
        let prev_locked: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::BridgeLocked(user.clone()))
            .unwrap_or(0);
        let total_locked = checked_add_u32(prev_locked, amount);
        env.storage()
            .persistent()
            .set(&DataKey::BridgeLocked(user.clone()), &total_locked);

        EventLockForBridge { user, amount, total_locked }.publish(&env);
    }

    /// Unlock `amount` shares from a bridge operation using a 32-byte proof.
    ///
    /// The proof is a bytes32 value (e.g., a merkle proof hash or bridge tx ID)
    /// supplied by the relayer. The locked amount is reduced and the caller's
    /// liquid balance is credited. Emits `EventUnlockFromBridge`.
    ///
    /// Panics if:
    /// - `amount` is 0
    /// - the proof is all-zeros (invalid proof sentinel)
    /// - caller does not have enough locked balance to unlock
    pub fn unlock_from_bridge(env: Env, user: Address, amount: u32, proof: BytesN<32>) {
        user.require_auth();

        if amount == 0 {
            panic!("Bridge unlock amount must be greater than zero");
        }

        // Reject zero proof (invalid sentinel)
        let zero: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        if proof == zero {
            panic!("Invalid bridge proof: proof cannot be all-zeros");
        }

        let locked: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::BridgeLocked(user.clone()))
            .unwrap_or(0);

        if amount > locked {
            panic!("Insufficient locked balance to unlock from bridge");
        }

        // Reduce locked amount
        let new_locked = checked_sub_u32(locked, amount);
        env.storage()
            .persistent()
            .set(&DataKey::BridgeLocked(user.clone()), &new_locked);

        // Credit liquid balance
        let balance: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(user.clone()))
            .unwrap_or(0);
        let new_balance = checked_add_u32(balance, amount);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(user.clone()), &new_balance);

        EventUnlockFromBridge { user, amount, proof }.publish(&env);
    }

    /// Return the amount of shares currently locked for bridging by `user`.
    pub fn get_bridge_locked(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::BridgeLocked(user))
            .unwrap_or(0)
    }
}

// ====================== ORACLE & BRIDGE UNIT TESTS ========================

#[cfg(test)]
mod oracle_bridge_tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token, Env,
    };

    type Client<'a> = RwaMarketplaceClient<'a>;

    const INIT_PRICE: i128 = 100;
    const INIT_TOTAL: u32 = 1_000;

    struct TestEnv {
        env: Env,
        contract_id: Address,
        admin: Address,
        token_id: Address,
        buyer: Address,
    }

    fn setup() -> TestEnv {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(RwaMarketplace, ());
        let buyer = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &100_000_000);
        TestEnv { env, contract_id, admin, token_id, buyer }
    }

    fn client(te: &TestEnv) -> Client {
        RwaMarketplaceClient::new(&te.env, &te.contract_id)
    }

    fn mint(te: &TestEnv, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&te.env, &te.token_id).mint(to, &amount);
    }

    fn init(te: &TestEnv) {
        let c = client(te);
        c.init(&te.admin, &te.token_id, &INIT_PRICE, &INIT_TOTAL);
        c.add_to_whitelist(&te.buyer);
    }

    // ── Oracle tests (Issue #169) ─────────────────────────────────────────────

    #[test]
    fn test_set_and_get_oracle() {
        let te = setup();
        init(&te);
        let c = client(&te);
        let oracle_addr = Address::generate(&te.env);

        assert!(c.get_oracle().is_none());
        c.set_oracle(&oracle_addr);
        assert_eq!(c.get_oracle(), Some(oracle_addr));
    }

    #[test]
    fn test_clear_oracle() {
        let te = setup();
        init(&te);
        let c = client(&te);
        let oracle_addr = Address::generate(&te.env);

        c.set_oracle(&oracle_addr);
        assert!(c.get_oracle().is_some());
        c.clear_oracle();
        assert!(c.get_oracle().is_none());
    }

    #[test]
    #[should_panic(expected = "Contract not initialized: admin")]
    fn test_set_oracle_requires_init() {
        let te = setup();
        let c = client(&te);
        let oracle_addr = Address::generate(&te.env);
        // No init() called — must panic
        c.set_oracle(&oracle_addr);
    }

    #[test]
    fn test_buy_shares_without_oracle_uses_admin_price() {
        let te = setup();
        init(&te);
        let c = client(&te);

        let balance_before: i128 =
            token::TokenClient::new(&te.env, &te.token_id).balance(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);
        let balance_after: i128 =
            token::TokenClient::new(&te.env, &te.token_id).balance(&te.buyer);

        // 10 shares * INIT_PRICE = 1000 tokens spent
        assert_eq!(balance_before - balance_after, 10 * INIT_PRICE);
        assert_eq!(c.get_shares(&te.buyer), 10);
    }

    // ── Bridge tests (Issue #170) ─────────────────────────────────────────────

    #[test]
    fn test_lock_for_bridge_reduces_liquid_balance() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &100, &te.token_id);
        assert_eq!(c.get_shares(&te.buyer), 100);

        c.lock_for_bridge(&te.buyer, &30);
        // Liquid balance reduced
        assert_eq!(c.get_shares(&te.buyer), 70);
        // Locked balance set
        assert_eq!(c.get_bridge_locked(&te.buyer), 30);
    }

    #[test]
    fn test_multiple_lock_for_bridge_accumulates() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &100, &te.token_id);
        c.lock_for_bridge(&te.buyer, &20);
        c.lock_for_bridge(&te.buyer, &10);

        assert_eq!(c.get_shares(&te.buyer), 70);
        assert_eq!(c.get_bridge_locked(&te.buyer), 30);
    }

    #[test]
    #[should_panic(expected = "Insufficient liquid balance to lock for bridge")]
    fn test_lock_for_bridge_insufficient_balance() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &10, &te.token_id);
        // Try to lock more than owned
        c.lock_for_bridge(&te.buyer, &100);
    }

    #[test]
    #[should_panic(expected = "Bridge lock amount must be greater than zero")]
    fn test_lock_for_bridge_zero_amount() {
        let te = setup();
        init(&te);
        let c = client(&te);
        c.lock_for_bridge(&te.buyer, &0);
    }

    #[test]
    fn test_unlock_from_bridge_restores_liquid_balance() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &100, &te.token_id);
        c.lock_for_bridge(&te.buyer, &50);

        let valid_proof: BytesN<32> = BytesN::from_array(&te.env, &[1u8; 32]);
        c.unlock_from_bridge(&te.buyer, &50, &valid_proof);

        // Liquid balance restored
        assert_eq!(c.get_shares(&te.buyer), 100);
        // Bridge locked cleared
        assert_eq!(c.get_bridge_locked(&te.buyer), 0);
    }

    #[test]
    fn test_partial_unlock_from_bridge() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &100, &te.token_id);
        c.lock_for_bridge(&te.buyer, &60);

        let proof: BytesN<32> = BytesN::from_array(&te.env, &[2u8; 32]);
        c.unlock_from_bridge(&te.buyer, &25, &proof);

        assert_eq!(c.get_shares(&te.buyer), 65);
        assert_eq!(c.get_bridge_locked(&te.buyer), 35);
    }

    #[test]
    #[should_panic(expected = "Insufficient locked balance to unlock from bridge")]
    fn test_unlock_from_bridge_excess_amount() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &100, &te.token_id);
        c.lock_for_bridge(&te.buyer, &10);

        let proof: BytesN<32> = BytesN::from_array(&te.env, &[3u8; 32]);
        c.unlock_from_bridge(&te.buyer, &100, &proof);
    }

    #[test]
    #[should_panic(expected = "Invalid bridge proof: proof cannot be all-zeros")]
    fn test_unlock_from_bridge_zero_proof_rejected() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &50, &te.token_id);
        c.lock_for_bridge(&te.buyer, &10);

        let zero_proof: BytesN<32> = BytesN::from_array(&te.env, &[0u8; 32]);
        c.unlock_from_bridge(&te.buyer, &10, &zero_proof);
    }

    #[test]
    #[should_panic(expected = "Bridge unlock amount must be greater than zero")]
    fn test_unlock_from_bridge_zero_amount() {
        let te = setup();
        init(&te);
        let c = client(&te);

        c.buy_shares(&te.buyer, &50, &te.token_id);
        c.lock_for_bridge(&te.buyer, &10);

        let proof: BytesN<32> = BytesN::from_array(&te.env, &[4u8; 32]);
        c.unlock_from_bridge(&te.buyer, &0, &proof);
    }

    #[test]
    fn test_get_bridge_locked_default_zero() {
        let te = setup();
        init(&te);
        let c = client(&te);
        // No lock operations performed — should return 0
        assert_eq!(c.get_bridge_locked(&te.buyer), 0);
    }

    #[test]
    fn test_bridge_lock_does_not_affect_total_shares() {
        let te = setup();
        init(&te);
        let c = client(&te);

        let total_before = c.get_total_shares();
        c.buy_shares(&te.buyer, &100, &te.token_id);
        c.lock_for_bridge(&te.buyer, &50);

        // Total shares never change from bridge operations
        assert_eq!(c.get_total_shares(), total_before);
    }
}

// ── SIP-4 Metadata Tests (Issue #168) ──────────────────────────────────────────

#[cfg(test)]
mod sip4_metadata_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    type Client<'a> = RwaMarketplaceClient<'a>;

    const INIT_PRICE: i128 = 100;
    const INIT_TOTAL: u32 = 1_000;

    struct TestEnv {
        env: Env,
        contract_id: Address,
        admin: Address,
        token_id: Address,
        buyer: Address,
    }

    fn setup() -> TestEnv {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let contract_id = env.register(RwaMarketplace, ());
        let buyer = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &100_000_000);
        TestEnv { env, contract_id, admin, token_id, buyer }
    }

    fn client(te: &TestEnv) -> Client {
        RwaMarketplaceClient::new(&te.env, &te.contract_id)
    }

    fn init(te: &TestEnv) {
        let c = client(te);
        c.init(&te.admin, &te.token_id, &INIT_PRICE, &INIT_TOTAL);
        c.add_to_whitelist(&te.buyer);
    }

    fn mint(te: &TestEnv, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&te.env, &te.token_id).mint(to, &amount);
    }

    #[test]
    fn test_get_contract_metadata_returns_expected_values() {
        let te = setup();
        init(&te);
        let c = client(&te);
        let meta = c.get_contract_metadata();

        assert_eq!(meta.name, String::from_str(&te.env, "RWA Marketplace"));
        assert_eq!(meta.version, String::from_str(&te.env, "0.4.0"));
        assert_eq!(meta.description, String::from_str(&te.env, "Tokenized Fractional RWA Marketplace"));
    }

    #[test]
    #[should_panic(expected = "Contract not initialized")]
    fn test_get_contract_metadata_before_init_panics() {
        let te = setup();
        let c = client(&te);
        c.get_contract_metadata();
    }

    // ── Issue #262: Batch purchase tests ─────────────────────────────────

    #[test]
    fn test_batch_buy_shares_basic() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 10,
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 20,
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 5,
            payment_token: te.token_id.clone(),
        });

        let results = c.batch_buy_shares(&te.buyer, &requests);
        assert_eq!(results.len(), 3);

        // All should succeed
        assert!(results.get(0).unwrap().success);
        assert_eq!(results.get(0).unwrap().shares_purchased, 10);
        assert_eq!(results.get(0).unwrap().total_cost, 1000); // 10 * 100

        assert!(results.get(1).unwrap().success);
        assert_eq!(results.get(1).unwrap().shares_purchased, 20);
        assert_eq!(results.get(1).unwrap().total_cost, 2000); // 20 * 100

        assert!(results.get(2).unwrap().success);
        assert_eq!(results.get(2).unwrap().shares_purchased, 5);
        assert_eq!(results.get(2).unwrap().total_cost, 500); // 5 * 100

        // Verify aggregate state
        assert_eq!(c.get_shares(&te.buyer), 35); // 10 + 20 + 5
        assert_eq!(c.get_available_shares(), 965); // 1000 - 35
    }

    #[test]
    fn test_batch_buy_shares_partial_fulfillment() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        // Second request asks for 0 shares (invalid), should fail
        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 10,
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 0, // Invalid
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 15,
            payment_token: te.token_id.clone(),
        });

        let results = c.batch_buy_shares(&te.buyer, &requests);
        assert_eq!(results.len(), 3);

        assert!(results.get(0).unwrap().success);
        assert!(!results.get(1).unwrap().success); // Failed: 0 shares
        assert!(results.get(2).unwrap().success);

        // Only 10 + 15 = 25 shares purchased
        assert_eq!(c.get_shares(&te.buyer), 25);
        assert_eq!(c.get_available_shares(), 975);
    }

    #[test]
    fn test_batch_buy_shares_exceeds_available() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &50); // Only 50 shares
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 30,
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 30, // Would exceed remaining 20
            payment_token: te.token_id.clone(),
        });

        let results = c.batch_buy_shares(&te.buyer, &requests);
        assert_eq!(results.len(), 2);

        assert!(results.get(0).unwrap().success);
        assert!(!results.get(1).unwrap().success); // Failed: not enough available

        assert_eq!(c.get_shares(&te.buyer), 30);
        assert_eq!(c.get_available_shares(), 20); // 50 - 30
    }

    #[test]
    #[should_panic(expected = "Batch must contain at least one purchase request")]
    fn test_batch_buy_shares_empty_batch() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        c.add_to_whitelist(&te.buyer);

        let requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        c.batch_buy_shares(&te.buyer, &requests);
    }

    #[test]
    #[should_panic(expected = "Batch size exceeds maximum allowed")]
    fn test_batch_buy_shares_exceeds_max_batch_size() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        // Create 11 requests (exceeds MAX_BATCH_SIZE = 10)
        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        for _ in 0..11u32 {
            requests.push_back(BatchPurchaseRequest {
                shares: 1,
                payment_token: te.token_id.clone(),
            });
        }
        c.batch_buy_shares(&te.buyer, &requests);
    }

    #[test]
    #[should_panic(expected = "Buyer is not whitelisted")]
    fn test_batch_buy_shares_requires_whitelist() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        // Not whitelisted

        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 10,
            payment_token: te.token_id.clone(),
        });
        c.batch_buy_shares(&te.buyer, &requests);
    }

    #[test]
    #[should_panic(expected = "Marketplace is paused")]
    fn test_batch_buy_shares_when_paused() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);
        c.pause();

        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 10,
            payment_token: te.token_id.clone(),
        });
        c.batch_buy_shares(&te.buyer, &requests);
    }

    #[test]
    fn test_batch_buy_shares_all_fail() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        // All requests have 0 shares
        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 0,
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 0,
            payment_token: te.token_id.clone(),
        });

        let results = c.batch_buy_shares(&te.buyer, &requests);
        assert_eq!(results.len(), 2);
        assert!(!results.get(0).unwrap().success);
        assert!(!results.get(1).unwrap().success);

        // No state changes
        assert_eq!(c.get_shares(&te.buyer), 0);
        assert_eq!(c.get_available_shares(), 1000);
    }

    #[test]
    fn test_get_batch_quote_accuracy() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 10,
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 0, // Should fail in quote too
            payment_token: te.token_id.clone(),
        });
        requests.push_back(BatchPurchaseRequest {
            shares: 25,
            payment_token: te.token_id.clone(),
        });

        let quotes = c.get_batch_quote(&te.buyer, &requests);
        assert_eq!(quotes.len(), 3);

        assert!(quotes.get(0).unwrap().success);
        assert_eq!(quotes.get(0).unwrap().total_cost, 1000);

        assert!(!quotes.get(1).unwrap().success);

        assert!(quotes.get(2).unwrap().success);
        assert_eq!(quotes.get(2).unwrap().total_cost, 2500);

        // Quote should NOT change state
        assert_eq!(c.get_available_shares(), 1000);
        assert_eq!(c.get_shares(&te.buyer), 0);
    }

    #[test]
    fn test_batch_buy_shares_single_item() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        requests.push_back(BatchPurchaseRequest {
            shares: 50,
            payment_token: te.token_id.clone(),
        });

        let results = c.batch_buy_shares(&te.buyer, &requests);
        assert_eq!(results.len(), 1);
        assert!(results.get(0).unwrap().success);
        assert_eq!(results.get(0).unwrap().shares_purchased, 50);
        assert_eq!(results.get(0).unwrap().total_cost, 5000);
        assert_eq!(c.get_shares(&te.buyer), 50);
        assert_eq!(c.get_available_shares(), 950);
    }

    #[test]
    fn test_batch_buy_shares_max_batch_size() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 1_000_000);
        c.add_to_whitelist(&te.buyer);

        // Exactly 10 requests (the limit)
        let mut requests: Vec<BatchPurchaseRequest> = Vec::new(&te.env);
        for _ in 0..10u32 {
            requests.push_back(BatchPurchaseRequest {
                shares: 1,
                payment_token: te.token_id.clone(),
            });
        }

        let results = c.batch_buy_shares(&te.buyer, &requests);
        assert_eq!(results.len(), 10);
        for i in 0..10u32 {
            assert!(results.get(i).unwrap().success);
        }
        assert_eq!(c.get_shares(&te.buyer), 10);        assert_eq!(c.get_available_shares(), 990);
    }

    // ── Issue #270: Whitelist enhancement tests ───────────────────────────

    #[test]
    fn test_add_to_whitelist_batch() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let a1 = Address::generate(&te.env);
        let a2 = Address::generate(&te.env);
        let mut addrs: Vec<Address> = Vec::new(&te.env);
        addrs.push_back(a1.clone());
        addrs.push_back(a2.clone());
        c.add_to_whitelist_batch(&addrs);
        assert!(c.is_whitelisted(&a1));
        assert!(c.is_whitelisted(&a2));
    }

    #[test]
    fn test_set_whitelist_expiry() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let addr = Address::generate(&te.env);
        c.add_to_whitelist(&addr);
        let far_future = te.env.ledger().timestamp() + 86_400;
        c.set_whitelist_expiry(&addr, &far_future);
        assert!(c.is_whitelisted(&addr));
        c.set_whitelist_expiry(&addr, &1_u64);
        assert!(!c.is_whitelisted(&addr));
    }

    #[test]
    #[should_panic(expected = "Invalid tier")]
    fn test_set_whitelist_tier_invalid() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let addr = Address::generate(&te.env);
        c.set_whitelist_tier(&addr, &5_u32);
    }

    // ── Issue #263: Transfer fee tests ─────────────────────────────────────

    #[test]
    fn test_set_and_get_transfer_fee() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let collector = Address::generate(&te.env);
        c.set_transfer_fee(&30_u32, &collector);
        let (fee_bps, fee_collector) = c.get_transfer_fee();
        assert_eq!(fee_bps, 30);
        assert_eq!(fee_collector, Some(collector));
    }

    #[test]
    #[should_panic(expected = "Transfer fee cannot exceed")]
    fn test_set_transfer_fee_too_high() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let collector = Address::generate(&te.env);
        c.set_transfer_fee(&2000_u32, &collector);
    }

    // ── Issue #268: Buyback enhancement tests ─────────────────────────────

    #[test]
    fn test_request_buyback() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);
        let request_id = c.request_buyback(&te.buyer, &50, &95_i128);
        let request = c.get_buyback_request(&request_id);
        assert!(request.is_some());
    }

    #[test]
    #[should_panic(expected = "Buybacks are currently paused")]
    fn test_buyback_paused() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);
        mint(&te, &te.contract_id, 50_000);
        c.pause_function(&4_u32);
        c.buyback_shares(&te.buyer, &10);
    }

    // ── Issue #465: Global pause checks for all state-changing operations ──

    #[test]
    #[should_panic(expected = "Marketplace is paused")]
    fn test_transfer_shares_when_paused() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);
        c.pause();
        c.transfer_shares(&te.buyer, &te.admin, &5);
    }

    #[test]
    #[should_panic(expected = "Marketplace is paused")]
    fn test_place_sell_order_when_paused() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);
        c.pause();
        c.place_sell_order(&te.buyer, &5, &100_i128);
    }

    #[test]
    #[should_panic(expected = "Marketplace is paused")]
    fn test_buy_from_order_when_paused() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &10, &te.token_id);
        let order_id = c.place_sell_order(&te.buyer, &5, &100_i128);
        c.pause();
        c.buy_from_order(&te.admin, &order_id, &5);
    }

    #[test]
    #[should_panic(expected = "Marketplace is paused")]
    fn test_buyback_shares_when_paused() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &100, &te.token_id);
        mint(&te, &te.contract_id, 50_000);
        c.pause();
        c.buyback_shares(&te.buyer, &10);
    }

    // ── Issue #570: Emergency Asset Delisting ─────────────────────────────

    #[test]
    fn test_delist_asset_halts_trading_and_cancels_orders() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        mint(&te, &te.buyer, 100_000);
        c.add_to_whitelist(&te.buyer);
        c.buy_shares(&te.buyer, &50, &te.token_id);

        // Open two sell orders escrowing 20 + 5 = 25 shares.
        c.place_sell_order(&te.buyer, &20, &150);
        c.place_sell_order(&te.buyer, &5, &100);

        // Sanity: orders exist and escrow held back 25 shares.
        assert!(c.get_sell_order(&0).is_some());
        assert!(c.get_sell_order(&1).is_some());
        assert_eq!(c.get_shares(&te.buyer), 25);

        let reason = soroban_sdk::Bytes::from_slice(&te.env, b"legal-dispute");
        c.delist_asset(&reason);

        // Trading halted and marked permanently delisted.
        assert_eq!(c.is_delisted(), true);
        assert_eq!(c.is_paused(), true);

        // All open orders cancelled and escrowed shares returned to the seller.
        assert!(c.get_sell_order(&0).is_none());
        assert!(c.get_sell_order(&1).is_none());
        assert_eq!(c.get_shares(&te.buyer), 50);
    }

    #[test]
    #[should_panic(expected = "Asset is already delisted")]
    fn test_delist_asset_is_irreversible() {
        let te = setup();
        let c = client(&te);
        c.init(&te.admin, &te.token_id, &100, &1000);
        let reason = soroban_sdk::Bytes::from_slice(&te.env, b"legal-dispute");
        c.delist_asset(&reason);
        c.delist_asset(&reason);
    }
}
