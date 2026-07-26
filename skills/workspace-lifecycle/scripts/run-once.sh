#!/usr/bin/env bash
# One-shot lifecycle: open workspace → inject prompt → wait → capture → close
# Output: captured screen written to --output, workspace ref echoed to stdout
set -euo pipefail

cwd=""
cmd=""
prompt_file=""
prompt_text=""
wait_pattern=""
wait_exit_file=""
timeout=300
output=""
title=""
keep_open=0

while [ $# -gt 0 ]; do
  case "$1" in
    --cwd) cwd="$2"; shift 2;;
    --command) cmd="$2"; shift 2;;
    --prompt-file) prompt_file="$2"; shift 2;;
    --prompt) prompt_text="$2"; shift 2;;
    --wait-pattern) wait_pattern="$2"; shift 2;;
    --wait-exit-file) wait_exit_file="$2"; shift 2;;
    --timeout) timeout="$2"; shift 2;;
    --output) output="$2"; shift 2;;
    --title) title="$2"; shift 2;;
    --keep-open) keep_open=1; shift;;
    *) echo "ERR unknown arg: $1" >&2; exit 1;;
  esac
done

[ -z "$cwd" ] && { echo "ERR --cwd required" >&2; exit 1; }
[ -z "$cmd" ] && { echo "ERR --command required" >&2; exit 1; }
if [ -z "$wait_pattern" ] && [ -z "$wait_exit_file" ]; then
  echo "ERR --wait-pattern or --wait-exit-file required" >&2; exit 1
fi
command -v cmux >/dev/null || { echo "ERR cmux not in PATH" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Open
out=$(cmux new-workspace --cwd "$cwd" --command "$cmd" 2>&1)
ref=$(echo "$out" | grep -oE 'workspace:[0-9]+' | head -1)
[ -z "$ref" ] && { echo "ERR open failed: $out" >&2; exit 2; }
[ -n "$title" ] && cmux rename-workspace --workspace "$ref" "$title" >/dev/null 2>&1 || true

echo "$ref"  # echo ref early for caller

# 2. Give CLI time to boot (conservative; caller can pre-tune via --command wrapper)
sleep 2

# 3. Send prompt
if [ -n "$prompt_file" ]; then
  prompt_text=$(cat "$prompt_file")
fi
if [ -n "$prompt_text" ]; then
  cmux send --workspace "$ref" "$prompt_text" >/dev/null
  cmux send-key --workspace "$ref" enter >/dev/null
fi

# 4. Wait
wait_args=(--ws "$ref" --timeout "$timeout")
[ -n "$wait_pattern" ] && wait_args+=(--pattern "$wait_pattern")
[ -n "$wait_exit_file" ] && wait_args+=(--exit-file "$wait_exit_file")

if ! "$SCRIPT_DIR/wait.sh" "${wait_args[@]}" >&2; then
  rc=$?
  echo "WAIT_FAILED rc=$rc" >&2
  [ "$keep_open" -eq 0 ] && cmux close-workspace --workspace "$ref" >/dev/null 2>&1 || true
  exit "$rc"
fi

# 5. Capture
if [ -n "$output" ]; then
  cmux read-screen --workspace "$ref" --scrollback > "$output"
fi

# 6. Close (unless --keep-open)
if [ "$keep_open" -eq 0 ]; then
  cmux close-workspace --workspace "$ref" >/dev/null 2>&1 || true
fi
