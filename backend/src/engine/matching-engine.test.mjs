import assert from 'node:assert/strict';
import { test } from 'node:test';
import MatchingEngine, { MAX_ORDER_AMOUNT, MAX_ORDER_PRICE } from './MatchingEngine.js';

const order = { contractId: 'asset', timestamp: 0 };

test('fill cost matches Soroban i128 price times whole u32 shares', () => {
  let seed = 19n;
  for (let index = 0; index < 1000; index++) {
    seed = (seed * 6364136223846793005n + 1n) & ((1n << 128n) - 1n);
    const price = index === 0 ? MAX_ORDER_PRICE : seed % MAX_ORDER_PRICE + 1n;
    const amount = index === 0 ? MAX_ORDER_AMOUNT : (seed >> 64n) % MAX_ORDER_AMOUNT + 1n;
    const engine = new MatchingEngine();
    engine.addOrder({ ...order, id: 'a', side: 'sell', price: String(price), amount: String(amount) });
    engine.addOrder({ ...order, id: 'b', side: 'buy', price: String(price), amount: String(amount) });
    const [trade] = engine.getPendingTrades();
    assert.equal(trade.totalCost, String(BigInt.asIntN(128, price * amount)));
    assert.equal(trade.amount, String(amount));
    assert.equal(trade.price, String(price));
  }
});

test('rejects invalid amounts before a book can change', () => {
  const engine = new MatchingEngine();
  for (const [price, amount] of [[String(MAX_ORDER_PRICE + 1n), '1'], ['1', String(MAX_ORDER_AMOUNT + 1n)], [2 ** 53, '1'], ['1', '0'], ['1.5', 1]]) {
    assert.throws(() => engine.addOrder({ ...order, side: 'sell', price, amount }), RangeError);
  }
  assert.equal(Object.keys(engine.books).length, 0);
});
