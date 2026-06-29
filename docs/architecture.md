# Architecture Overview

The Tokenized Fractional Real-World Assets (RWA) Marketplace is a decentralized application built on the Stellar Network using Soroban Smart Contracts.

## System Architecture

The system consists of three main components:
1. **Frontend**: React + Vite application that interacts with the user and the Freighter wallet.
2. **Backend**: Express.js server providing off-chain metadata for the tokenized assets.
3. **Smart Contract**: Soroban contract (Rust) on the Stellar Network handling the core logic, ownership, and payments.

```mermaid
graph TD
    User([User]) -->|Interacts with UI| Frontend[React Frontend]
    User -->|Approves transactions| Wallet[Freighter Wallet]
    
    Frontend -->|Fetches metadata| Backend[Express.js Backend]
    Frontend -->|Submits transactions| Wallet
    
    Backend -->|Asset Data| Database[(Local JSON DB)]
    
    Wallet -->|RPC Calls| RPC[Stellar RPC]
    RPC -->|Executes| Contract[Soroban Smart Contract]
    
    Admin([Admin]) -->|Manages Assets| Backend
    Admin -->|Deploys & Initializes| Contract
```

## Data Flow Diagrams

### Buy Shares Flow

```mermaid
flowchart TD
    A[User clicks 'Buy Shares'] --> B[Frontend requests asset metadata from Backend]
    B --> C[Frontend prompts Wallet to sign transaction]
    C --> D[Wallet signs and submits tx to RPC]
    D --> E[Soroban Contract verifies payment]
    E --> F{Payment successful?}
    F -- Yes --> G[Contract mints/transfers fractional shares to User]
    F -- No --> H[Transaction reverts]
```

## Smart Contract Storage Layout

The Soroban smart contract uses the following keys to store data on the ledger:

- `Admin`: The administrator's address with privileges to initialize and pause.
- `PaymentToken`: The address of the token (e.g., USDC) accepted for purchasing shares.
- `Price`: The price per fractional share.
- `TotalShares`: The maximum number of shares available for the asset.
- `AvailableShares`: The current number of shares remaining for purchase.
- `IsPaused`: A boolean indicating if the marketplace is paused.
- `Balance(Address)`: Maps a user's address to their current share balance.

## Sequence Diagrams

### Initialize Marketplace (Admin)

```mermaid
sequenceDiagram
    actor Admin
    participant Contract as Soroban Contract
    
    Admin->>Contract: init(admin, payment_token, price, total_shares)
    Contract-->>Contract: Set Admin
    Contract-->>Contract: Set PaymentToken
    Contract-->>Contract: Set Price
    Contract-->>Contract: Set TotalShares & AvailableShares
    Contract-->>Admin: Success
```

### Purchase Shares (User)

```mermaid
sequenceDiagram
    actor User
    participant Wallet
    participant Contract as Soroban Contract
    participant Token as Payment Token
    
    User->>Wallet: Initiate Buy(amount)
    Wallet->>Contract: invoke buy_shares(amount)
    Contract->>Contract: Check if paused (require false)
    Contract->>Contract: Check available shares (require >= amount)
    Contract->>Token: transfer(User, Contract, amount * price)
    Token-->>Contract: Success
    Contract->>Contract: Decrease AvailableShares by amount
    Contract->>Contract: Increase Balance(User) by amount
    Contract-->>Wallet: Success
```

## API Endpoints

### Backend API (REST)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Health check for the backend service |
| `GET` | `/api/rwa` | No | List all real-world assets available |
| `GET` | `/api/rwa/:contractId` | No | Get metadata for a specific asset |
| `POST` | `/api/rwa` | `x-api-key` | Create or update asset metadata |
| `DELETE` | `/api/rwa/:contractId` | `x-api-key` | Delete asset metadata |

### Smart Contract Functions

| Function | Access | Description |
|---|---|---|
| `init` | Admin | Initializes the marketplace configuration. |
| `buy_shares` | Any | Purchases a specified amount of shares using the payment token. |
| `get_shares` | Any | Returns the number of shares owned by a user. |
| `get_available_shares` | Any | Returns the remaining shares available for purchase. |
| `get_total_shares` | Any | Returns the total supply of shares for the asset. |
| `get_price` | Any | Returns the price per share. |
| `is_paused` | Any | Returns whether the marketplace is currently paused. |
| `pause` | Admin | Pauses the marketplace to prevent new purchases. |
| `unpause` | Admin | Unpauses the marketplace. |
| `emergency_withdraw` | Admin | Withdraws the accumulated payment tokens from the contract to the admin. |
