#!/usr/bin/env bash
# branch-protection.sh — apply or verify the main-branch protection policy (issue #798).
#
# Branch protection is a repository setting, not a file, so it drifts silently:
# a maintainer toggling it off in the UI leaves no trace in git. This script
# makes the desired state reviewable (in .github/branch-protection.json) and
# both applicable and checkable from the command line.
#
# Usage:
#   scripts/branch-protection.sh apply    # PUT the policy from the JSON file
#   scripts/branch-protection.sh check    # GET and assert the policy is in force
#
# Environment:
#   REPO         owner/name (default: the current gh repo)
#   BRANCH       branch to protect (default: main)
#   POLICY_FILE  desired state (default: .github/branch-protection.json)
#
# Requires the `gh` CLI, authenticated with a token that has admin access to the
# repository. Reading protection requires admin read; applying requires admin
# write. `check` exits non-zero when any required setting is missing, so it can
# be wired into a scheduled workflow once an admin-scoped token is available.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
POLICY_FILE="${POLICY_FILE:-$ROOT_DIR/.github/branch-protection.json}"
BRANCH="${BRANCH:-main}"
REPO="${REPO:-}"
MODE="${1:-check}"

if ! command -v gh >/dev/null 2>&1; then
  echo "branch-protection: the gh CLI is required" >&2
  exit 1
fi

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

case "$MODE" in
  apply)
    if [[ ! -f "$POLICY_FILE" ]]; then
      echo "branch-protection: policy file not found: $POLICY_FILE" >&2
      exit 1
    fi
    echo "branch-protection: applying $POLICY_FILE to $REPO:$BRANCH"
    gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
      -H "Accept: application/vnd.github+json" \
      --input "$POLICY_FILE" >/dev/null
    echo "branch-protection: applied. Verifying..."
    exec "$0" check
    ;;
  check)
    protection="$(gh api "repos/$REPO/branches/$BRANCH/protection" 2>/dev/null || true)"
    if [[ -z "$protection" ]]; then
      echo "branch-protection: $BRANCH is NOT protected (or the token cannot read protection)." >&2
      exit 1
    fi

    failures=0
    pass() { printf '  ok    %s\n' "$1"; }
    fail() { printf '  FAIL  %s\n' "$1" >&2; failures=$((failures + 1)); }

    reviews="$(jq -r '.required_pull_request_reviews.required_approving_review_count // 0' <<<"$protection")"
    if [[ "$reviews" -ge 1 ]]; then pass "at least one approving review required ($reviews)"; else fail "no approving review required"; fi

    strict="$(jq -r '.required_status_checks.strict // false' <<<"$protection")"
    if [[ "$strict" == "true" ]]; then pass "branches must be up to date before merging"; else fail "required_status_checks.strict is not enabled"; fi

    contexts="$(jq -r '.required_status_checks.contexts // [] | length' <<<"$protection")"
    if [[ "$contexts" -ge 1 ]]; then pass "$contexts required status check(s)"; else fail "no required status checks"; fi

    enforce="$(jq -r '.enforce_admins.enabled // false' <<<"$protection")"
    if [[ "$enforce" == "true" ]]; then pass "rules apply to admins too"; else fail "admins are exempt from the rules"; fi

    force="$(jq -r '.allow_force_pushes.enabled // false' <<<"$protection")"
    if [[ "$force" == "false" ]]; then pass "force pushes are disabled"; else fail "force pushes are allowed"; fi

    deletions="$(jq -r '.allow_deletions.enabled // false' <<<"$protection")"
    if [[ "$deletions" == "false" ]]; then pass "branch deletion is disabled"; else fail "branch deletion is allowed"; fi

    if [[ "$failures" -gt 0 ]]; then
      echo "branch-protection: $failures check(s) failed for $REPO:$BRANCH" >&2
      exit 1
    fi
    echo "branch-protection: $REPO:$BRANCH matches the policy."
    ;;
  *)
    echo "usage: $0 [apply|check]" >&2
    exit 2
    ;;
esac
