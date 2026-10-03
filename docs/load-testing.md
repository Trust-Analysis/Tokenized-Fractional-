# Load Testing Documentation

> GitHub issue [#524](https://github.com/Avatar-Trust-Analysis/Tokenized-Fractional-/issues/524)
> — End-to-end load testing of the order-matching engine and WebSocket servers
> under heavy concurrent user load.

This document records **why** we load test, **how** the suite is run, and the
**baseline latency / throughput** metrics for the trade-order and real-time
fan-out surfaces. It complements [`docs/performance.md`](./performance.md).

## Approach

We use [Artillery](https://www.artillery.io/) — an open-source, npm-installable
load generator that fits the existing Node.js toolchain and ships a native
WebSocket engine.

The suite lives in [`load-test/`](../load-test):

| Component | Purpose |
|-----------|---------|
| `artillery/trade-orders.yml` | ~1,000 concurrent users placing fractional trade orders (REST) |
| `artillery/websocket.yml` | ~1,000 concurrent WebSocket connections subscribed to trade topics |
| `artillery/full-suite.yml` | Combined order-submission + live fan-out reproduction |
| `helpers/run-baseline.js` | Runs scenarios + captures curated baseline metrics |
| `reports/baseline-metrics.json` | Committed snapshot of baseline metrics |

## Architecture context (important)

The order-matching engine lives **on-chain** in the Soroban smart contract
(`contracts/src/lib.rs` — `place_sell_order`, `buy_from_order`, `buy_shares`).
The backend HTTP service (`backend/src`) does **not** match orders; it records
trades and broadcasts them:

- `POST /api/v1/notify/share-purchased` → fans a share-purchase event out to all
  subscribed clients via `backend/websocket.js` (`ws://<host>/ws`).
- `POST /api/v1/purchases` → records the trade and invalidates price cache.

Therefore the load test exercises:

1. **Submit side** — the REST trade-confirmation endpoints under 1,000 concurrent
   users, measuring latency and throughput.
2. **Receive side** — 1,000 concurrent WebSocket connections subscribed to
   `share-purchases` and `asset:<contractId>` topics, measuring broadcast
   delivery.

For a genuine on-chain order-matching benchmark, `load-test/scripts/soroban-order-matching.js`
provides a driver (requires a deployed contract + Stellar RPC; not run in CI).

## Baseline Metrics

Captured with the Artillery suite against a backend at `http://localhost:3001`.

> Status: these figures are the **reference/initial** baseline. The fields with
> `null` are filled in automatically by `npm run loadtest:baseline` against a
> live deployment. Initial single-request reference timings from
> `docs/performance.md` are included for context.

### Trade-order placement (HTTP)

| Metric | Baseline | Notes |
|--------|----------|-------|
| Endpoint | `POST /api/v1/notify/share-purchased` | Broadcasts trade to WS clients |
| Concurrent users | 1,000 | Ramp + sustain in `trade-orders.yml` |
| Request rate | to measure (req/s) | `requestsPerSecond` from Artillery |
| Latency mean | to measure | ms |
| Latency p50 | to measure | ms |
| Latency p95 | to measure | ms |
| Latency p99 | to measure | ms |
| Success rate | to measure | % (2xx) |
| Reference (single request) | 5 – 30 ms | `/api/*` endpoints, `docs/performance.md` |

### WebSocket fan-out

| Metric | Baseline | Notes |
|--------|----------|-------|
| Endpoint | `ws://localhost:3001/ws` | Plain `ws://`, JSON messages |
| Concurrent connections | 1,000 | `websocket.yml` ramp + sustain |
| Messages received | to measure | counted via `trackMessages` processor |
| Receive rate | to measure | msgs/sec broadcast delivered |
| Handshake latency | to measure | time to `connection_established` |

### Capacity envelope (from `docs/performance.md`)

| Load | Requests/sec | Avg response | P99 | Success |
|------|--------------|--------------|-----|---------|
| Light | 10 | 20 ms | 50 ms | 99.9% |
| Medium | 100 | 45 ms | 150 ms | 99.8% |
| Heavy | 500 | 150 ms | 500 ms | 99.0% |

## How to capture / refresh a baseline

```bash
# 1. Start the backend
npm --prefix backend run start            # listens on :3001

# 2. Install and run the baseline capture
npm --prefix load-test install
node load-test/helpers/run-baseline.js    # writes reports/baseline-metrics.json
```

## CI

`.github/workflows/load-test.yml` runs the `smoke` scenario on every
PR/push touching `load-test/**` (low load, verifies the harness), and supports a
manual `workflow_dispatch` to trigger the heavier suites against a target URL.

## Adding a performance regression gate

Once a trusted baseline is captured, add a threshold so the suite fails when
metrics regress beyond a budget (example thresholds below are illustrative):

```yaml
ensure:
  thresholds:
    - "http.response_time:p99<1000"
    - "http.errors:count<100"
```

If you add these, install the plugin and note it: the suite intentionally ships with
only the core `artillery` dependency so installs stay lightweight.

## References

- [Artillery Documentation](https://www.artillery.io/docs)
- [WebSocket Engine reference](https://www.artillery.io/docs/reference/engines/websocket)
- [Soroban / Stellar docs](https://developers.stellar.org/docs)
- [`docs/performance.md`](./performance.md) — API & contract performance budgets
