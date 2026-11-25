const MAX_I128 = (1n << 127n) - 1n;
export const MAX_ORDER_AMOUNT = (1n << 32n) - 1n;
export const MAX_ORDER_PRICE = MAX_I128 / MAX_ORDER_AMOUNT;

function parseUnits(value, maximum, name) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = BigInt(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value) && value.length <= String(maximum).length) {
    value = BigInt(value);
  }
  if (typeof value !== 'bigint' || value <= 0n || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export default class MatchingEngine {
  constructor() {
    this.books = Object.create(null);
    this.trades = [];
  }

  addOrder(order) {
    if (order.side !== 'buy' && order.side !== 'sell') throw new RangeError('Invalid order side');
    // Soroban prices are atomic units (7 decimals) and quantities are whole u32 shares.
    const price = parseUnits(order.price, MAX_ORDER_PRICE, 'Price');
    let remaining = parseUnits(order.amount, MAX_ORDER_AMOUNT, 'Quantity');
    const book = this.books[order.contractId] ??= { bids: [], asks: [] };
    const isBuy = order.side === 'buy';
    const opposing = isBuy ? book.asks : book.bids;

    while (remaining > 0n && opposing.length > 0) {
      const best = opposing[0];
      if (isBuy ? price < best.price : price > best.price) break;
      const amount = remaining < best.amount ? remaining : best.amount;
      this.trades.push({
        contractId: order.contractId, makerId: best.id, takerId: order.id,
        price: String(best.price), amount: String(amount), totalCost: String(best.price * amount),
      });
      best.amount -= amount;
      remaining -= amount;
      if (best.amount === 0n) opposing.shift();
    }

    if (remaining > 0n) {
      const target = isBuy ? book.bids : book.asks;
      target.push({ ...order, price, amount: remaining });
      target.sort((a, b) => {
        if (a.price === b.price) return a.timestamp - b.timestamp;
        return (isBuy ? a.price > b.price : a.price < b.price) ? -1 : 1;
      });
    }
  }

  getPendingTrades() {
    return this.trades.splice(0, this.trades.length);
  }
}
export default MatchingEngine;
