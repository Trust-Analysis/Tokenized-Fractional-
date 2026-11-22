# Prometheus Metrics & Grafana Monitoring Guide

This guide describes how to configure, scrape, secure, and visualize Prometheus metrics exposed by the Tokenized Fractional RWA Marketplace backend.

---

## 1. Overview & Architecture

The backend exposes telemetry on `GET /metrics` using `prom-client`. The metrics pipeline is built on open standards, compatible with any standard monitoring infrastructure including Prometheus, Grafana, VictoriaMetrics, Datadog, and AWS CloudWatch Agent.

```
┌─────────────────────────────────┐
│     RWA Marketplace Backend     │
│   (Express + prom-client)       │
│                                 │
│  - HTTP durations & errors      │
│  - Total assets & purchases     │
│  - WebSocket & DB pool gauges   │
│  - Node.js runtime metrics      │
└───────────────┬─────────────────┘
                │ GET /metrics
                │ (Bearer Token / Basic Auth / API Key)
                ▼
┌─────────────────────────────────┐
│           Prometheus            │
│   - Scrapes every 15s           │
│   - Evaluates alerts.yml (SLOs) │
└───────────────┬─────────────────┘
                │ PromQL
                ▼
┌─────────────────────────────────┐
│            Grafana              │
│   - Provisioned dashboards      │
│   - Operational & business KPIs │
└─────────────────────────────────┘
```

---

## 2. Metrics Catalog

### 2.1 Route & Request Performance (Golden Signals)

All route metrics are normalized (e.g. `/api/v1/rwa/:contractId`) to avoid high-cardinality explosions.

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests handled |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Latency distribution with buckets: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` |
| `http_request_errors_total` | Counter | `method`, `route`, `status_code` | Total failed HTTP requests (status $\ge$ 400) |

### 2.2 Marketplace Business Telemetry

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `rwa_total_assets` | Gauge | — | Total real-world assets registered on the platform |
| `rwa_assets_by_type` | Gauge | `asset_type` | Assets segmented by category (e.g. `real_estate`, `art`, `commodity`) |
| `rwa_purchases_total` | Gauge | — | Total completed share purchase transactions proxied through the backend |
| `rwa_purchase_volume_total` | Gauge | — | All-time USD / token purchase volume completed |
| `rwa_unique_buyers_total` | Gauge | — | Distinct buyer wallet addresses that completed purchases |
| `rwa_purchases_processed_total` | Counter | `status` | Real-time purchase processing count (`completed`, `failed`) |

### 2.3 System, WebSocket & Database Health

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `websocket_active_connections` | Gauge | — | Number of active WebSocket clients |
| `websocket_dlq_messages` | Gauge | `scope` | Messages buffered in dead-letter queue (`total`, `largest_channel`) |
| `websocket_dlq_over_threshold` | Gauge | — | Set to `1` when DLQ buffer exceeds alert threshold, else `0` |
| `db_pool_utilization_ratio` | Gauge | — | Knex connection pool utilization ratio ($0.0 \dots 1.0$) |
| `db_pool_connections` | Gauge | `state` | Connection pool breakdown (`used`, `free`, `pending`) |
| `disk_usage_ratio` | Gauge | — | Disk volume consumption ratio holding `data.json` |
| `disk_available_bytes` | Gauge | — | Available unprivileged writable disk space |
| `process_resident_memory_bytes` | Gauge | — | Memory resident set size (RSS) in bytes |
| `nodejs_eventloop_lag_seconds` | Gauge | — | Event loop latency in seconds |

---

## 3. Production Authentication & Security

In production (`NODE_ENV=production` or `METRICS_AUTH_REQUIRED=true`), `GET /metrics` is strictly protected by `metricsAuthMiddleware`.

### 3.1 Authentication Credentials

You can authenticate using any of the following methods:

1. **Bearer Token (`Authorization: Bearer <token>`)**:
   Matches `METRICS_BEARER_TOKEN`, `METRICS_TOKEN`, or `ADMIN_API_KEY`.
2. **HTTP Basic Auth (`Authorization: Basic <base64(user:password)>`)**:
   Matches `METRICS_USER` (default: `metrics` or `prometheus`) and `METRICS_PASSWORD` (or `ADMIN_API_KEY`).
3. **Admin API Key Header (`x-api-key: <key>`)**:
   Matches `METRICS_API_KEY`, `ADMIN_API_KEY`, or dynamic database-backed API keys.

All credential comparisons use constant-time operations (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

### 3.2 Testing Authentication with cURL

```bash
# 1. Bearer Token
curl -i -H "Authorization: Bearer $ADMIN_API_KEY" https://api.yourdomain.com/metrics

