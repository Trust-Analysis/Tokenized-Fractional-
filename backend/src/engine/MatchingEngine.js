class MatchingEngine {
  constructor() {
    this.books = {};
    this.trades = [];
  }
  initBook(id) {
    if (!this.books[id]) this.books[id] = { bids: [], asks: [] };
  }
  addOrder(o) {
    this.initBook(o.contractId);
    let book = this.books[o.contractId];
    let rem = o.amount;
    let isBuy = o.side === 'buy';
    let opp = isBuy ? book.asks : book.bids;
    while (rem > 0 && opp.length > 0) {
      let best = opp[0];
      if (isBuy ? o.price < best.price : o.price > best.price) break;
      let traded = Math.min(rem, best.amount);
      this.trades.push({ contractId: o.contractId, makerId: best.id, takerId: o.id, price: best.price, amount: traded });
      best.amount -= traded;
      rem -= traded;
      if (best.amount === 0) opp.shift();
    }
    o.amount = rem;
    if (rem > 0) {
      let target = isBuy ? book.bids : book.asks;
      target.push(o);
      target.sort((a, b) => (a.price !== b.price ? (isBuy ? b.price - a.price : a.price - b.price) : a.timestamp - b.timestamp));
    }
  }
  getPendingTrades() { return this.trades.splice(0, this.trades.length); }
}
module.exports = MatchingEngine;
