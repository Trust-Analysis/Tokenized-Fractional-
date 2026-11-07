#!/bin/bash
# Optimized price history git summary aggregation
# Uses git diff against last parsed commit instead of full traversal

MARKDOWN_FILE="PRICE_HISTORY_GIT_SUMMARY.md"
STATE_FILE=".price-history-last-commit"

# Get last parsed commit
LAST_COMMIT=""
if [ -f "$STATE_FILE" ]; then
  LAST_COMMIT=$(cat "$STATE_FILE")
fi

# If no previous commit, do full parse (first run)
if [ -z "$LAST_COMMIT" ] || ! git rev-parse "$LAST_COMMIT" >/dev/null 2>&1; then
  echo "First run - performing full repository parse..."
  LAST_COMMIT=$(git rev-list --max-parents=0 HEAD)
fi

# Get current HEAD
CURRENT_COMMIT=$(git rev-parse HEAD)

if [ "$LAST_COMMIT" = "$CURRENT_COMMIT" ]; then
  echo "No new commits since last parse. Skipping."
  exit 0
fi

echo "Parsing commits from ${LAST_COMMIT:0:8} to ${CURRENT_COMMIT:0:8}..."

# Only process diff since last parsed commit
CHANGES=$(git diff --name-only "$LAST_COMMIT".."$CURRENT_COMMIT" 2>/dev/null || git diff --name-only "$LAST_COMMIT" "$CURRENT_COMMIT")

PRICE_FILES_CHANGED=$(echo "$CHANGES" | grep -i "price\|pricing\|rate\|exchange" || true)

if [ -z "$PRICE_FILES_CHANGED" ]; then
  echo "No price-related files changed. Updating state only."
  echo "$CURRENT_COMMIT" > "$STATE_FILE"
  exit 0
fi

# Append new data to markdown file instead of rewriting
if [ ! -f "$MARKDOWN_FILE" ]; then
  cat > "$MARKDOWN_FILE" << 'MD'
# Price History Git Summary

This document is automatically updated when price-related files change.

## Recent Changes

MD
fi

# Append new entry
{
  echo ""
  echo "### $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "**Commits:** \`${LAST_COMMIT:0:8}\` → \`${CURRENT_COMMIT:0:8}\`"
  echo ""
  echo "**Changed files:**"
  echo "$PRICE_FILES_CHANGED" | while read -r file; do
    echo "- \`$file\`"
  done
  echo ""
} >> "$MARKDOWN_FILE"

# Save current commit as last parsed
echo "$CURRENT_COMMIT" > "$STATE_FILE"

echo "Price history summary updated successfully."