# 2. Basic Auth
curl -i -u "metrics:$ADMIN_API_KEY" https://api.yourdomain.com/metrics

# 3. API Key Header
curl -i -H "x-api-key: $ADMIN_API_KEY" https://api.yourdomain.com/metrics
```

If unauthorized, the server responds with:
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="Prometheus Metrics", Bearer realm="Prometheus Metrics"
Content-Type: application/json

{
  "status": 401,
  "error": "Unauthorized",
  "message": "Authentication required to access /metrics in production",
  "code": "METRICS_AUTHENTICATION_REQUIRED"
}
```

---

## 4. Scraping Setup (Prometheus)

### 4.1 Prometheus Configuration (`prometheus.yml`)

The repository includes a pre-configured `prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  scrape_timeout: 10s

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: 'rwa-backend'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['backend:3001']
        labels:
          service: 'rwa-marketplace-backend'
          environment: 'production'

    # Secure scraping authentication
    authorization:
      type: Bearer
      credentials: '${ADMIN_API_KEY}'
```

### 4.2 Cloud / Remote Prometheus Agents

For Prometheus running outside the container network, specify basic auth or custom bearer token:

```yaml
scrape_configs:
  - job_name: 'rwa-marketplace-production'
    metrics_path: '/metrics'
    scheme: 'https'
    static_configs:
      - targets: ['api.yourdomain.com:443']
    authorization:
      type: Bearer
      credentials_file: '/etc/prometheus/secrets/metrics-token'
```

---

## 5. Visualizing in Grafana

### 5.1 Pre-provisioned Dashboards

Grafana is provisioned out of the box in `docker-compose.yml`:
- **Datasource**: Configured in `grafana/datasources/datasources.yml` pointing to `http://prometheus:9090`.
- **Overview Dashboard**: Configured in `grafana/dashboards/rwa-overview.json`.

Access Grafana locally at `http://localhost:3000` (User: `admin`, Password: `admin`).

### 5.2 Useful PromQL Queries & Dashboard Panels

#### 1. Traffic (Requests per second)
```promql
sum(rate(http_requests_total[5m])) by (route, status_code)
```

#### 2. Error Rate Percentage
```promql
(sum(rate(http_request_errors_total[5m])) / sum(rate(http_requests_total[5m]))) * 100
```

#### 3. p95 and p99 Response Latency
```promql
# P99
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))

# P95
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
```

#### 4. Total Platform Assets
```promql
rwa_total_assets
```

#### 5. Total Purchases Proxied
```promql
rwa_purchases_total
```

#### 6. Total Purchase Volume
```promql
rwa_purchase_volume_total
```

#### 7. Active WebSockets
```promql
websocket_active_connections
```

#### 8. Database Connection Pool Saturation
```promql
db_pool_utilization_ratio * 100
```

---

## 6. SLO-Based Alerting Rules

Alerting rules are defined in `prometheus/alerts.yml`. These trigger alerts based on Service Level Objectives:

| Alert Name | Condition | Severity | Description |
| --- | --- | --- | --- |
| `HighHttpErrorRate` | Error rate > 1% for 5m | Warning | Elevating HTTP failure rate |
| `CriticalHttpErrorRate` | Error rate > 5% for 2m | Critical | Severe service degradation |
| `HighHttpLatencyP99` | P99 latency > 1.0s for 5m | Warning | Unacceptable API response latency |
| `DatabasePoolExhaustion` | Pool utilization > 85% for 5m | Warning | Potential database connection bottleneck |
| `DiskSpaceCritical` | Disk usage > 85% for 5m | Critical | Local storage volume near exhaustion |
| `WebSocketDLQThresholdExceeded` | DLQ over threshold for 3m | Warning | Disconnected clients failing to catch up |
| `BackendInstanceDown` | `up == 0` for 1m | Critical | Backend service is completely down |

---

## 7. Local Quickstart

To launch the full backend alongside Prometheus and Grafana:

```bash
# 1. Start backend, Postgres, Redis, Prometheus, and Grafana
docker compose --profile monitoring up -d

# 2. Verify endpoints
curl http://localhost:3001/health
curl http://localhost:9090/-/healthy
curl http://localhost:3000/api/health

# 3. View Prometheus targets
open http://localhost:9090/targets

# 4. View Grafana Dashboards
open http://localhost:3000
```
