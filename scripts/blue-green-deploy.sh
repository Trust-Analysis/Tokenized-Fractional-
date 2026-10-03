#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="$ROOT_DIR/.blue-green-state.json"
ACTIVE_COLOR="${ACTIVE_COLOR:-blue}"
TARGET_COLOR="${TARGET_COLOR:-green}"
HEALTH_URL="${HEALTH_URL:-}"
ROLLBACK="${ROLLBACK:-false}"

if [[ -z "$HEALTH_URL" ]]; then
  echo "HEALTH_URL must be set to the target environment health endpoint" >&2
  exit 1
fi

if [[ ! -f "$STATE_FILE" ]]; then
  echo '{"active":"blue"}' > "$STATE_FILE"
fi

if [[ "$ROLLBACK" == "true" ]]; then
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No deployment state found for rollback" >&2
    exit 1
  fi
  ACTIVE_COLOR="$(node -e 'const fs=require("fs"); const p=process.argv[1]; if (fs.existsSync(p)) { try { const data=JSON.parse(fs.readFileSync(p, "utf8")); process.stdout.write(data.active || "blue"); } catch { process.stdout.write("blue"); } } else { process.stdout.write("blue"); }' "$STATE_FILE")"
  TARGET_COLOR="$ACTIVE_COLOR"
  echo "Rolling back active deployment: $ACTIVE_COLOR"
fi

if [[ "$ACTIVE_COLOR" == "$TARGET_COLOR" ]]; then
  echo "Target color matches active color; no switch needed"
  exit 0
fi

mkdir -p "$ROOT_DIR/.tmp"

health_check() {
  local url="$1"
  curl --fail --silent --show-error --max-time 20 "$url" >/dev/null
}

if ! health_check "$HEALTH_URL"; then
  echo "Initial health check failed for $HEALTH_URL" >&2
  exit 1
fi

echo "Deploying to $TARGET_COLOR"

for attempt in {1..3}; do
  if health_check "$HEALTH_URL"; then
    echo "Health checks passed for $TARGET_COLOR"
    break
  fi
  echo "Health check attempt $attempt failed; retrying" >&2
  sleep 5
  if [[ "$attempt" -eq 3 ]]; then
    echo "Target environment did not become healthy" >&2
    exit 1
  fi
done

node -e 'const fs=require("fs"); const statePath=process.argv[1]; const newColor=process.argv[2]; fs.writeFileSync(statePath, JSON.stringify({ active: newColor }, null, 2));' "$STATE_FILE" "$TARGET_COLOR"

echo "Blue-green switch complete. Active color: $TARGET_COLOR"
