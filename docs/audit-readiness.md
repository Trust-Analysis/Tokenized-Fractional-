# Audit Readiness, STRIDE Threat Model & Privileged Role Matrix

This document defines the formal audit scope, system threat model, privileged access controls, system invariants, and remediation tracking for the **Tokenized Fractional** protocol. It serves as the primary technical package for independent security auditors prior to mainnet deployment.

---

## 1. Audit Scope & Commit Hash Policy

### 1.1 In-Scope Components
| Component | Primary Repository Path | Primary Technology | Description |
| :--- | :--- | :--- | :--- |
| **Soroban Smart Contracts** | `contracts/` | Rust, Soroban SDK | Core RWA asset tokenization, share issuance, vesting, lockup, secondary orders, and dividend accumulator |
| **Backend Service** | `backend/` | TypeScript / Node.js, SQLite/PostgreSQL | Asset indexing, off-chain metadata caching, authentication, webhook dispatching |
| **Frontend dApp** | `frontend/` | React, Vite, Freighter API | User-facing interface, wallet transaction building and submission |

### 1.2 Target Audit Commit Policy
- **Target Mainnet Freeze Commit**: Identified by release git tag `v1.0.0-audit` (pinned commit SHA-256).
- **Post-Audit Delta Policy**: Any diff touching files under `contracts/` or `backend/auth*` following the audit cutoff must be accompanied by an incremental delta review and signature from the lead auditor.

---

## 2. STRIDE Threat Model

The protocol boundary encompasses three distinct execution tiers:
1. **On-Chain Soroban Engine** (Decentralized state execution, cryptographic authorization via `Address::require_auth`)
2. **Off-Chain Backend & Database** (Indexing, off-chain analytics, metadata storage)
3. **Client Frontend & Freighter Wallet** (Client-side transaction orchestration)

### 2.1 Threat Breakdown

| STRIDE Category | Threat Description | Attack Vector / Surface | Mitigations & Implemented Defenses | Severity |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | Unauthorized entity executes privileged administrative actions (e.g. minting, upgrading, pausing) | Calling admin-only endpoints directly via Soroban RPC | Strict `role_holder.require_auth()` enforcement on all state-altering administrative entrypoints; 2-step admin transfer (`PendingAdmin`). | Critical |
| **Spoofing** | Off-chain API requests spoofed using fabricated session tokens or bearer auth | REST / GraphQL endpoints in `backend/` | JWT token validation with secret rotation, origin verification, and strict schema validation middleware. | High |
| **Tampering** | Manipulation of price per share or token valuation during buy execution | Oracle price manipulation / sandwich attacks | Integrated oracle contract verification (`OracleAddress`), circuit breaker triggers on anomalous volatility jumps. | High |
| **Tampering** | Unauthorized state mutation of shareholder ledger or share dilution | Unchecked arithmetic or storage key collision | Safe math across Soroban calculations (`saturating_add`, checked conversions); namespaced `DataKey` enums. | Critical |
| **Repudiation** | An actor denies executing a buyback, transfer, or administrative configuration change | Off-chain disputability of on-chain state changes | Structured Soroban topic events emitted on every state mutation; transaction ledger sequence pinned in receipts. | Medium |
| **Information Disclosure** | Leakage of private investor credentials or off-chain PII | Backend logs or error stack traces | Structured secret redaction across Pino/Sentry logging pipeline; zero PII stored on-chain. | Medium |
| **Denial of Service (DoS)** | Griefing contract state by exhausting storage TTL or triggering massive iteration gas limits | Unbounded loops over `Holders` or expired ledger entry state | Pull-based distribution accumulator (`DistributionAcc`) eliminates looping; proactive TTL bumping and storage management. | High |
| **Denial of Service (DoS)** | Distributed traffic flooding public backend APIs | REST / GraphQL endpoints | Multi-tier rate limiting (IP-based, tier-based token bucket), Redis-backed rate limiter, Cloudflare DDoS shielding. | Medium |
| **Elevation of Privilege** | Standard token buyer circumvents KYC/AML purchase limits or tier caps | Direct contract invocation of `buy_shares` bypassing UI checks | On-chain whitelist verification (`DataKey::Whitelisted`), purchase limits tracking (`DataKey::PurchaseLimitConfig`), and tier caps (`DataKey::TierLimits`). | High |
| **Elevation of Privilege** | Malicious reentrancy into contract during external token transfer calls | SAC token callbacks | Custom storage reentrancy guard (`DataKey::ReentrancyGuard`) active on sensitive transfer/mint flows. | High |

---

## 3. Privileged Role & Access Control Matrix

Duty separation is implemented across dedicated cryptographic roles (`_require_role`). If a specific role is unassigned, operations fail-safe by falling back to `DataKey::Admin`.

### 3.1 Role Hierarchy & Capabilities

| Role | Storage Key | Designation | Responsibility |
| :--- | :--- | :--- | :--- |
| **Admin** | `DataKey::Admin` | Protocol Superuser | System initialization, contract upgrades, role assignment, parameter tuning, circuit breaker overrides |
| **Pending Admin** | `DataKey::PendingAdmin` | Nominated Superuser | Two-step ownership transfer recipient |
| **Pauser** | `DataKey::PauserRole` | Emergency Responder | Halts state mutations during anomalous volatility or identified exploits |
| **Treasury** | `DataKey::TreasuryRole` | Fund Custodian | Receives protocol fees and emergency asset evacuations |
| **MetadataManager** | `DataKey::MetadataManagerRole` | Asset Operations | Configures metadata URIs, NFT certificates, and asset specifications |

