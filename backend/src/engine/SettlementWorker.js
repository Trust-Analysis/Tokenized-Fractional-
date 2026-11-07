class SettlementWorker {
  constructor(engine, intervalMs = 5000) {
    this.engine = engine;
    this.interval = intervalMs;
    this.timer = null;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.settle(), this.interval);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async settle() {
    let trades = this.engine.getPendingTrades();
    if (trades.length === 0) return;
    try {
      console.log(`Settling ${trades.length} trades on Soroban...`);
    } catch (err) {
      this.engine.trades.unshift(...trades);
    }
  }
}
module.exports = SettlementWorker;
