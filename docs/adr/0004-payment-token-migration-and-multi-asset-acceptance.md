# ADR-0004: Payment Token Migration and Multi-Asset Payment Acceptance

**Date:** 2026-10-18  
**Status:** Accepted  
**Author:** Team

Related issue: [#679 Marketplace instance is hardcoded to a single payment token with no multi-asset support](../../issues/679)

## Context

Every marketplace instance recorded its `PaymentToken` once in `init` and never
exposed a way to change it. That created three problems:

1. **Hard dependency on one token.** If the token chosen at deploy time is
   deprecated, depegged, or migrated by its issuer, the only remediation was a
   full contract redeploy plus migration of every buyer balance.
2. **No stablecoin alternative.** Issuers could not start with one payment
   token and later accept a second one (e.g. a locally regulated stablecoin)
   without redeploying.
3. **No migration safety rails.** Even if a migration entry point had existed,
   changing the token underneath outstanding claims would strand funds owed in
   the old token.

The acceptance criteria of #679 required an explicit evaluation of whether a
*list* of accepted payment tokens — each with its own price — should be
supported, and at minimum an admin-gated `update_payment_token` with safety
checks, with the decision documented here.

## Decision

### 1. Multiple accepted payment tokens: accepted, without per-token prices

The contract keeps an `AcceptedTokens` list alongside the single default
`PaymentToken`:

- `add_payment_token(token)` / `remove_payment_token(token)` (admin-only)
  maintain the list; `get_accepted_tokens()` returns it.
- `buy_shares(..., payment_token, ...)` accepts any token in the list.
- The **default** `PaymentToken` remains the unit of account for
  `get_price`, order-book escrow, transfer fees and dividend payouts.

**Per-token pricing (a price per accepted token) is explicitly out of scope
for v1.** All accepted tokens are treated as economically equivalent at the
quoted price: the marketplace quotes one price per share and a buyer paying in
any accepted token pays that same number of the chosen token's smallest unit.
Introducing a price per token would require an oracle/fx layer per token,
slippage semantics per token, and a redesign of the order book (which escrows
and settles in exactly one token) — none of which is justified while the
accepted set is expected to be a small number of same-unit stablecoins.

If a deployment needs genuinely different-priced currencies, the correct unit
of choice is a single stable unit of account plus an oracle-fed token, not a
price table inside the marketplace.

### 2. Payment tokens are migratable, under strict safety checks

`update_payment_token(new_payment_token)` was added with these guards:

| Check | Rationale |
|---|---|
| `admin.require_auth()` | Only the marketplace admin may migrate. |
| Marketplace must be `Paused` | No purchase, order or transfer can be in flight while the token changes. |
| Asset must not be `Delisted` | A permanently delisted asset has no future trades to migrate. |
| `new != old` and `new` must be a deployed token contract | Reject no-ops and typos (same validation style as `init`). |
| **Zero outstanding unclaimed funds in the old token** | The contract must custody no balance of the old token, no holder may have an unsettled `claim_distribution` amount in it, and no holder may have accrued unclaimed dividends whose payout token is the old token. |

On success the default `PaymentToken` is replaced and the accepted list is
updated in place (the outgoing token is swapped for the new one, any other
accepted tokens are preserved), and `EventUpdatePaymentToken` is emitted so
indexers and the frontend can refresh their configuration.

`get_payment_token()` exposes the current default on-chain.

The "zero outstanding unclaimed funds" check also makes the operational
runbook explicit: **settle first, migrate second.** Holders claim pending
distributions/dividends in the old token, and any sub-unit rounding residue
left in the contract is swept with `emergency_withdraw` before the migration
is attempted.

## Consequences

### Positive

- Issuers can adopt a stablecoin alternative, or replace a deprecated token,
  without redeploying or migrating share balances — the cap table, balances
  and order history all stay in place.
- The pause requirement guarantees a clean cutover: no partially-filled
  purchase can reference the old token after the switch.
- The unclaimed-funds check prevents the classic migration bug of orphaning
  user funds in an abandoned token.
- Existing multi-token acceptance (`add_payment_token`) already removes the
  "single token for the lifetime" limitation for *inbound* payments.

### Negative

- The migration is deliberately conservative: it cannot run while the
  contract holds any balance of the old token, so operators must coordinate
  holder claims (and dust sweeps) first. This is intended.
- One price for all accepted tokens means issuers must pick economically
  comparable tokens; a mis-priced accepted token is an arbitrage surface.
- Dividend policies (`set_dividend_policy`) are configured independently and
  keep their own `payout_token`; operators must review them separately when
  migrating.

### Alternatives Considered

**Redeploy the contract and migrate balances.** Rejected: destroys history,
forces every holder to re-verify, and is exactly the remediation gap the issue
complains about.

**No migration, document the limitation.** Rejected: leaves issuers with no
remediation path if the deploy-time token disappears.

**A price per accepted token (multi-asset pricing).** Deferred (see above):
requires an fx/oracle layer and an order-book redesign; out of scope for v1.

**Migrating while unpaused with a flag flip per entry point.** Rejected: every
state-changing entry point would need a "which token do I use now" branch
running concurrently with purchases; pausing gives one atomic cutover point.

## Notes

- Implementation: `update_payment_token`, `get_payment_token`,
  `add_payment_token`, `remove_payment_token`, `get_accepted_tokens` in
  `contracts/src/lib.rs`.
- Read-only functions (`get_price`, `get_shares`, `get_payment_token`,
  `get_accepted_tokens`, …) are never gated by `pause`; see
  [docs/architecture.md](../architecture.md) for the affected-by-pause table.
- Off-chain consumers should index `EventUpdatePaymentToken` and
  `EventAddPaymentToken` / `EventRemovePaymentToken`.