### 3.2 Privileged Functions Reference Table

| Function Name | Authorized Role | Effects & State Mutations | Emitted Soroban Event | Fail-Safe Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `initialize` | First caller / Deployer | Sets `Admin`, initial asset parameters, supply, token contract | `init` event | Callable only once; reverts if already initialized |
| `set_admin` | Admin | Sets `PendingAdmin` for two-step transfer | `admin_nominate` | Current admin retains privileges until accepted |
| `claim_admin` | Pending Admin | Updates `Admin` to caller; clears `PendingAdmin` | `admin_transferred` | Reverts if caller is not `PendingAdmin` |
| `upgrade` | Admin | Updates contract WASM hash subject to timelock | `contract_upgraded` | Must respect `UpgradeTimelock` parameter |
| `pause` | Pauser or Admin | Sets `DataKey::Paused = true`; blocks buy/transfer/sell | `paused` | Read queries remain active |
| `unpause` | Pauser or Admin | Sets `DataKey::Paused = false` | `unpaused` | Cannot unpause if permanently delisted or winded down |
| `wind_down` | Admin | Sets `DataKey::IsClosed = true` and `Paused = true` | `wind_down` | Irreversible; permanently locks buy paths |
| `set_pauser` | Admin | Updates `DataKey::PauserRole` | `pauser_role_updated` | Only callable by verified Admin |
| `set_treasury` | Admin | Updates `DataKey::TreasuryRole` | `treasury_updated` | Requires non-zero Stellar address |
| `set_metadata_manager`| Admin | Updates `DataKey::MetadataManagerRole` | `metadata_manager_updated`| Only callable by verified Admin |
| `set_metadata_uri` | MetadataManager or Admin | Updates asset IPFS/HTTPS metadata pointer | `metadata_uri_updated` | Bounded URI length |
| `set_nft_contract` | MetadataManager or Admin | Binds optional NFT certificate minting address | `nft_contract_updated` | Validated contract address |
| `set_lockup_period` | Admin | Sets default investor transfer lockup (seconds) | `lockup_period_updated` | Does not retroactively shorten existing locks |
| `set_purchase_limits` | Admin | Updates tier limits, max shares per user, KYC tiers | `purchase_limits_updated` | Checked synchronously on every purchase |
| `emergency_withdraw` | Treasury or Admin | Evacuates token collateral to designated treasury | `emergency_withdraw` | Restricted to paused or closed states |

---

## 4. Protocol Invariants

Formal verification and property tests (`contracts/tests/`) ensure the following invariants remain unbroken across every ledger state transition:

1. **Supply Invariant**:
   $$\text{TotalShares} = \text{AvailableShares} + \sum_{h \in \text{Holders}} \text{Balance}(h) + \text{BridgeLockedShares}$$
2. **Non-Negative Balances**:
   $$\forall a \in \text{Addresses},\quad \text{Balance}(a) \ge 0$$
3. **Dividend Solvency**:
   $$\text{ContractTokenBalance} \ge \text{DistributionUnclaimed}$$
4. **Vesting Non-Exceedance**:
   $$\text{VestedClaimed}(a) + \text{VestedRemainingLocked}(a) = \text{VestingTotalAmount}(a)$$
5. **Reentrancy Protection**:
   $$\text{ReentrancyGuard} \equiv \text{Clear} \quad \text{prior to and following every external call invocation}$$

---

## 5. Known Operational Risks & Mitigations

### 5.1 Storage Entry TTL Expiration
- **Risk**: Soroban state keys (Instance and Persistent) have a Time-To-Live (TTL) ledger limit. If instance storage expires, contract calls fail.
- **Mitigation**: Automated TTL renewal routines bump instance and persistent storage keys during normal interactions. Critical administrative functions automatically call `env.storage().instance().extend_ttl(...)`.

### 5.2 Oracle Staleness & Deviations
- **Risk**: Third-party price feeds can lag or report anomalous zero/negative values during network congestion.
- **Mitigation**: Price readings are bounded by minimum and maximum validation corridors; circuit breakers halt transactions if reported price deviates by $> 15\%$ within a single block window.

### 5.3 Single-Admin Risk
- **Risk**: A compromised Admin private key grants upgrade and emergency withdrawal privileges.
- **Mitigation**: Production deployments require `Admin` to be a multi-signature Soroban account or Stellar threshold account requiring a minimum $2\text{-of-}3$ quorum.

---

## 6. Pre-Audit Verification Checklist

- [ ] Complete test suite passing: `cargo test --all` in `contracts/`.
- [ ] Property-based tests verifying supply and dividend invariants pass without regressions.
- [ ] Slither / Cargo Audit / Static analysis run on dependencies with 0 critical or high vulnerabilities.
- [ ] Formal verification scripts executed for all mathematical calculations.
- [ ] Git commit hash tagged and locked for auditor handoff.

---

## 7. Remediation Tracking Template

| Finding ID | Title | Severity | Status | Commit / PR Reference | Resolution Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `AUD-001` | *Example: Reentrancy in buyback* | High | Pending Review | — | Documented and verified |
