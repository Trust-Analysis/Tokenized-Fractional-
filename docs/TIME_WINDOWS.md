# Time-Locked Purchase Windows (Issue #271)

A comprehensive time-locked purchase system that allows administrators to create time-restricted windows during which users can purchase fractional shares. This supports phased launches, regulatory requirements, promotional events, and dynamic pricing strategies.

## Overview

Time-locked purchase windows enable administrators to:

- **Phase launches**: Control when shares become available for purchase
- **Promotional pricing**: Offer discounted prices during specific periods
- **Regulatory compliance**: Enforce purchase windows aligned with legal requirements
- **Demand management**: Limit shares per buyer per window to ensure fair distribution
- **Recurring events**: Set up repeating purchase windows (e.g., weekly drops)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Soroban Smart Contract                    │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ TimeWindow   │  │ TimeWindow   │  │ TimeWindowShares  │  │
│  │ Count (u64)  │  │ (u64)        │  │ Bought (u64,Addr) │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
│                                                              │
│  Functions: create_time_window, update_time_window,          │
│             cancel_time_window, buy_shares_in_window,        │
│             get_time_window, get_time_windows,               │
│             get_active_time_window                           │
└─────────────────────────────────────────────────────────────┘
                            │
                    ┌───────┴───────┐
                    │               │
            ┌───────▼───────┐ ┌────▼────────────┐
            │  Backend API   │ │  Frontend UI     │
            │  /time-windows │ │  TimeWindowMgr   │
            │  Event Logging │ │  TimeWindowStatus│
            │  Analytics     │ │  Notifications   │
            └───────────────┘ └─────────────────┘
```

## Smart Contract Functions

### Admin Functions

| Function | Parameters | Description |
|----------|-----------|-------------|
| `create_time_window` | `admin, start, end, price_override, max_per_buyer, total_shares, is_recurring, recurrence_interval, name` | Create a new time window. Reserves shares from available pool. |
| `update_time_window` | `admin, window_id, start, end, price_override, max_per_buyer, total_shares` | Update an active/upcoming window. Cannot update ended windows. |
| `cancel_time_window` | `admin, window_id` | Cancel a window and return unsold shares to available pool. |

### User Functions

| Function | Parameters | Description |
|----------|-----------|-------------|
| `buy_shares_in_window` | `buyer, shares, window_id` | Purchase shares within a specific time window. |

### Query Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `get_time_window` | `Option<TimeWindow>` | Get a specific window by ID. |
| `get_time_windows` | `Vec<TimeWindow>` | List all non-cancelled windows. |
| `get_time_window_count` | `u64` | Total windows ever created. |
| `get_time_window_shares_bought` | `u32` | Shares a buyer purchased in a specific window. |
| `get_active_time_window` | `Option<TimeWindow>` | Get the currently active window (accounts for recurring). |

## Time Window Structure

```rust
pub struct TimeWindow {
    pub id: u64,                    // Unique window identifier
    pub start: u64,                 // Start timestamp (unix)
    pub end: u64,                   // End timestamp (unix)
    pub price_override: Option<i128>, // Override price (None = use base price)
    pub max_shares_per_buyer: u32,  // Max shares per buyer (0 = unlimited)
    pub total_shares: u32,          // Total shares allocated to window
    pub shares_sold: u32,           // Shares sold in this window
    pub is_recurring: bool,         // Whether window repeats
    pub recurrence_interval: u64,   // Seconds between recurrences
    pub name: String,               // Window display name
}
```

## Features

### 1. Time Window Configuration

Administrators can create windows with:
- **Start/End times**: Unix timestamps defining the purchase period
- **Price override**: Optional discounted or premium price for the window
- **Max shares per buyer**: Fair distribution limit
- **Total shares**: How many shares are available in this window
- **Name**: Human-readable identifier

### 2. Recurring Windows

Set `is_recurring: true` and `recurrence_interval` (in seconds) to create windows that automatically repeat:

```javascript
// Weekly purchase window (every 7 days)
create_time_window(
  admin,
  start,          // First window start
  end,            // First window end
  null,           // No price override
  0,              // Unlimited per buyer
  100,            // 100 shares per period
  true,           // Recurring
  604800,         // 7 days in seconds
  "Weekly Drop"
)
```

### 3. Price Integration

- `price_override: None` — Uses the base marketplace price
- `price_override: Some(50)` — Overrides to 50 stroops per share
- Price override applies only within the window; base price applies outside

### 4. NFT Certificates

Shares purchased within time windows still mint NFT certificates (if configured), just like regular `buy_shares` purchases. The NFT represents ownership regardless of how the shares were acquired.

### 5. Governance

- Only admin can create, update, or cancel windows
- Windows cannot be updated after they end
- Cancelling returns unsold shares to the available pool
- All actions are recorded as on-chain events

## Backend API

### REST Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/v1/time-windows/:contractId` | No | List time windows for an asset |
| `GET` | `/api/v1/time-windows/:contractId/:windowId` | No | Get single time window metadata |
| `GET` | `/api/v1/time-windows/:contractId/:windowId/events` | No | Get events for a window |
| `GET` | `/api/v1/time-windows/:contractId/:windowId/analytics` | No | Get window analytics |
| `GET` | `/api/v1/time-windows/:contractId/analytics/aggregate` | No | Aggregate analytics across all windows |
| `GET` | `/api/v1/time-windows/:contractId/analytics/trends` | No | Usage trends over time |
| `GET` | `/api/v1/time-windows/:contractId/events` | No | All events for asset's windows |
| `POST` | `/api/v1/time-windows/:contractId` | Admin | Create time window metadata |
| `PUT` | `/api/v1/time-windows/:contractId/:windowId` | Admin | Update time window metadata |
| `DELETE` | `/api/v1/time-windows/:contractId/:windowId` | Admin | Delete time window metadata |
| `POST` | `/api/v1/time-windows/:contractId/:windowId/log` | Admin | Manually log an event |

