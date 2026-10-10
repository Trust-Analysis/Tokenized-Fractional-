/**
 * Load-test helper processors for Artillery scenarios.
 *
 * These functions generate realistic fractional trade-order payloads and
 * capture custom metrics so the run produces meaningful latency/throughput
 * numbers that can be compared against a recorded baseline.
 *
 * The functions are referenced from the Artillery YAML configs via:
 *   config.processor: "./helpers/processor.js"
 */

// A realistic Soroban contract id used by the integration tests.
export const DEFAULT_CONTRACT_ID = 'CAQKGPQTYHFHNB6TH6GBZVCHKW5MVEPFCDNNJJR67WDTZL3AIQFZVHG';

// Fractional share sizes (frac units) to distribute across trades.
const SHARE_SIZES = [1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30];
// Notional USD price per whole share.
const PRICE_PER_SHARE = [9500, 10000, 10500, 11200, 12500, 15000, 18000, 22000];

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// Artillery v2 does not reliably expose context._rng as a callable across
// versions, so we always fall back to Math.random when the injected rng is
// unusable. This keeps payload generation deterministic-independent and safe.
function rngFor(context) {
  if (context && typeof context._rng === 'function') return context._rng;
  return Math.random;
}

/**
 * Generate a fractional trade-order body for POST /api/v1/notify/share-purchased.
 * Mirrors the shape the frontend sends after a successful on-chain share purchase.
 */
export function makeSharePurchase(context, events, done) {
  const rng = rngFor(context);
  const sharesToBuy = pick(SHARE_SIZES, rng);
  const pricePerShare = pick(PRICE_PER_SHARE, rng);
  const totalCost = sharesToBuy * pricePerShare;

  const contractId = context.vars.contractId || DEFAULT_CONTRACT_ID;

  context.vars.request = {
    contractId,
    buyerAddress: `G${randomStellarAddress(rng)}`,
    sharesToBuy,
    totalCost,
    sharesPurchased: sharesToBuy,
    pricePerShare,
    totalAmount: totalCost,
    paymentToken: 'XLM',
    blockchainHash: `00000${randomStellarAddress(rng).toUpperCase()}`,
  };
  return done();
}

/**
 * Generate a fractional trade-order body for POST /api/v1/purchases
 * (the purchase-recording endpoint that also invalidates price-history cache).
 */
export function makePurchase(context, events, done) {
  const rng = rngFor(context);
  const sharesToBuy = pick(SHARE_SIZES, rng);
  const pricePerShare = pick(PRICE_PER_SHARE, rng);

  context.vars.request = {
    contractId: context.vars.contractId || DEFAULT_CONTRACT_ID,
    buyerAddress: `G${randomStellarAddress(rng)}`,
    sharesPurchased: sharesToBuy,
    pricePerShare,
    totalAmount: sharesToBuy * pricePerShare,
    paymentToken: 'XLM',
    blockchainHash: `00000${randomStellarAddress(rng).toUpperCase()}`,
  };
  return done();
}

/**
 * Pick a rotating contract id from the supplied CSV payload so the fan-out
 * hits several asset-specific topics instead of hammering a single one.
 * When run with `--config` overrides without a payload file this is a no-op.
 */
export function updateContractId(context, events, done) {
  const id = context.vars.contractId || DEFAULT_CONTRACT_ID;
  context.vars.contractId = id;
  if (done) return done();
}

// Generate a random Stellar G... address fragment (not a valid key, but a
// realistic-length, RFC-safe fake used only by the webhook tests).
function randomStellarAddress(rng = Math.random) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '';
  for (let i = 0; i < 55; i += 1) {
    out += chars[Math.floor(rng() * chars.length)];
  }
  return out;
}

/**
 * Set the WebSocket subscription topic for the ws engine scenario.
 */
export function setWsEnv(context, events, done) {
  context.vars.subscribeTopic = `asset:${context.vars.contractId || DEFAULT_CONTRACT_ID}`;
  return done();
}

/**
 * Register a message handler on the open WebSocket so that every incoming
 * broadcast event is counted. This gives us a receive-rate / fan-out delivery
 * metric that can be compared against the baseline.
 *
 * NOTE: This relies on the WebSocket engine exposing the live socket as
 * `context.ws`. If the underlying artillery version does not expose it, the
 * function degrades gracefully and the engine's own built-in counters are used.
 */
export function trackMessages(context, events, done) {
  const ws = context.ws;
  if (ws && typeof ws.on === 'function') {
    ws.on('message', () => {
      events.emit('counter', 'websocket.messages_received', 1);
      events.emit('rate', 'websocket.receive_rate');
    });
  }
  return done();
}
