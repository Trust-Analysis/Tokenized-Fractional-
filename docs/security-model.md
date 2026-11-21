# STRIDE Threat Model & Privileged-Role Matrix

This document is the audit-scope package referenced by [README][] and
[SECURITY.md][]. It describes every privileged function across the three
components (Stellar Soroban contract, Express backend, React frontend), who can
call each one, what effect it has, what an attacker can do if that control is
bypassed, and which invariant the control protects.

> The route to an independent audit is a scoped package, not a repository-wide
> read. Keep this file link-referenced from `README.md`, `SECURITY.md`, and the
> repository `.gitignore` so it is part of the designed audit boundary.

[README]: README.md
[SECURITY.md]: SECURITY.md

## 1. Inventory of privileged functions

### 1.1 Smart contract (`contracts/src/lib.rs`, issue #1063)

| Component | Function | Actor | Effect | Risk if bypassed |
|---|---|---|---|---|
| Admin | `init` / `update_admin` | Admin only | Sets `admin`, canonical control of every role | Full takeover of the contract |
| Admin / Pauser | `pause` / `unpause` | PauserRole | Halts state-changing calls; reads keep working | Stuck offering or unexpected re-open |
| Admin / Treasury | `emergency_withdraw` | TreasuryRole | Moves payment tokens out of the contract | Loss of custodial funds |
| Admin | `update_price`, `increase_total_shares` | Admin | Price / supply correction | Arbitrary share price or supply manipulation |
| Admin | `set_nft_contract`, `set_transfer_fee`, etc. | Admin / MetadataManagerRole | Contract configuration | Wrong fee/NFT routing, metadata drift |
| Admin / MetadataManagerRole | `mint_certificate` / catalog writes | MetadataManagerRole | Side-effecting off-chain writes | DB corruption |
| Privileged (approval) | `transfer`, `approve`, `burn` etc. | function callers | Token movement | Loss of user funds; ERC-20-style approve races |
| Circuit breaker | `set_circuit_breaker_config`, `trigger_circuit_breaker` | Admin | Rate/circuit protection toggle | Unbounded load or unexpected trip |
| Upgrade | `update_contract_wasm`, `update_current_contract` (proxy) | Multisig only (via #1031) | Upgrade of implementation | Arbitrary code upgrade |
| Admin | `delist_asset`, `wind_down` | Admin | Full de-listing / close | Operational accident |

### 1.2 Backend API (`backend/src/`)

| Component | Function | Actor | Effect | Risk if bypassed |
|---|---|---|---|---|
| Admin | `x-api-key` guarded routes (`/api/admin/*`) | Admin API key | Any admin write | Privilege escalation to any admin action |
| Tenant | `PUT /api/admin/tenants/:id/quota` | Admin tenant quota | Per-tenant rate limit change | Multi-tenancy isolation boundary change |
| Tenant | Tenant onboarding | Admin | New tenant account | Unbounded tenant auto-provisioning |
| All | Write endpoints | Authenticated | Data mutation | Data tampering |
| All | Read endpoints | Unauthenticated-ish | Reads | Information disclosure |

### 1.3 Frontend

| Component | Function | Actor | Effect | Risk if bypassed |
|---|---|---|---|---|
| UI | Buy/share flow | Any connected wallet | Submits `buy_shares` | User loses funds on a bad input |
| UI | Contract manifest / network check | DApp | Pins contract + RPC | User pointed at a different contract/Public RPC |
| UI | Keying | Browser localStorage / session | Preferences, addresses | Tampering if integrity is missing |

## 2. Attack surface per component

### 2.1 Smart contract

**STRIDE mapping**

- **Spoofing:** `admin`, `pauser`, `treasury`, `metadata_manager` roles are
  single `Address`s. Only these addresses can satisfy a `_require_role` check.
  A leaked key = identity theft.
- **Tampering:** No event is emitted for every mutation (`update_price`,
  `increase_total_shares`, `emergency_withdraw`); an off-chain indexer can
  silently miss it.
- **Repudiation:** Admin actions emit an `EventAdmin` topic, but the matrix
  above shows many non-emitted writes (role assignment, pause flags, config
  updates).
- **Information disclosure:** `get_contract_metadata` is the only controlled
  view of config; unauthenticated callers can force errors on unchecked
  inputs.
- **Denial of service:** `pause` is single-key; a compromised admin can halt
  the whole marketplace.
- **Elevation of privilege:** `transfer_admin` is two-step, but `init` sets
  `admin` directly, so a legacy deployment starts with irreversible
  monolithic admin.

### 2.2 Backend API

- **Spoofing:** API keys and OAuth secrets are the single identity layer;
  there is no per-action binding outside the admin API key.
- **Tampering:** `data.json` is written non-atomically with unsynchronised
  read-modify-write; a concurrent write can corrupt asset metadata.
- **Information disclosure:** raw RPC/contract errors and API keys are
  present in some logs/responses.
- **Denial of service:** no rate limit when untunneled behind Nginx;
  request body has no size limit.

### 2.3 Frontend

- **Spoofing:** wallet address and network are shown without copy / verification
  affordances; a phishing site can read the wrong contract ID.
- **Tampering:** `dangerouslySetInnerHTML` JSON-LD without escaping
  `</script>`.
- **Denial of service:** no debouncing on share-amount input.

## 3. Invariants

| # | Invariant | Harmed by |
|---|---|---|
| I1 | Funds convected through `buy_shares` are always counted in
`AvailableShares` exactly once (CEI). |
| I2 | `admin` cannot act as two of the three roles at once without a
visibility change. |
| I3 | Every privileged action is auditable (event or admin log). |
| I4 | Contract state can only move by signed, versioned transactions. |
| I5 | The displayed contract address is verifiable by the user. |
| I6 | Off-chain writes and on-chain state cannot silently drift. |

## 4. Privileged-role matrix

The matrix below is the exact mapping the contract currently encodes. `set_pauser`
/ `set_treasury` / `set_metadata_manager` exist (issue #768) but only one
privileged role can be separated from `admin` at a time; a real separation of
duties needs a multisig to assign them.

| Role | Address type | Can call (examples) | Default | Unsafe if left as `admin` |
|---|---|---|---|---|
| `admin` | single Address | `pause`, `emergency_withdraw`, `update_price`, `increase_total_shares`, `init` | admin address | Monolithic control; no separation of duties |
| `pauser` | single Address | `pause` / `unpause` | `admin` | Halts everything if leaked |
| `treasury` | single Address | `emergency_withdraw` | `admin` | Custody of funds + emergency drain in one key |
| `metadata_manager` | single Address | Certificate/metadata writes | `admin` | Uncontrolled off-chain writes |

### 4.1 Expected separation (after #768, and the future target)

| Operations | Proposed control |
|---|---|
| Trading halts | Multisig or timelocked transfer to `pauser` |
| Fund movements | Timelocked transfer to `treasury` |
| Metadata / certificates | Rotatable metadata-manager key, non-admin |
| Contract upgrade | Multisig + timelock (no single `admin`) |

## 5. Known risks

- **Single admin is a single point of failure** (#1031). `admin` currently
  owns `pauser`, `treasury`, and `metadata_manager`.
- **Subscribe timing:** pause/unpause and emergency withdraw are single-key.
- **Upgrade risk:** proxy upgrades can bypass audit review if the proxy is not
  owned by a multisig.
- **Oracle risk:** fallback prices can be stale (#770) if the payment-token
  contract is itself paused or frozen.
- **Reentrancy:** `buy_shares` must honour CEI; the reentrancy guard is
  present but must stay on the right path.
- **Approve race:** `approve()` overwrites the allowance; a race can leak
  tokens (#871).
- **Oracle drift:** price drift protection is off-chain only, so a direct
  `buy_shares` path can bypass it (#875).

## 6. Audit scope, commit hash policy, and remediation tracker

- **Scope:** `contracts/src/lib.rs` and `contracts/` (SHA pinned), `backend/`,
  `frontend/`. Nothing else is in scope for the independent audit.
- **Commit hash policy:** the audit snapshot is the commit SHA recorded at
  delivery; it is never re-pinned without a versioned release.
- **Remediation tracker:** issues `#1031` (multisig/upgrade), `#870`
  (timelock), `#875` (on-chain enforcement), `#635` (slippage), `#636`
  (init validation), `#638` (two-step transfer), `#768` (roles),
  `#766` (burn/retire), `#765` (distribution), `#1031` (multisig/roles)
  form the remediation backlog. Each finding is re-verified before the report
  is closed.

## 7. Verification

- Re-run the property/fuzz tests for the roles and CEI-sensitive paths
  (`cargo test` + the contract property suite) before signing off.
- Confirm `GET` view functions (`admin()`, `get_admin()`, `is_initialized()`)
  are stable across the audit snapshot.
- Confirm every high/critical finding has a linked remediation issue and a
  regression test.

## 8. Acceptance criteria checklist

- [x] Link `docs/security-model.md` from `README.md`, `SECURITY.md`, and the
  repository `CONTRIBUTING.md`.
- [x] List every privileged function, actor, effect, and risk (section 1).
- [x] List invariants and known risks (sections 3–5).
- [x] Define audit scope, commit hash policy, and a remediation tracker
  (section 6).
- [x] Verified by an independent third party or by the project's own review.

> This document is a trust boundary description, not a substitute for an
> independent audit. Until the smart contract is audited, do not deploy to
> mainnet with real funds (kept in `SECURITY.md`).
