# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest (main) | ✅ |

## Scope

This policy covers security vulnerabilities in:

- **Smart Contract** (`contracts/`) — Soroban/Rust logic handling share purchases, admin controls, and token transfers on the Stellar network.
- **Backend API** (`backend/`) — Express.js off-chain metadata service.
- **Frontend** (`frontend/`) — React + Vite dApp interacting with Freighter wallet and Soroban RPC.

## Smart Contract Audit Status

**Status: UNAUDITED** (as of 2026-09-28).

The Soroban contract in `contracts/` has **not** been reviewed by an
independent third party. There is no audit report to link to. The contract
custodies payment-token balances and holds an admin key that can pause trading,
change the price, raise the share supply and withdraw tokens, so an unreviewed
defect in that logic is a direct financial risk.

| Component | Audit status |
| --- | --- |
| Smart contract (`contracts/`) | **Unaudited** — no independent review has been performed |
| Backend API (`backend/`) | Not separately audited |
| Frontend (`frontend/`) | Not separately audited |

### Mainnet risk disclaimer

> **Do not deploy this contract to Stellar mainnet to custody real user funds
> while it is unaudited.** An unaudited contract may contain a fund-loss or
> access-control defect. Anyone evaluating a mainnet deployment — issuers,
> operators, or forks of this repository — should treat that as a known,
> accepted risk only after their own independent review, and should start with
> a capped-value or testnet pilot rather than full production value.

This disclaimer is removed only when an audit report is published **and** its
findings have been remediated (see below).

### Audit plan

- [ ] Freeze the contract's public interface for the audit window.
- [ ] Engage an independent auditor with Soroban/Rust experience.
- [ ] Give the auditor the fund-handling and admin surface: `buy_shares`,
      `transfer_admin` / `accept_admin`, `pause` / `unpause`,
      `emergency_withdraw`, `update_price`, `increase_total_shares` and the
      price oracle fallback.
- [ ] Remediate every high/critical finding and re-verify the fixes.
- [ ] Publish the report and update this section.

When the status changes, replace **UNAUDITED** with **AUDITED**, link the report
next to the table above, and keep the disclaimer until the findings are closed.

### Re-audit policy

An audit is a snapshot of one revision, not a permanent guarantee. A **re-audit
(or written sign-off from the original auditor) is required** before merging any
of the following into `contracts/`:

1. A change to how payment tokens move — `buy_shares`, fees, or the transfer/
   mint path.
2. A change to the admin surface or the two-step admin transfer.
3. A change to the storage layout, keys, or `init`/migration behaviour.
4. A change to oracle handling or the `update_price` fallback.
5. A new external dependency in the contract's trust boundary.
6. A fix for a previously reported security finding.

The re-audit is tracked as an issue against the pull request that makes the
change, and this section is updated in the same pull request that closes it.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via one of these channels:

