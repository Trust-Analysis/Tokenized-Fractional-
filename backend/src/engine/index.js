const MatchingEngine = require('./MatchingEngine');
const SettlementWorker = require('./SettlementWorker');

const engine = new MatchingEngine();
const worker = new SettlementWorker(engine, 5000); // 5-second batches

module.exports = {
  engine,
  worker
};
