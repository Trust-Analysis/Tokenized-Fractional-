# `elk/` — centralised log aggregation

This directory is the **log-aggregation strategy** for the platform: the ELK
stack (Elasticsearch + Logstash + Kibana) that collects the structured JSON logs
emitted by the backend and the nginx proxy, maps them to Elastic Common Schema
fields, and makes them searchable.

The backend side of the contract — log levels, `requestId`, and the redaction
rules that keep `ADMIN_API_KEY` and friends out of the index — is documented in
[../docs/OBSERVABILITY.md](../docs/OBSERVABILITY.md). Read that first: it
explains the record schema, the Kibana queries, and the alerting setup with
Sentry.

## Contents

| File | Role |
| --- | --- |
| `filebeat/filebeat.yml` | Discovers containers, decodes the JSON `message` field, ships to Logstash on `:5044`. |
| `logstash/pipeline/logstash.conf` | Parses nginx access logs and pino JSON into ECS fields, drops `/health` noise, writes to Elasticsearch. |
| `logstash/Dockerfile` | Image used to build the Logstash container. |
| `kibana/kibana.yml` | Points Kibana at Elasticsearch. |
| `elasticsearch/init.sh` | Creates the index template / lifecycle policy for `rwa-logs-*`. |

## Running it

```bash
docker compose --profile monitoring up -d elasticsearch logstash kibana filebeat
```

- Kibana — <http://localhost:5601> (data view `rwa-logs-*`)
- Elasticsearch — <http://localhost:9200>

Use the `elk` profile instead of `monitoring` when you only want the log
pipeline:

```bash
docker compose --profile elk up -d
```

The stack is optional. Without it the service still logs newline-delimited JSON
to stdout, which is what Render captures; the stack adds retention, search, and
dashboards. Metrics are a separate concern and live in `grafana/`.

## Notes

- Indices are `rwa-logs-%{+YYYY.MM.dd}` with a daily rollover. Retention is
  short by design — durable audit records belong in the audit log service, not in
  the operational log index.
- Do not add a human-readable formatter to the backend in production: the
  Logstash pipeline decodes the `message` field as JSON.
- Redaction happens in the application before serialisation. Never "fix" a
  missing field in the pipeline by forwarding raw headers.
