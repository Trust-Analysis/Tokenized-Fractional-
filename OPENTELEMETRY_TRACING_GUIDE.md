# OpenTelemetry Distributed Tracing Implementation Guide

## Overview

Comprehensive distributed tracing has been added to the RWA Marketplace backend using OpenTelemetry. This enables tracing of single requests across:
- Express middleware stack
- GraphQL resolvers  
- Database queries (PostgreSQL, Redis)
- External HTTP calls (Soroban RPC, webhooks, external APIs)
- Service boundaries

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Request                         │
└────────────────┬──────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Express Request Middleware                     │
│  • Root span created with trace ID and span ID             │
│  • Request headers, method, path captured                  │
│  • Response status and duration tracked                    │
└────────────────┬──────────────────────────────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐
│GraphQL │  │Database│  │  HTTP  │
│Resolv. │  │Queries │  │ Calls  │
└────────┘  └────────┘  └────────┘
    │            │            │
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐
│Soroban │  │PostGres│  │Webhooks│
│  RPC   │  │ Redis  │  │External│
└────────┘  └────────┘  └────────┘
                 │
                 ▼
          ┌─────────────┐
          │   Span      │
          │  Processor  │
          └──────┬──────┘
                 │
      ┌──────────┼──────────┐
      │          │          │
      ▼          ▼          ▼
   OTLP      Jaeger     Console
  (HTTP)    (Agent)     (Dev Only)
      │          │          │
      └──────────┼──────────┘
                 │
                 ▼
         ┌───────────────┐
         │   Collector   │
         │  (Optional)   │
         └───────┬───────┘
                 │
      ┌──────────┼──────────┐
      │          │          │
      ▼          ▼          ▼
  Jaeger     Grafana     Datadog
 (Tracing)   (Traces)   (APM)
```

## Files Created

### Core Tracing Infrastructure
- **`src/tracing/tracingConfig.js`** (304 lines)
  - OpenTelemetry initialization
  - Trace and metric provider setup
  - Exporter configuration (OTLP, Jaeger)
  - Helper functions for creating spans

### Express Middleware Tracing  
- **`src/tracing/expressTracing.js`** (257 lines)
  - Request/response tracing middleware
  - GraphQL-specific tracing
  - Authentication context tracing
  - Route handler span creation

### Database Tracing
- **`src/tracing/databaseTracing.js`** (308 lines)
  - PostgreSQL query wrapping
  - Redis operation tracing
  - Knex query builder integration
  - Batch operation tracing
  - SQL statement parsing and masking

### HTTP Client Tracing
- **`src/tracing/httpClientTracing.js`** (402 lines)
  - Fetch/HTTP request tracing
  - Soroban RPC call tracing
  - Webhook delivery tracing with retry logic
  - External API calls
  - Batch HTTP requests
  - URL masking for security

### GraphQL Tracing
- **`src/tracing/graphqlTracing.js`** (41 lines)
  - GraphQL resolver tracing
  - Field resolution duration tracking

## Installation

### 1. Install OpenTelemetry Dependencies

```bash
npm install \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-metrics \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/instrumentation \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-jaeger-basic \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-express \
  @opentelemetry/instrumentation-pg \
  @opentelemetry/instrumentation-redis-4
```

### 2. Initialize Tracing in Your Application

Add to your main `index.js` or `src/server.js` at the very start:

```javascript
// MUST be before any other imports
import { initializeTracing } from './src/tracing/tracingConfig.js';
initializeTracing();

// Then import your application
import { app } from './src/app.js';
```

### 3. Add Tracing Middleware to Express

```javascript
import { createTracingMiddleware, createGraphQLTracing } from './src/tracing/expressTracing.js';

// Add very early in middleware stack (before routes)
app.use(createTracingMiddleware());

// For GraphQL endpoints
app.use('/graphql', createGraphQLTracing());
```

### 4. Wrap Database Operations

```javascript
import { wrapPostgresQuery, withDatabaseTrace } from './src/tracing/databaseTracing.js';

// For Knex queries
const query = knex('users').select('*');
// Tracing is automatic via instrumentation

// For custom operations
const result = await withDatabaseTrace('getUserById', async () => {
  return db.query('SELECT * FROM users WHERE id = $1', [userId]);
})();
```

### 5. Trace HTTP Calls

```javascript
import { traceSorobanRpc, traceWebhookDelivery } from './src/tracing/httpClientTracing.js';

// Soroban RPC calls
const result = await traceSorobanRpc('getTxStatus', [txHash], sorobanRpc);

// Webhook deliveries
await traceWebhookDelivery(webhookUrl, payload, async () => {
  return fetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) });
});
```

## Configuration

### Environment Variables

```bash
# Enable/disable tracing
OTEL_ENABLED=true

# Exporter type: "otlp" or "jaeger"
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp

# OTLP Configuration
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_HEADERS={"key":"value"}

# Jaeger Configuration (if using Jaeger exporter)
OTEL_JAEGER_AGENT_HOST=localhost
OTEL_JAEGER_AGENT_PORT=6831

# Service metadata
OTEL_SERVICE_NAME=rwa-marketplace-backend
NODE_ENV=production

# Sampling
OTEL_SAMPLE_RATE=0.1  # 10% of traces

# Disable metrics if not needed
OTEL_METRICS_DISABLED=false
```

### Local Development Setup (Docker Compose)

```yaml
version: '3.8'

