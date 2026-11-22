# Matching engine amounts

Submit price and quantity as base-10 integer strings to the matching
engine's `addOrder` interface. Prices are in token atomic units
(10,000,000 units per token for a seven-decimal token). Quantities are whole
shares.

| Field | Minimum | Maximum |
| --- | ---: | ---: |
| Price | 1 | floor((2^127 − 1) / (2^32 − 1)) |
| Quantity | 1 | 4,294,967,295 |

The contract multiplies price by whole shares with checked signed 128-bit
arithmetic. The engine checks these bounds before accepting an order, then
uses integers for order comparison, partial fills, and multiplication.
Fill prices, quantities, and total costs are serialized as decimal strings.
