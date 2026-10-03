# Observability: structured logging, error tracking, and alerting

This document is the reference for how the backend service is observed in
production. It covers the three pieces referenced by issue #703:

1. the **structured logger** (`backend/logger.js`) — levels, request IDs, redaction;
2. the **error-tracking / alerting** service (`backend/src/services/errorTracking.js`) — Sentry;
3. the **log-aggregation strategy** — the ELK stack in `elk/`, which is where
   the JSON logs are stored, searched, and charted.

Together they replace "tail the Render dashboard and hope": logs are queryable
and retained, and an error spike pages somebody.

---

## 1. Structured logging

### Where it lives

| Concern | Module |
| --- | --- |
| Canonical logger instance | `backend/logger.js` |
| Re-export used by `src/` modules | `backend/src/services/logger.js` |
| Request ID / correlation ID context | `backend/logger.js` (`runWithRequestContext`) |
| Error tracking | `backend/src/services/errorTracking.js` |

Every module logs through the single pino instance exported by
`backend/logger.js`, so the output is machine-parseable from the first line to
the last.

> **Convention:** new code imports `logger` from `backend/logger.js` and does not
> call `console.*`. A handful of older modules still do
> (`src/services/rwa.js`, `database.js`, `statements.js`, `indexingEngine.js`,
> `readReplica.js`, `connection.js`, `pre-compression.js`,
> `SettlementWorker.js`, `subscriptionOptimizer.js`, `tracingConfig.js`) — those
> lines reach the container log as plain text and are not structured. They are
> tracked as follow-up work, not by this change.

```js
import { logger } from './logger.js';

logger.info({ contractId }, 'Asset created');
logger.error({ err }, 'Failed to sync search index');
```

Pass the caught error as `err` (not `error: err.message`): pino's standard
error serializer then emits the type, message, stack, and any extra properties,
which is what makes a line actionable.

### Log levels

| Level | Use for |
| --- | --- |
| `trace` | Very fine-grained diagnostics (disabled in production) |
| `debug` | Developer detail: cache hits, query timings, branch decisions |
| `info` | Business events: startup, asset created, webhook fired, health of a dependency |
| `warn` | Recovered anomalies: rate limit tripped, webhook auto-disabled, Redis unavailable |
| `error` | A request or job failed |
| `fatal` | The process cannot continue |
| `silent` | Nothing is emitted (default under `NODE_ENV=test`) |

The threshold comes from `LOG_LEVEL`. An unrecognised value falls back to
`info` (`silent` in tests) rather than failing to boot.

```bash
LOG_LEVEL=debug   # local troubleshooting
LOG_LEVEL=info    # production default
```

The numeric `level` field (10…60) is written to the log record, which is what
the Kibana queries in section 3 filter on.

### Request IDs

Every response carries `X-Request-ID`. When the caller does not supply one, the
service generates a UUID. The same value is bound to the async context of the
request, so **every** log line produced while handling it — including from
services, cache helpers, and fire-and-forget promises such as webhook delivery
— includes:

```json
{ "level": 30, "time": "2026-09-27T10:15:04.221Z", "requestId": "0f1c…", "msg": "Asset created" }
```

Services that talk to each other should forward `X-Request-ID` and, when they
also carry a business correlation, `X-Correlation-ID`. `correlationIdMiddleware`
(`src/middleware/correlationId.js`) adds the second, and both identifiers are
injected into the log record by the same context.

To trace a single request across the platform:

```bash
docker compose --profile monitoring logs -f logstash | grep '"requestId":"0f1c…"'
```

### Record schema

Emitted by `logger.js` on **every** line:

| Field | Example | Notes |
| --- | --- | --- |
| `level` | `30` | pino numeric level |
| `time` | `2026-09-27T10:15:04.221Z` | ISO-8601, UTC |
| `pid` | `41822` | process id |
| `hostname` | `rwa-backend-blue-abc123` | container / host |
| `service` | `backend-blue` | from `SERVICE_NAME` |
| `environment` | `production` | from `NODE_ENV` |
| `deploymentColor` | `blue` | from `DEPLOYMENT_COLOR` (blue/green) |
| `buildId` | `9f1c2ab` | from `BUILD_ID` / `GITHUB_SHA` |
| `requestId` | `0f1c…` | present inside a request |
| `correlationId` | `0f1c…` | present when correlation middleware ran |
| `msg` | `Asset created` | human-readable event name |

Added by `pino-http` for request/response lines: `req` (method, url, remote
address, headers), `res` (statusCode), `responseTime` (ms).
Added by pino's error serializer for `err`: `type`, `message`, `stack`.

### Redaction — secrets are never logged

`ADMIN_API_KEY` and its peers must not reach the log stream, the ELK cluster, or
Sentry. Redaction happens in three independent layers, so a mistake in one place
is not enough to leak a credential:

1. **Path redaction (pino/fast-redact).** `req.headers["x-api-key"]`,
   `req.headers.authorization`, `req.headers.cookie`, `req.body.password`,
   `res.headers["set-cookie"]`, `error.config.headers`, and the same paths under
   a child binding, are replaced with `[REDACTED]` before serialisation. This is
   what protects the `req`/`res` objects handed to `pino-http`, which cannot be
   deep-walked as plain objects.
