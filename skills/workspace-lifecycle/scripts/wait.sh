#!/usr/bin/env bash
# Wait for workspace condition (pattern match or exit-file presence)
# Exit: 0 = condition met, 124 = timeout
set -euo pipefail

ws=""
pattern=""
exit_file=""
timeout=300
interval=2

while [ $# -gt 0 ]; do
  case "$1" in
    --ws) ws="$2"; shift 2;;
    --pattern) pattern="$2"; shift 2;;
    --exit-file) exit_file="$2"; shift 2;;
    --timeout) timeout="$2"; shift 2;;
    --interval) interval="$2"; shift 2;;
    *) echo "ERR unknown arg: $1" >&2; exit 1;;
  esac
done

[ -z "$ws" ] && { echo "ERR --ws required" >&2; exit 1; }
if [ -z "$pattern" ] && [ -z "$exit_file" ]; then
  echo "ERR --pattern or --exit-file required" >&2; exit 1
fi
command -v cmux >/dev/null || { echo "ERR cmux not in PATH" >&2; exit 2; }

start=$(date +%s)
while :; do
  now=$(date +%s)
  elapsed=$((now - start))
  if [ "$elapsed" -ge "$timeout" ]; then
    echo "TIMEOUT after ${elapsed}s" >&2
    exit 124
  fi

  if [ -n "$exit_file" ] && [ -e "$exit_file" ]; then
    echo "EXIT_FILE_FOUND: $exit_file"
    exit 0
  fi

  if [ -n "$pattern" ]; then
    screen=$(cmux read-screen --workspace "$ws" --scrollback 2>/dev/null || true)
    if echo "$screen" | grep -qE "$pattern"; then
      echo "PATTERN_MATCH: $pattern"
      exit 0
    fi
  fi

  sleep "$interval"
done