### Event Types

| Event Type | Description |
|------------|-------------|
| `window.created` | A new time window was created |
| `window.updated` | A time window was modified |
| `window.cancelled` | A time window was cancelled |
| `window.purchased` | A user purchased shares within a window |
| `window.expired` | A time window has ended |
| `window.recurring.started` | A recurring window period started |
| `window.metadata.created` | Window metadata was added |
| `window.metadata.updated` | Window metadata was updated |
| `window.metadata.deleted` | Window metadata was removed |

### Analytics

The time window service provides:

- **Per-window analytics**: Total purchases, unique buyers, shares sold, volume
- **Aggregate analytics**: Total windows, active/cancelled counts, utilization rate
- **Usage trends**: Daily purchase/shares/volume trends over time

## Frontend Components

### TimeWindowStatus

A public-facing banner displayed on the marketplace page:

- Shows active purchase windows with countdown timer
- Displays upcoming windows with "Opens in" countdown
- Shows shares sold / total and price override info
- Dismissible by users
- Auto-refreshes every 60 seconds

### TimeWindowManager

Admin-only component for managing time windows:

- **Create**: Form with name, start/end times, total shares, price override, max per buyer
- **Edit**: Update upcoming windows (start/end, price, shares)
- **Cancel**: Cancel active/upcoming windows
- **List**: View all windows with status badges (upcoming/active/ended)
- **Progress**: Visual utilization bar showing shares sold vs total
- **Recurring**: Badge indicator for recurring windows

## WebSocket Notifications

Real-time notifications are broadcast via WebSocket when time window events occur:

```javascript
// Subscribe to time window events
subscribe('time-windows');

// Event types received:
// - time_window_created
// - time_window_updated
// - time_window_cancelled
// - time_window_purchased
// - time_window_expired
```

## GraphQL Subscriptions

```graphql
# Subscribe to all time window events
subscription OnTimeWindowEvent {
  onTimeWindowEvent {
    event
    contractId
    windowId
    details
    timestamp
  }
}

# Subscribe to specific asset's time window events
subscription OnAssetTimeWindows($contractId: String!) {
  onTimeWindowEvent(contractId: $contractId) {
    event
    windowId
    details
    timestamp
  }
}

# Query time windows
query GetTimeWindows($contractId: String!) {
  timeWindows(contractId: $contractId) {
    id
    start
    end
    priceOverride
    maxSharesPerBuyer
    totalShares
    sharesSold
    isRecurring
    name
    status
  }
}
```

## Security Considerations

1. **Admin-only creation**: Only the contract admin can create/update/cancel windows
2. **Time validation**: Contracts validate that purchases occur within the window period
3. **Share reservation**: Window creation reserves shares from the available pool
4. **Per-buyer limits**: `max_shares_per_buyer` prevents whale accumulation
5. **Whitelist requirement**: Buyers must be whitelisted (KYC) to purchase in windows
6. **Pause support**: Pausing the marketplace pauses all window purchases
7. **Reentrancy protection**: Window purchases use the same reentrancy guard as regular purchases

## Testing

The smart contract includes 28 comprehensive tests covering:

- Window creation (valid/invalid parameters)
- Window updates (time ranges, share counts)
- Window cancellation (share return logic)
- Purchasing (within/outside windows, price overrides, buyer limits)
- Recurring windows (period advancement, share reset)
- Active window queries (before/during/after windows)
- Edge cases (pre-init, paused marketplace, non-whitelisted buyers)

Run tests:
```bash
cd contracts
cargo test time_window_tests
```

## Migration

A database migration creates the `time_window_events` table:

```bash
cd backend
npx knex migrate:latest
```

## Configuration

No additional configuration is required. Time window features are automatically available when the smart contract is deployed and the backend is running.

## Related Issues

- **Issue #271**: Time-locked purchase windows (this feature)
- **Issue #276**: Flash loan protection (complementary security)
- **Issue #169**: Oracle pricing integration (price override compatibility)
