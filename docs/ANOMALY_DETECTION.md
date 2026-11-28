# Request anomaly detection

`backend/src/services/anomalyDetector.js` scores every `/api/` request (via
`RateLimiterService.checkRateLimit`) for abusive traffic patterns. It works on
HTTP request patterns. On-chain manipulation such as flash loans or
same-ledger buy/sell is handled by `flashLoanProtectionService.js`.

## How a request is scored

Each feature produces a score in `[0, 1]` from recent per-IP or per-API-key
history, and has a weight for how suspicious it is on its own. They combine
as a noisy-OR, `score = 1 − Π(1 − weightᵢ · featureᵢ)`:

| Feature | 0 at | 1 at | Weight |
| --- | --- | --- | --- |
| `burst_rate` (per IP, 2 s) | ≤ `ANOMALY_BURST_THRESHOLD` (50) | 2× threshold | 0.9 |
| `request_frequency` (per IP, `ANOMALY_TIME_WINDOW_MS`) | ≤ 10 req/s | ≥ 50 req/s | 0.8 |
| `path_diversity` (per API key, 60 s) | ≤ 10 distinct paths | ≥ 30 | 0.6 |
| `user_agent_diversity` (per IP, 5 min) | ≤ 3 UAs (NAT, several devices) | ≥ 8 | 0.6 |
| `sequential_pattern` (per IP, 5 s) | — | ≥ 20 requests over ≥ 10 paths | 0.5 |
| `time_of_day_anomaly` | — | 02:00–05:59 UTC → 0.3 | 0.1 |
| `geo_velocity` | not implemented (always 0) | | 0.5 |

A request is flagged when `score ≥ ANOMALY_CONFIDENCE_THRESHOLD` (0.7). That
means one strong signal (a flood or sustained scraping) blocks on its own,
while scanning and UA rotation block only together or alongside a high rate.

## Action taken on a flag

1. `RateLimiterService` rejects **that request** with `429`,
   `reason: "anomaly_detected"`, `Retry-After: 300` and `X-RateLimit-Anomaly`
   headers.
2. It is recorded through `RateLimitAnalytics.logBlocked` (visible in the
   rate-limit admin analytics), and the detector logs a `warn`
   ("Anomalous request pattern flagged") with the IP, the API key prefix and
   the reasons.

This is a soft block, not a ban. Every request is re-scored, so a client is let
through again once its recent history looks normal. `Retry-After` is
advisory. Both behaviours are covered by `backend/__tests__/anomalyDetector.test.js`.
To switch detection off, set `ANOMALY_DETECTION_ENABLED=false`. Thresholds can
be tuned at runtime through `PUT /api/admin/rate-limits/anomaly/config`.

## Accuracy bar

`backend/__tests__/fixtures/anomalyDataset.js` holds a labelled, seeded set of
request sequences, and the test suite replays each one through a fresh
detector with a simulated clock:

- **Normal** (18 sequences): casual browsing, an active trader polling every
  second, SPA page loads fanning out 15 parallel requests, an office behind
  one NAT IP with 3 browsers, an integration partner at a steady 8 req/s,
  night-time browsing.
- **Suspicious** (15 sequences): flood bursts, sustained scraping at
  50–100 req/s, fast endpoint enumeration, user-agent rotation while probing,
  and rapid buy/sell order cycling.

The minimum bar enforced in CI:

| Metric | Bar | Current |
| --- | --- | --- |
| True-positive rate (suspicious sequence flagged at least once) | ≥ 0.90 | 1.00 |
| False-positive rate (normal sequence flagged at any point) | ≤ 0.05 | 0.00 |

When you change weights or thresholds, add any new pattern to the dataset
first, and keep the bar in the test and this table in sync.

## Known gaps

- `geo_velocity` and `payload_anomaly` are listed features but not
  implemented.
- History is kept in process memory per instance. An attacker spread across
  instances behind a load balancer is scored per instance.
- One API key used from many IPs at modest rates per IP is not detected.