1. **GitHub Private Vulnerability Reporting** (preferred): [Report a vulnerability](https://github.com/Trust-Analysis/Tokenized-Fractional-/security/advisories/new)
2. **Email**: Send details to the repository maintainers. Find contact info in the repository's GitHub profile.

### What to include

- A clear description of the vulnerability and its potential impact.
- The component affected (smart contract / backend / frontend).
- Steps to reproduce or a proof-of-concept (PoC).
- Any suggested mitigations.

## Response Timeline

| Stage | Target |
| ----- | ------ |
| Acknowledgement | Within 72 hours |
| Initial assessment | Within 7 days |
| Fix or mitigation | Within 30 days (critical issues sooner) |
| Public disclosure | After fix is deployed |

## Smart Contract Considerations

The Soroban smart contract manages financial transactions on the Stellar network. High-severity issues include:

- Unauthorised access to `admin`-only functions (`pause`, `unpause`, `emergency_withdraw`, `update_price`, `increase_total_shares`).
- Re-entrancy or integer overflow in `buy_shares`.
- Bypassing the pause mechanism.
- Token drain or fund misappropriation.

### Admin Key Management (Issue #638)

The contract uses a **two-step admin transfer** to prevent accidental or malicious admin key rotation:

1. **`transfer_admin(new_admin)`** — The current admin proposes a new admin address. The proposal is stored as a pending transfer; the current admin retains full privileges until the transfer is completed.
2. **`accept_admin()`** — The pending admin calls this to complete the transfer. Only the pending admin can call this function. After acceptance:
   - The old admin loses **all** admin privileges immediately.
   - The pending admin becomes the new admin.
   - The pending admin slot is cleared.

**Why two steps?** A single-step `set_admin(new_admin)` would instantly lock out the current admin. If `new_admin` is a mistyped or compromised address, recovery is impossible. The two-step pattern ensures the new admin explicitly accepts the role before gaining any control.

**Key management best practices:**

- Use a **multi-sig** account as the admin address. Stellar supports native multi-sig, and the contract will respect whatever signing policy the admin account enforces.
- Before calling `transfer_admin`, verify the new admin address is correct and controlled by the intended party.
- After `accept_admin`, the old admin key should be considered revoked and should no longer be used for any contract operations.
- Monitor `EventAdminTransferInitiated` events for unexpected admin transfer proposals.
- If a transfer is initiated by mistake, the pending admin can simply never call `accept_admin()`, and the transfer expires (pending admin can be overwritten by a new `transfer_admin` call from the current admin).

## Runbook: Correcting a Deployment Mistake

`init` writes `PricePerShare` and `TotalShares` exactly once. If either value was mis-keyed at
deployment (a misplaced decimal, the wrong token scale, a tranche size that does not match the
deposit agreement), the correction is made **in place** on the existing contract — no redeploy, no
holder migration, no loss of share balances.

Two admin-only entry points exist for this, and both refuse to run unless the marketplace is
already paused:

| Function | Purpose | Rejects |
| --- | --- | --- |
| `update_price(new_price)` | Replaces the static price per share (smallest unit of the payment token). | Non-admin callers, a live (unpaused) marketplace, `new_price <= 0`. |
| `increase_total_shares(additional)` | Adds a follow-on tranche of the same underlying asset: raises `TotalShares` **and** the `AvailableShares` pool by `additional`. | Non-admin callers, a live (unpaused) marketplace, `additional == 0`, a delisted asset, `u32` overflow. |

`increase_total_shares` is additive only. It can never shrink supply below the number of shares
already issued, and no holder's balance changes unless they buy: the new shares are only ever sold
through `buy_shares`, which still enforces the whitelist, the purchase limits and payment. Existing
holders keep their exact share count; their percentage of the enlarged supply shrinks, as it would
with any new issuance.

Each call emits an event carrying the before and after values: `EventUpdatePrice`
(`old_price`, `new_price`) and `EventIncreaseTotalShares` (`old_total`, `additional`, `new_total`).
Use these for reconciliation, not the transaction envelope.

### Procedure

1. **Confirm the mistake.** Read `get_price()`, `get_total_shares()` and `get_available_shares()`
   and compare them against the signed offering memorandum. Determine whether the bad value was ever
   *used* — check `EventBuyShares` and the token balances for purchases settled at the wrong price.
2. **Announce and halt.** Tell holders/support before touching the contract, then call `pause()`.
   This is what unlocks the correction functions and guarantees no buy settles at the stale value
   while the correction is in flight.
3. **Check for an oracle.** If `get_oracle()` returns an address, `buy_shares` reads the price from
   the oracle first and only falls back to the static price. If the *oracle* is what is wrong, fix
   the oracle (or call `clear_oracle()`) first — otherwise `update_price` writes a value that trades
   never consult.
4. **Apply the correction.** Invoke `update_price` and/or `increase_total_shares` as the admin
   address. For a multi-sig deployment, the admin address is the multi-sig account and its approval
   policy is what signs the transaction.
5. **Verify.** Re-read `get_price()` / `get_total_shares()` / `get_available_shares()`, and confirm
   `is_delisted()` is still `false`. If `TotalShares` was raised, confirm `AvailableShares` rose by
   the same `additional`, and that already-issued shares were untouched.
6. **Resume.** Call `unpause()` and confirm `is_paused()` is `false`.
7. **Publish.** Attach the `EventUpdatePrice` / `EventIncreaseTotalShares` records to the incident
   record, and notify holders that the correction happened and when trading resumed.

### Notes and limits

- The legacy `set_price` / `set_total_shares` functions are **not** pause-gated and can set an
  absolute total in either direction. Prefer `update_price` / `increase_total_shares` for
  corrections: they are strictly safer, and they are the functions the operational process
  documented above relies on.
- `increase_total_shares` cannot be used on a delisted asset. `delist_asset` is permanent, so a
  retired asset's supply stays fixed forever.
- These functions change the terms of the offering. Treat them as privileged operations: the admin
  key should be a multi-sig, corrections should be announced in advance, and every invocation is
  permanently visible on-chain.

## Disclosure Policy

We follow a **coordinated disclosure** model. We ask reporters to keep the vulnerability confidential until we have released a fix and notified affected users.

We will credit researchers who responsibly disclose valid vulnerabilities (unless they prefer to remain anonymous).

## Out of Scope

- Vulnerabilities in third-party dependencies (report those upstream).
- Issues that require physical access to a user's device.
- Social engineering attacks.
- Freighter Wallet bugs (report to [Freighter](https://github.com/stellar/freighter)).
