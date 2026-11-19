#!/usr/bin/env bash
# Rejects a deploy if any rendered Secret still carries a known placeholder
# value (e.g. from k8s/secrets.example.yaml being applied/copied verbatim).
#
# Usage:
#   kubectl kustomize k8s/overlays/<env> | k8s/scripts/check-secret-placeholders.sh
#   k8s/scripts/check-secret-placeholders.sh < rendered-manifests.yaml
#
# Exits non-zero and prints the offending line(s) if a placeholder is found.
set -euo pipefail

PLACEHOLDER_PATTERN='REPLACE_WITH_STRONG_RANDOM_KEY|REPLACE_WITH_YOUR_CONTRACT_ID|REPLACE_WITH_'

manifest="$(cat)"

if echo "$manifest" | grep -E "$PLACEHOLDER_PATTERN" > /tmp/placeholder-hits.$$; then
  echo "ERROR: rendered manifests contain unreplaced secret placeholder(s):" >&2
  cat /tmp/placeholder-hits.$$ >&2
  rm -f /tmp/placeholder-hits.$$
  echo "Provision real secrets (see k8s/README.md#secret-provisioning) before deploying." >&2
  exit 1
fi

rm -f /tmp/placeholder-hits.$$
echo "No placeholder secret values found."
