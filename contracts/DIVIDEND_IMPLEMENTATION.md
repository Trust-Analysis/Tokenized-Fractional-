# Dividend distribution implementation

## Overview

The marketplace now supports pro-rata dividend distributions for shareholders based on their holdings at the moment of distribution.

## Calculation model

For each holder with $h$ shares out of a total of $T$ shares and a dividend amount of $D$:

$$
\text{rawAmount} = \left\lfloor \frac{D \times h}{T} \right\rfloor
$$

If a dividend policy enables withholding, the withholding amount is calculated as:

$$
\text{withholding} = \left\lfloor \frac{\text{rawAmount} \times \text{bps}}{10000} \right\rfloor
$$

and the net amount that accrues to the holder is:

$$
\text{netAmount} = \text{rawAmount} - \text{withholding}
$$

## Supported dividend types

- Cash dividends: type `0`
- Token-based dividends: type `1`

Unsupported types are rejected by the policy setter.

## Behavior

- Manual distributions are processed through the `distribute_dividends` entry point.
- Scheduled distributions are processed through `process_scheduled_dividend` using the same pro-rata logic.
- Withholding can be routed to the admin and recorded as accrued dividends for later claiming.
- Dividend positions track `accrued_amount`, `claimed_amount`, and reinvestment preference.
- Dividend history records each distribution event with the payout token and withholding basis points.

## Notes

- All arithmetic uses checked helpers to prevent overflow.
- Zero-balance holders are skipped during distribution.
- Holders with no shares are removed from the active holder registry during distribution.
