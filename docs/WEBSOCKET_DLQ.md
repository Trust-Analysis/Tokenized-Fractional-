# WebSocket dead-letter queue: retention and alerting

`backend/src/services/websocketDLQService.js` buffers every WebSocket broadcast
with a per-channel sequence number, so a client that reconnects with
`lastSeqId` can be replayed what it missed. It stores to Redis when `REDIS_URL`
is set and to process memory otherwise. Either way the buffer is per instance:
see `backend/websocketRedisAdapter.js` for what is shared across nodes.

## Retention policy

| Bound | Default | Env var | What happens when exceeded |
| --- | --- | --- | --- |
| Messages per channel | 1000 | `WS_DLQ_BUFFER_SIZE` | Oldest (lowest `seqId`) messages are dropped as new ones arrive. |
| Message age | 24 h | `WS_DLQ_TTL_SECONDS` | Older messages are never replayed, and are pruned on the next write to that channel. In Redis the whole `ws:dlq:<channel>` key also expires this long after its last write. |
| Delivery-failure log | last 1000 | — | Oldest entries are trimmed. Same TTL. |

The worst-case memory footprint is therefore `channels × WS_DLQ_BUFFER_SIZE ×
message size`. A client whose gap reaches beyond either bound is replayed only
what is still retained. It must refetch current state (e.g. over GraphQL)
rather than assume the replay is complete.

Drops are counted per reason (`size`, `age`) and exposed in `getStats()` and
the `websocket_dlq_dropped_messages` gauge.

## Metrics

Exposed on `GET /metrics` (computed once per scrape from `getStats()`):

| Metric | Meaning |
| --- | --- |
| `websocket_dlq_messages{scope="total"}` | Messages currently buffered across all channels |
| `websocket_dlq_messages{scope="largest_channel"}` | Size of the fullest channel (approaching `WS_DLQ_BUFFER_SIZE` means drops are imminent) |
| `websocket_dlq_channels` | Channels with buffered messages |
| `websocket_dlq_recent_delivery_failures` | Entries in the delivery-failure log |
| `websocket_dlq_dropped_messages{reason}` | Messages dropped by retention since process start |
| `websocket_dlq_over_threshold` | `1` while the total is at or above `WS_DLQ_ALERT_THRESHOLD` (default 10000) |

When the total first crosses `WS_DLQ_ALERT_THRESHOLD` the service also logs a
`warn` ("WebSocket DLQ size exceeded alert threshold"), which reaches the ELK
stack without Prometheus.

## Alert rules

A sudden rise in buffered messages or delivery failures means many clients are
failing to receive or reconnect at the same time. That usually points to a
network, load-balancer or deploy problem, not one bad client.

```yaml
- alert: WebSocketDLQOverThreshold
  expr: websocket_dlq_over_threshold == 1
  for: 10m
  labels: { severity: warning }
  annotations:
    summary: "WebSocket DLQ above WS_DLQ_ALERT_THRESHOLD on {{ $labels.instance }}"
- alert: WebSocketDLQGrowthSpike
  expr: delta(websocket_dlq_messages{scope="total"}[10m]) > 5000
  for: 5m
  labels: { severity: warning }
  annotations:
    summary: "WebSocket DLQ grew by >5000 messages in 10m; clients may be failing to reconnect"
- alert: WebSocketDeliveryFailures
  expr: delta(websocket_dlq_recent_delivery_failures[5m]) > 100
  labels: { severity: warning }
```

Response: check `websocket_active_connections` for a drop in connected
clients, recent deploys, and the `Broadcast delivery failure` log lines for
the affected channels.
