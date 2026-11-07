#!/bin/sh
# Initialize Elasticsearch ILM policy and index template for RWA logs.
# Run this once after Elasticsearch is healthy:
#   docker compose exec elasticsearch /usr/share/elasticsearch/init.sh

set -e

ES_URL="${ES_URL:-http://localhost:9200}"

echo "=== Creating ILM policy: rwa-logs-policy ==="
curl -sS -X PUT "$ES_URL/_ilm/policy/rwa-logs-policy" \
  -H "Content-Type: application/json" \
  -d '{
    "policy": {
      "phases": {
        "hot": {
          "min_age": "0ms",
          "actions": {
            "set_priority": { "priority": 100 }
          }
        },
        "warm": {
          "min_age": "7d",
          "actions": {
            "forcemerge": { "max_num_segments": 1 },
            "shrink": { "number_of_shards": 1 },
            "allocate": { "number_of_replicas": 1 },
            "set_priority": { "priority": 50 }
          }
        },
        "cold": {
          "min_age": "30d",
          "actions": {
            "allocate": {
              "number_of_replicas": 0
            },
            "set_priority": { "priority": 0 }
          }
        },
        "delete": {
          "min_age": "90d",
          "actions": {
            "delete": { }
          }
        }
      }
    }
  }'

echo ""
echo "=== Creating index template: rwa-logs-template ==="
curl -sS -X PUT "$ES_URL/_index_template/rwa-logs-template" \
  -H "Content-Type: application/json" \
  -d '{
    "index_patterns": ["rwa-logs-*"],
    "template": {
      "settings": {
        "number_of_shards": 1,
        "number_of_replicas": 1,
        "index.lifecycle.name": "rwa-logs-policy"
      },
      "mappings": {
        "dynamic_templates": [
          {
            "strings_as_keyword": {
              "match_mapping_type": "string",
              "mapping": { "type": "keyword" }
            }
          }
        ],
        "properties": {
          "@timestamp":    { "type": "date" },
          "message":       { "type": "text" },
          "log.level":     { "type": "keyword" },
          "http.response.status_code": { "type": "integer" },
          "http.response.bytes":       { "type": "long" },
          "http.response.response_time_ms": { "type": "float" },
          "url.original":  { "type": "keyword" },
          "event.dataset": { "type": "keyword" },
          "service.name":  { "type": "keyword" },
          "service.type":  { "type": "keyword" },
          "docker.container.id":    { "type": "keyword" },
          "docker.container.name":  { "type": "keyword" },
          "docker.container.image": { "type": "keyword" },
          "host.name":     { "type": "keyword" },
          "error.message": { "type": "text" },
          "transaction.id": { "type": "keyword" },
          "trace.id":      { "type": "keyword" }
        }
      }
    }
  }'

echo ""
echo "=== Done. ILM policy and index template created. ==="
