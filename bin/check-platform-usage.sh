#!/usr/bin/env bash
# check-platform-usage.sh — Rule 26 interim CI guard.
# Fails (exit 1) when bin/ contains direct OS-specific calls outside the
# platform backend files. Use platform::kill_pid / platform::file_lock /
# platform::event_wait instead.
#
# Future work (#305): replace with a tree-sitter / AST-aware pre-commit hook.
set -euo pipefail

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Extended regex patterns that violate Rule 26.
PATTERNS='kill -(TERM|KILL|HUP|9|15)([[:space:]]|$)|\bflock\b|\bfswatch\b'

# Search, exclude the backends themselves, any .md, and this script.
# Documented exceptions:
#   - multi-exec-lib.sh flock: runner-lifetime lock (fd 9 held across the
#     entire runner), which does not fit platform::file_lock's wrap-fn model.
#     Migration tracked when platform::file_lock_persistent lands (see #307).
VIOLATIONS=$(grep -rnE "$PATTERNS" "$BIN_DIR" 2>/dev/null \
  | grep -vE '/lib/platform-(unix|windows)\.sh:' \
  | grep -vE '\.md:' \
  | grep -vE '^[^:]+/check-platform-usage\.sh:' \
  | grep -vE '^[^:]+/multi-exec-lib\.sh:.*\bflock\b' \
  || true)

if [[ -n "$VIOLATIONS" ]]; then
  echo "Rule 26 violation — direct OS-specific calls outside platform backends:" >&2
  echo "$VIOLATIONS" >&2
  echo "" >&2
  echo "Use platform::kill_pid / platform::file_lock / platform::event_wait instead." >&2
  exit 1
fi
echo "Rule 26 check: clean"
