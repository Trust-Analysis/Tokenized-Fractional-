# Income distribution implementation

## Overview

The marketplace has a **single canonical income path**: the accumulator-based
`deposit_distribution` / `claim_distribution` pair. It is the only income
mechanism exposed in the contract ABI and the only one documented in the
README API table.

The former pro-rata dividend system (`distribute_dividends`,
`claim_dividends`, `set_dividend_policy`, `process_scheduled_dividend`) has been
deprecated and removed. See `docs/adr/` for the ADR that records this decision
and the rationale for choosing the accumulator model.

## Canonical model: accumulator-based distribution

Income is deposited into a per-token accumulator. Each holder's entitlement is
derived from the accumulator value at the time of deposit versus the value at
the time of their last claim, scaled by their share balance:

$$
\text{entitlement} = \left\lfloor \frac{h \times (A_{\text{now}} - A_{\text{lastClaim}})}{S} \right\rfloor
$$

where $h$ is the holder's shares, $A$ is the accumulator, and $S$ is the
accumulator scaling factor. This makes deposits O(1) regardless of the number
of holders and avoids iterating the holder registry.

## Entry points

- `deposit_distribution` — credits the accumulator with a distribution amount.
- `claim_distribution` — pays out the caller's accrued entitlement and updates
  their last-claimed accumulator checkpoint.

## Scoped / deprecated dividend policy features

The following features belonged to the removed dividend path and are **not**
part of the canonical income model:

- **Withholding** (`set_dividend_policy` basis points) — removed. Any tax or fee
  handling must be performed off-chain or by a separate, explicitly documented
  module; the income path pays gross entitlements.
- **Reinvestment preference** — removed. Holders claim and may reinvest
  themselves.
- **Scheduled distributions** (`process_scheduled_dividend`) — removed. Callers
  invoke `deposit_distribution` on their own schedule.
- **Dividend history / positions** — replaced by the accumulator checkpoints
  stored per holder.

## Notes

- All arithmetic uses checked helpers to prevent overflow.
- Deposits do not iterate holders; claims are per-holder and O(1).
- Zero-share holders accrue nothing and are not touched by deposits.

## Migration notes for existing deployments

### Storage key migration

- The dividend storage keys (`DividendPolicy`, `DividendPosition`,
  `DividendHistory`, `ActiveHolders`) are no longer read or written by the
  contract. Existing entries may be left in place (they are inert) or purged
  with a one-off admin migration.
- Before removing the old path, any unclaimed dividend balances must be settled:
  run a final `claim_dividends` sweep on the old version, or snapshot
  `accrued_amount` per holder and credit it via an initial
  `deposit_distribution` after upgrade.
- Initialize the accumulator (and its scaling factor) before the first
  `deposit_distribution`; a zero accumulator is valid but must be set
  explicitly if a non-default scale is desired.

### Event schema changes

- `dividend_distributed` and `dividend_claimed` events are no longer emitted.
  Indexers should switch to the `distribution_deposited` and
  `distribution_claimed` events emitted by the canonical path.
- Event payloads no longer include withholding basis points or payout-token
  type; they carry the deposited amount, accumulator value, and (for claims)
  the claiming holder and paid amount.
- Update backend and frontend listeners to the new event names and fields
  before deploying the upgraded contract.
