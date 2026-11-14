# Load Testing Suite

End-to-end load testing for the **Tokenized Fractional** platform's order-matching
flow and real-time WebSocket fan-out (GitHub issue #524), driven by
[Artillery](https://www.artillery.io/).

## What is load-tested

The platform has **two** "order" surfaces:

1. **Backend trade-confirmation path** (HTTP + WebSocket, the CI-runnable part):
   - `POST /api/v1/notify/share-purchased` — broadcasts a share-purchase event to
     every subscribed WebSocket client (the frontend calls this after a successful
     on-chain buy).
   - `POST /api/v1/purchases` — records the trade and invalidates price-history cache.
   - `ws://<host>/ws` — the real-time fan-out channel that distributed live order
     events to clients (see `backend/websocket.js`).

2. **On-chain order-matching engine** (Soroban smart contract,
   `contracts/src/lib.rs`): `place_sell_order`, `buy_from_order`, `buy_shares`.
   Needs a deployed contract + Stellar RPC, so it is **not** part of CI — see
   `scripts/soroban-order-matching.js`.

## Scenarios (Artillery)

| File | What it does | Concurrent users |
|------|--------------|------------------|
| `artillery/smoke.yml` | Quick reachability check for CI | 2 |
| `artillery/trade-orders.yml` | Places fractional trade orders via the REST order endpoints | ~1,000 |
| `artillery/websocket.yml` | 1,000 concurrent WebSocket connections subscribing to live trade topics | ~1,000 |
| `artillery/full-suite.yml` | Combined order-submission + fan-out reproduction | ~1,000 |

## Prerequisites

- Backend running on `http://localhost:3001` (`npm --prefix backend run start`).
- Node.js >= 20.

## Install

```bash
npm --prefix load-test install
```

## Run

```bash
npm run loadtest:smoke       # quick sanity check
npm run loadtest:orders      # trade-order placement (1000 users)
npm run loadtest:websocket   # websocket fan-out (1000 connections)
npm run loadtest:full        # combined suite
npm run loadtest:baseline    # run scenarios + capture baseline metrics
```

Artillery writes raw JSON to `load-test/reports/*.json` and HTML reports to
`load-test/reports/*.html`.

## Environment overrides

Copy `load-test/.env.example` to `.env` or set env vars:

```
API_BASE_URL=http://localhost:3001
WS_BASE_URL=ws://localhost:3001/ws
```

## Baselines

Recorded baseline latency/throughput numbers live in
`load-test/reports/baseline-metrics.json` and are summarised in
[`docs/load-testing.md`](../docs/load-testing.md).

To re-capture a baseline after changes:

```bash
node load-test/helpers/run-baseline.js
```

## CI

See `.github/workflows/load-test.yml`. The CI job runs the `smoke` environment
(with reduced load) so pull requests verify the harness is wired up without
generating heavy traffic.
