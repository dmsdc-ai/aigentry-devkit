#!/usr/bin/env bash
# session-cleanup.sh — Universal session termination primitive.
# Usage: session-cleanup.sh <session-id>
# Spec: docs/superpowers/specs/2026-04-19-session-cleanup-and-platform-abstraction-design.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/platform.sh
source "$SCRIPT_DIR/lib/platform.sh"

usage() { echo "Usage: session-cleanup.sh <session-id>"; exit 1; }

main() {
  local sid="${1:-}"
  [[ -z "$sid" ]] && usage

  # 1. Discover session via telepty.
  local tp_info
  tp_info=$(telepty session info "$sid" 2>/dev/null || echo "")
  if [[ -z "$tp_info" ]]; then
    echo "[cleanup] session not found: $sid (already gone, or never registered)" >&2
    exit 0
  fi

  # Best-effort PID extract from telepty session info output.
  local tp_pid
  tp_pid=$(echo "$tp_info" | awk '/^[[:space:]]*PID:/ {print $2; exit}')

  # 2. State flush BEFORE termination so handoff survives the kill.
  if command -v wtm-context >/dev/null 2>&1; then
    wtm-context handoff "$sid" "cleanup-complete" 2>/dev/null || true
  elif [[ -x "$HOME/.wtm/bin/wtm-context" ]]; then
    "$HOME/.wtm/bin/wtm-context" handoff "$sid" "cleanup-complete" 2>/dev/null || true
  fi
  if [[ -x "$SCRIPT_DIR/ctx-router.sh" ]]; then
    "$SCRIPT_DIR/ctx-router.sh" on-session-end "$sid" 2>/dev/null || true
  fi

  # 3. Terminate PTY process + enclosing cmux workspace (if any).
  if [[ -n "$tp_pid" ]]; then
    platform::kill_pid "$tp_pid" || true
  fi
  if command -v cmux >/dev/null 2>&1; then
    local ws_ref=""
    # cmux list-workspaces may return non-zero on an empty workspace set; absorb.
    ws_ref=$({ cmux list-workspaces 2>/dev/null || true; } \
      | awk -v sid="$sid" '$0 ~ sid {for(i=1;i<=NF;i++) if($i ~ /^workspace:/) {print $i; exit}}' \
      || true)
    [[ -n "$ws_ref" ]] && cmux close-workspace --workspace "$ws_ref" 2>/dev/null || true
  fi

  # 4. Trace cleanup: orchestrator-wide pid mutex (per-plan locks are the caller's concern).
  rm -f "$HOME/.wtm/contexts/orchestrator/multi-exec.pid" 2>/dev/null || true

  echo "[cleanup] session terminated: $sid"
}

main "$@"