2. **Key-based redaction (`hooks.logMethod`).** Any key whose name looks like a
   credential — `password`, `secret`, `token`, `apiKey` / `api_key` /
   `x-api-key`, `authorization`, `privateKey`, `credential`, `cookie`,
   `sessionId`, `seedPhrase`, `mnemonic`, `pin`, `cvv` — has its value replaced
   at any nesting depth, and every string in the payload is scanned for secret
   values.
3. **Output-stream scrubbing.** The final newline-delimited JSON is passed
   through a scrubbing stream that masks the literal values of the environment
   variables in `secretEnvKeys()` — the documented set (`ADMIN_API_KEY`,
   `API_KEY`, `DATABASE_URL`, `DB_PASSWORD`, `JWT_SECRET`, `SENTRY_DSN`,
   `SOLANA_RPC_URL`, `WALLET_PRIVATE_KEY`, `WEBHOOK_SECRET`) plus any variable
   whose name looks like a secret (`passw`, `secret`, `token`, `api_key`,
   `private_key`, `mnemonic`, `seed`, `credential`, `dsn`, `encryption`) — and
   the `user:password@` portion of any URL. This catches the careless case
   — `logger.info('using key ' + process.env.ADMIN_API_KEY)`.

`beforeSend` in `src/services/errorTracking.js` applies the same rules to Sentry
events, and `sendDefaultPii` is disabled, so request bodies, cookies, and IP
addresses are not attached to error reports.

Verify the guarantee:

```bash
LOG_LEVEL=debug node -e "
  const { logger } = await import('./logger.js');
  logger.info({ apiKey: process.env.ADMIN_API_KEY }, 'probe');
" --input-type=module
# => {"level":30,...,"apiKey":"[REDACTED]","msg":"probe"}
```

Note that `backend/env.js` prints configuration problems to `console.error`
before the logger is configured, because it runs at import time and validates
required variables. It only ever prints the **name**, description, and the
invalid format of a variable — never its value.

---

## 2. Error tracking and alerting (Sentry)

Sentry is the alerting half: the logs say *what* happened, Sentry says *how
often*, *for whom*, and *who gets woken up*. It is entirely optional — with no
`SENTRY_DSN` configured, every function in `src/services/errorTracking.js` is a
no-op and the service runs with logging only (this is also the case under
`NODE_ENV=test`, so the test suite never contacts Sentry).

### Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SENTRY_DSN` | yes | — | Ingest DSN. Enables tracking. |
| `SENTRY_ENVIRONMENT` | no | `NODE_ENV` | Environment shown in the Sentry UI. |
| `SENTRY_RELEASE` | no | `GITHUB_SHA` | Release, so regressions can be bisected. |
| `SENTRY_TRACES_SAMPLE_RATE` | no | `0.1` | Performance monitoring sample rate (0–1). |
| `SENTRY_PROFILES_SAMPLE_RATE` | no | `0.1` | Profiling sample rate (0–1). |
| `SENTRY_AUTH_TOKEN` | no | — | Only for source-map upload (`sentry-cli`), never sent by the service. |

On Render, set `SENTRY_DSN` on both colour services (dashboard or
`render.yaml`); `SENTRY_RELEASE` should be the deploy commit SHA.

### What is reported

- Every error that reaches the Express error pipeline with status ≥ 500 is
  captured, tagged with `requestId`, `http.method`, `service`, and a request
  context (`src/app.js`, `index.js`). 4xx responses are client errors, not
  incidents, and are logged only — reporting them would bury the real signal.
- Startup and background failures (database init, Apollo/GraphQL bootstrap, the
  hourly materialized-view refresh) are reported through `reportError()`.
- Outbound HTTP calls are followed as Sentry breadcrumbs, so an error shows the
  Redis/GraphQL/RPC call that preceded it.

At startup the service logs a single line stating whether tracking is on, which
is the quickest way to confirm the DSN reached the container:

```json
{"level":30,"errorTracking":{"enabled":true,"environment":"production","release":"9f1c2ab"},"dsnHost":"o0.ingest.sentry.io","msg":"Sentry error tracking enabled"}
```

Note the DSN *host* is logged, never the DSN.

### Recommended alerts

Set these up in the Sentry project so that an error spike notifies someone
without a human watching the dashboard:

| Alert | Condition | Meaning |
| --- | --- | --- |
| New issue | `level = error`, first seen | Something is broken in a new way. |
| Error spike | > 50 events in 10 min | Volume problem (bad deploy, dependency down). |
| Regressed issue | Issue reappears after resolve | Fix did not hold. |
| Health-check noise | Filter out `/health` | Already applied by `beforeSend`. |

---

## 3. Log aggregation — the `elk/` stack

`elk/` is the log-aggregation strategy for this repository. It is the ELK
(Elasticsearch, Logstash, Kibana) stack shipped in `docker-compose.yml` under
the `monitoring` / `elk` profiles. Nothing else is required: the backend emits
newline-delimited JSON on stdout, which is the format the pipeline already
expects.