services:
  # Jaeger all-in-one
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "6831:6831/udp"  # Agent
      - "16686:16686"    # UI (http://localhost:16686)

  # OpenTelemetry Collector (optional, for advanced routing)
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otel-collector-config.yaml"]
    ports:
      - "4318:4318"     # OTLP HTTP receiver
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml

  # Backend with tracing
  backend:
    build: .
    environment:
      OTEL_ENABLED: "true"
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318"
      OTEL_SERVICE_NAME: "rwa-marketplace-backend"
      OTEL_SAMPLE_RATE: "1.0"  # 100% in dev
    ports:
      - "3001:3001"
    depends_on:
      - otel-collector
      - jaeger
```

## Usage Examples

### Example 1: GraphQL Query Tracing

```
GET /graphql

Query:
  query GetAsset($id: ID!) {
    asset(id: $id) {
      id
      title
      priceHistory {
        date
        price
      }
    }
  }

Trace breakdown:
├─ graphql.query.GetAsset (10ms)
│  ├─ db.select.assets (3ms)
│  ├─ graphql.resolve.asset (2ms)
│  └─ db.select.prices (5ms)
└─ http.duration: 10ms
```

### Example 2: Webhook Delivery with Retry Tracing

```
Trace ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890

webhook.delivery (3500ms)
├─ webhook.attempt 1 (1000ms) → timeout
├─ webhook.attempt 2 (1500ms) → error
└─ webhook.attempt 3 (1ms) → success

Events:
- webhook.attempt_1: timeout
- webhook.attempt_2: error (connection refused)
- webhook.attempt_3: success
```

### Example 3: Soroban RPC Call Tracing

```
soroban.getTxStatus (450ms)
├─ attributes:
│  - rpc.method: getTxStatus
│  - rpc.duration_ms: 450
│  - blockchain.network: testnet
│  - rpc.success: true
└─ events:
   - rpc_success (method: getTxStatus, duration: 450ms)
```

### Example 4: Database Query with Error Tracing

```
db.select.users (75ms)
├─ attributes:
│  - db.system: postgres
│  - db.statement: SELECT * FROM users WHERE...
│  - db.rows_affected: 42
│  - db.success: true
└─ events:
   - db_query_success (rows: 42, duration: 75ms)
```

## Viewing Traces

### Jaeger UI

1. Start Jaeger: `docker run -p 16686:16686 jaegertracing/all-in-one`
2. Open http://localhost:16686
3. Select service "rwa-marketplace-backend"
4. View traces and spans

### Trace Analysis

**Key Metrics to Monitor:**
- Request duration (p50, p95, p99)
- Database query duration
- GraphQL resolver latency
- External API call duration
- Webhook delivery attempts
- Error rates by operation

### Finding Performance Bottlenecks

1. Open Jaeger UI
2. Find slow traces (sort by duration)
3. Expand spans to find slow component
4. Check span attributes and events
5. Correlate with logs (trace ID in logs)

## Performance Impact

- **Tracing overhead**: ~5-10% CPU increase
- **Memory**: ~20-50MB additional
- **Network**: Configurable batching (default 512 spans per batch)
- **Sampling**: Reduce load with 0.1 (10%) sampling in production

## Security Considerations

- **SQL statement masking**: Sensitive data masked in queries
- **URL masking**: API keys and credentials removed from URLs
- **Sensitive keys**: Redis keys with 'token', 'password' masked
- **PII**: User emails and IDs may appear in traces—ensure OTLP endpoint is secure

## Troubleshooting

### Traces not appearing in Jaeger

1. Check OTEL_ENABLED=true
2. Verify OTEL_EXPORTER_OTLP_ENDPOINT is reachable
3. Check logs for "[OTEL]" prefix messages
4. Ensure tracing is initialized before other imports

### High memory usage

- Reduce OTEL_SAMPLE_RATE to 0.01 (1%)
- Batch processor is already optimized (512 spans)
- Check for span leaks (spans not ending)

### Missing spans for specific operations

- Ensure operation is wrapped with appropriate tracing function
- Check if operation is async and if context is propagated
- Verify instrumentation is enabled for the library

### Performance degradation

- Lower sampling rate (OTEL_SAMPLE_RATE)
- Use async batch processor (already default)
- Disable metrics if not needed (OTEL_METRICS_DISABLED=true)

## Advanced Usage

### Custom Spans

```javascript
import { getTracer } from './src/tracing/tracingConfig.js';

const tracer = getTracer();
const span = tracer.startSpan('custom-operation', {
  attributes: {
    'custom.field': 'value',
  },
});

try {
  // Do work
} finally {
  span.end();
}
```

### Span Context Propagation

```javascript
import { trace, context } from '@opentelemetry/api';

context.with(trace.setSpan(context.active(), span), () => {
  // All operations here are within the span
  doWork();
});
```

### Accessing Trace ID in Logs

```javascript
import { getTraceId, getSpanId } from './src/tracing/tracingConfig.js';

logger.info({
  traceId: getTraceId(),
  spanId: getSpanId(),
  message: 'User action',
});
```

## Integration with Existing Systems

### With Sentry

Traces are compatible with Sentry's tracing feature. Ensure both are enabled for rich context.

### With Prometheus

OpenTelemetry metrics complement existing Prometheus metrics.

### With ELK Stack

Export OTLP traces to Elasticsearch for centralized observability.

## Production Checklist

- [ ] OTEL_ENABLED=true
- [ ] OTEL_SAMPLE_RATE set appropriately (0.01-0.1 for prod)
- [ ] OTEL_EXPORTER_OTLP_ENDPOINT configured
- [ ] OTLP collector running and accessible
- [ ] Jaeger or backend ready to receive traces
- [ ] Network firewall allows OTLP port (4318)
- [ ] Sensitive data masking verified
- [ ] Memory and CPU overhead acceptable
- [ ] Logs include trace IDs for correlation

## References

- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
- [Jaeger UI](https://www.jaegertracing.io/)
- [OTLP Specification](https://opentelemetry.io/docs/reference/protocol/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

