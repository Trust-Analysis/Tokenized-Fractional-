# Event Schema Documentation

This document describes all events emitted by the RWA Marketplace contract. Events enable off-chain systems (indexers, analytics, dashboards, alerting) to track and reconstruct contract state changes in real time.

---

## Event Format

All events are published using Soroban's `#[contractevent]` attribute. Unless otherwise noted, events use `data_format = "vec"` and emit their fields as a vector of values.

The contract ID is always the marketplace contract itself.

---

## Complete Event Catalog

### Initialization & Lifecycle

| Event | Triggered By | Fields |
|---|---|---|
| `EventInit` | `init()` | `admin: Address`, `payment_token: Address`, `price: i128`, `total_shares: u32` |
| `EventPause` | `pause()` | *(no fields)* |
| `EventUnpause` | `unpause()` | *(no fields)* |
| `EventEmergencyWithdraw` | `emergency_withdraw()` | `to: Address`, `amount: i128` |
| `EventContractUpgraded` | `upgrade()` | `new_wasm_hash: BytesN<32>` |

### Price & Supply

| Event | Triggered By | Fields |
|---|---|---|
| `EventSetPrice` | `set_price()` | `old_price: i128`, `new_price: i128` |
| `EventSetTotalShares` | `set_total_shares()` | `old_total: u32`, `new_total: u32` |
| `EventSetMaxSharesPerUser` | `set_max_shares_per_user()` | `old_max: u32`, `new_max: u32` |

### Share Purchases

| Event | Triggered By | Fields |
|---|---|---|
| `EventBuyShares` | `buy_shares()`, `buy_vested_shares()` | `buyer: Address`, `shares: u32`, `total_cost: i128` |
| `EventClaimVestedShares` | `claim_vested_shares()` | `claimer: Address`, `amount: u32` |

### Dividends

| Event | Triggered By | Fields |
|---|---|---|
| `EventSetDividendSchedule` | `set_dividend_schedule()` | `amount_per_share: i128`, `interval: u64` |
| `EventScheduledDividend` | `process_scheduled_dividend()` | `total_amount: i128`, `holder_count: u32` |
| `EventDistributeDividends` | `distribute_dividends()` | `token: Address`, `total_amount: i128`, `holder_count: u32` |

### Share Transfers & Allowances

| Event | Triggered By | Fields |
|---|---|---|
| `EventTransfer` | `transfer_shares()`, `transfer_shares_from()` | `from: Address`, `to: Address`, `amount: u32` |
| `EventApproval` | `approve()` | `owner: Address`, `spender: Address`, `amount: u32` |

### Sell Orders (Secondary Market)

| Event | Triggered By | Fields |
|---|---|---|
| `EventOrderPlaced` | `place_sell_order()` | `order_id: u64`, `seller: Address`, `amount: u32`, `price_per_share: i128` |
| `EventOrderCancelled` | `cancel_sell_order()` | `order_id: u64`, `seller: Address` |
| `EventOrderFilled` | `buy_from_order()` | `order_id: u64`, `buyer: Address`, `amount: u32`, `total_cost: i128` |

### Buyback

| Event | Triggered By | Fields |
|---|---|---|
| `EventBuybackShares` | `buyback_shares()` | `seller: Address`, `amount: u32`, `total_cost: i128` |
| `EventAutoBuybackConfig` | `auto_buyback_config()` | `interval: u64`, `max_amount: u32`, `budget: i128` |

### Payment Tokens

| Event | Triggered By | Fields |
|---|---|---|
| `EventAddPaymentToken` | `add_payment_token()` | `token: Address` |
| `EventRemovePaymentToken` | `remove_payment_token()` | `token: Address` |

### NFT Certificate Contract

| Event | Triggered By | Fields |
|---|---|---|
| `EventNftContractSet` | `set_nft_contract()` | `nft_contract: Address` |

### Whitelist (KYC)

| Event | Triggered By | Fields |
|---|---|---|
| `EventWhitelisted` | `add_to_whitelist()` | `addr: Address` |
| `EventWhitelistRemoved` | `remove_from_whitelist()` | `addr: Address` |

### Metadata

| Event | Triggered By | Fields |
|---|---|---|
| `EventMetadataUriSet` | `set_metadata_uri()` | `uri: Bytes` |

### Oracle (Issue #169)

| Event | Triggered By | Fields |
|---|---|---|
| `EventSetOracle` | `set_oracle()` | `oracle: Address` |
| `EventOraclePriceFetched` | `buy_shares()` (oracle path) | `oracle: Address`, `price: i128` |
| `EventOraclePriceFallback` | `buy_shares()` (fallback path) | `admin_price: i128` |

### Bridge (Issue #170)

| Event | Triggered By | Fields |
|---|---|---|
| `EventLockForBridge` | `lock_for_bridge()` | `user: Address`, `amount: u32`, `total_locked: u32` |
| `EventUnlockFromBridge` | `unlock_from_bridge()` | `user: Address`, `amount: u32`, `proof: BytesN<32>` |

### Timelock

| Event | Triggered By | Fields |
|---|---|---|
| `EventOperationScheduled` | `schedule_operation()` | `action: AdminAction`, `execute_after: u64` |
| `EventOperationCancelled` | `cancel_operation()` | `action: AdminAction` |
| `EventOperationExecuted` | `execute_operation()` | `action: AdminAction` |

---

## Off-Chain Indexing Guide

### Reconstructing State

Events are designed to allow full state reconstruction:

1. **Total shares & available shares**: Track `EventInit`, `EventBuyShares`, `EventSetTotalShares`, `EventBuybackShares`, `EventOrderFilled`.
2. **Per-holder balances**: Track `EventBuyShares`, `EventTransfer`, `EventBuybackShares`, `EventClaimVestedShares`, `EventOrderFilled`, `EventLockForBridge`, `EventUnlockFromBridge`.
3. **Price history**: Track `EventSetPrice`, `EventOraclePriceFetched`, `EventOraclePriceFallback`.
4. **Dividend history**: Track `EventSetDividendSchedule`, `EventDistributeDividends`, `EventScheduledDividend`.

### Indexing Strategy

All events are emitted by the marketplace contract address. Indexers should:

1. Subscribe to all events from the marketplace contract.
2. Parse the event type from the topic (first element of the event data vector).
3. Index fields according to the schema above.
4. Store timestamps from the ledger for chronological ordering.

---

closes #167
