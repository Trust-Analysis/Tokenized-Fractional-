Closes #465

## What

Adds global marketplace pause check to four functions that previously only checked granular function-level pauses:

- `transfer_shares` -- now checks global pause before granular check
- `place_sell_order` -- now checks global pause before granular check
- `buy_from_order` -- now checks both global pause and granular pause (previously had neither)
- `buyback_shares` -- now checks global pause before granular check

## Tests

Added 4 unit tests verifying each operation reverts when the contract is paused:
- `test_transfer_shares_when_paused`
- `test_place_sell_order_when_paused`
- `test_buy_from_order_when_paused`
- `test_buyback_shares_when_paused`

## Verification

Contract tests should pass via the CI Smart Contract Tests job (cargo test).
