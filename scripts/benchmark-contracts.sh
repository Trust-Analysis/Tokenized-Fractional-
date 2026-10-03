#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPORT_FILE="${BENCHMARK_REPORT_FILE:-$ROOT_DIR/contract-benchmark-report.txt}"
MAX_CPU_INSTRUCTIONS="${MAX_CPU_INSTRUCTIONS:-0}"

cd "$ROOT_DIR/contracts"

cargo test --test resource_benchmarks -- --nocapture 2>&1 | tee "$REPORT_FILE"

if [[ "$MAX_CPU_INSTRUCTIONS" != 0 ]]; then
    max_observed=$(awk -F'cpu=' '/BENCHMARK / { split($2, value, " "); if (value[1] > max) max = value[1] } END { print max + 0 }' "$REPORT_FILE")
    if (( max_observed > MAX_CPU_INSTRUCTIONS )); then
        printf 'CPU budget exceeded: observed %s, limit %s\n' "$max_observed" "$MAX_CPU_INSTRUCTIONS" >&2
        exit 1
    fi
    printf 'CPU budget passed: observed %s, limit %s\n' "$max_observed" "$MAX_CPU_INSTRUCTIONS"
fi
