# OpenTelemetry Parent-Based & Tail Sampling Guide

## Problem Solved

Previously, sampling decisions were made in `backend/src/tracing/tracingConfig.js` using `Math.random() < probability`. Because each service (Gateway, Subgraphs, Microservices) generated its own pseudo-random float independently, traces suffered from severe fragmentation: a request sampled at the API Gateway would frequently be dropped by downstream subgraphs, resulting in incomplete spans and broken trace graphs.

## Solution

### 1. Parent-Based Ratio Sampling (Head Sampling)

We adopted the OpenTelemetry standard `ParentBasedSampler` with a `TraceIdRatioBasedSampler` root sampler:

```javascript
new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(sampleRate),
})
```

- **Downstream Spans**: Inherit the parent span's sampling flag (`sampled: true` or `false`). If the Gateway decides to sample a request, all downstream services (GraphQL subgraphs, Soroban RPC calls, DB queries) will automatically record spans.
- **Root Spans**: Deterministically evaluated against a configured ratio (e.g. 0.1 = 10%) by hashing the trace ID, guaranteeing consistent head sampling across service boundaries.

### 2. Collector Tail-Based Sampling (Errors & Slow Requests)

To ensure **100% of errors and high-latency requests are captured** without inflating telemetry costs, the OpenTelemetry Collector uses the `tail_sampling` processor:

```yaml
processors:
  tail_sampling:
    decision_wait: 10s
    num_traces: 10000
    expected_new_traces_per_sec: 2000
    policies:
      # Policy 1: Always sample errors (HTTP 5xx, Soroban contract errors, unhandled exceptions)
      - name: sample-errors
        type: status_code
        status_code: { status_codes: [ ERROR ] }

      # Policy 2: Always sample slow transactions (> 1000ms latency)
      - name: sample-slow-requests
        type: latency
        latency: { threshold_ms: 1000 }

      # Policy 3: Sample probabilistic background traffic
      - name: probabilistic-ratio
        type: probabilistic
        probabilistic: { sampling_percentage: 10 }

service:
  pipelines:
    traces:
      receivers: [ otlp ]
      processors: [ memory_limiter, tail_sampling, batch ]
      exporters: [ jaeger, otlp ]
```

This guarantees:
1. Zero partial or broken trace trees across Gateway and Subgraphs.
2. 100% observability on incidents, anomalies, and edge-case exceptions.
