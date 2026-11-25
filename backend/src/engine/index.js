import MatchingEngine from './MatchingEngine.js';
import SettlementWorker from './SettlementWorker.js';

const engine = new MatchingEngine();
const worker = new SettlementWorker(engine, 5000); // 5-second batches

export { engine, worker };
export {
  engine,
  worker
};