```
  backend container (pino JSON on stdout)
        │  docker json-file logs
        ▼
  filebeat   elk/filebeat/filebeat.yml   — container autodiscovery + decode_json_fields
        │  beats :5044
        ▼
  logstash   elk/logstash/pipeline/logstash.conf
        │  ECS field mapping (log.level, http.request.method, url.original, …)
        ▼
  elasticsearch   index rwa-logs-%{+YYYY.MM.dd}
        │
        ▼
  kibana :5601   — dashboards, saved searches, alerts
```

### Start the stack

```bash
docker compose --profile monitoring up -d elasticsearch logstash kibana filebeat
# Kibana:  http://localhost:5601
# Elasticsearch: http://localhost:9200
```

Add `--profile elk` instead of `monitoring` if you only want the log pipeline and
not Prometheus/Grafana.

### What the pipeline does to backend lines

`elk/logstash/pipeline/logstash.conf` maps pino fields onto Elastic Common
Schema fields, which is why the field names in the schema table above line up
with Kibana queries:

| pino field | ECS destination |
| --- | --- |
| `level` (numeric) | `log.level` |
| `msg` | `message` |
| `req.method` | `http.request.method` |
| `req.url` | `url.original` |
| `res.statusCode` | `http.response.status_code` |
| `responseTime` | `http.response.response_time_ms` |
| `err` | `error` |
| container name | `service.name`, `event.dataset` |
| everything else (`requestId`, `service`, `environment`, …) | `json.*` |

Lines are additionally tagged `backend_log` (or `sentry_log` for Sentry's own
output), `/health` noise is dropped, and nginx access logs are parsed into the
same index so API and proxy logs can be correlated in one place.

Note that `service.name` in Kibana is the **container** name set by Logstash
(`backend-blue`), not the `service` field of the log record; the record's own
value is at `json.service`.

The index name is `rwa-logs-<date>` with a daily rollover. `elk/elasticsearch/init.sh`
creates the lifecycle policy; retention is intentionally short, because the logs
are an operational record rather than a long-term archive — anything that must be
kept for longer belongs in the audit log (`src/services/auditLogService.js`) or
in the database.

### Useful Kibana queries

Data view: `rwa-logs-*`.

Filebeat decodes the pino line into the `json.*` subtree, so the fields that have
no ECS mapping of their own — including the request identifiers — are queried
with the `json.` prefix.

```
# All errors from the blue deployment in the last 15 minutes
service.name : "backend-blue" and log.level : "50" and @timestamp > now-15m

# Trace one request end to end (paste the X-Request-ID the client received)
json.requestId : "0f1c2d3e-…"

# Slow requests
http.response.response_time_ms > 1000

# Error ratio for a route
http.request.method : "POST" and url.original : "/api/rwa"

# Rate-limit rejections
message : "Request rate limited"

# Confirm redaction is working (should return nothing)
json.apiKey : * or json.password : * or json.authorization : *
```

The last query is worth keeping as a saved search, or turning into a Kibana
alert, so that a future refactor cannot quietly start writing credentials to the
cluster.

---

## 4. Metrics (complementary, not a substitute)

Prometheus metrics are exposed on `GET /metrics`
(`src/services/metricsService.js`): `http_request_duration_seconds`,
`http_requests_total`, `http_request_errors_total`,
`websocket_active_connections`, `db_pool_*`. They answer "is the service
healthy" at a glance and are the right signal for autoscaling; logs answer "why
did this particular request fail". Grafana dashboards live in `grafana/`.

---

## 5. On Render (production)

Render captures stdout/stderr per service, so a deploy works with logging alone
if ELK is not running. To get aggregation and alerting:

1. **Logs.** Set `LOG_LEVEL=info`. Optionally forward Render's log stream to
   your aggregator of choice, or run the ELK stack on a host that can reach the
   container logs. Keep the JSON format — do not add a human-readable formatter
   in production, or queries stop working.
2. **Alerts.** Set `SENTRY_DSN` (and `SENTRY_RELEASE` to the commit SHA) on both
   colour services in the Render dashboard, then create the alerts from the table
   in section 2. Health checks already generate a lot of traffic and are
   excluded from Sentry.
3. **Triage flow.** Alert fires → open the Sentry issue → copy the `requestId`
   tag → search that value in Kibana (or Render's log search) for the full
   request lifecycle → identify the failing dependency from the breadcrumbs.

## 6. Onboarding checklist for a new module

- [ ] Import `logger` from `backend/logger.js`; do not create a second logger.
- [ ] Do not use `console.*` in request paths.
- [ ] Log the caught error as `err` so the stack trace is preserved.
- [ ] Pick the level from the table in section 1 — `error` is for failures, not
      for interesting events.
- [ ] Never pass a secret, token, cookie, or whole `req.headers` in the payload.
      Redaction is a safety net, not a licence.
- [ ] If the module can fail in a way an operator must be paged about, report it
      with `reportError()` / `captureException()` from
      `src/services/errorTracking.js` rather than only logging it.
