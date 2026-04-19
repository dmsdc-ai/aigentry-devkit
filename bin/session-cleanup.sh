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

  # 2. State flush BEFORE termination so handoff survives the kill.
  if command -v wtm-context >/dev/null 2>&1; then
    wtm-context handoff "$sid" "cleanup-complete" 2>/dev/null || true
  elif [[ -x "$HOME/.wtm/bin/wtm-context" ]]; then
    "$HOME/.wtm/bin/wtm-context" handoff "$sid" "cleanup-complete" 2>/dev/null || true
  fi
  if [[ -x "$SCRIPT_DIR/ctx-router.sh" ]]; then
    "$SCRIPT_DIR/ctx-router.sh" on-session-end "$sid" 2>/dev/null || true
  fi

  # 3. Terminate via telepty daemon REST API (authoritative path — the daemon
  # owns the PTY fd and the child process, so DELETE is a clean teardown
  # that also deregisters the session).
  #
  # Rationale: `telepty session info` does NOT expose a PID field
  # (transport_pid/processPid/ptyPid all null in v0.2.x), so previously the
  # cleanup had no PID to kill and silently no-op'd on every session.
  local tp_kill_ok=0
  local tp_host="${TELEPTY_DAEMON_HOST:-127.0.0.1}"
  local tp_port="${TELEPTY_DAEMON_PORT:-3848}"
  if command -v curl >/dev/null 2>&1; then
    local resp status
    resp=$(curl -sX DELETE "http://$tp_host:$tp_port/api/sessions/$sid" \
      -w '\n%{http_code}' 2>/dev/null || true)
    status=$(printf '%s\n' "$resp" | tail -1)
    if [[ "$status" == 2* ]]; then
      tp_kill_ok=1
    fi
  fi

  # 4. PID fallback: if a future telepty version exposes a pid field in JSON,
  # honor it as a second line of defence (REST DELETE should already be enough).
  if [[ $tp_kill_ok -eq 0 ]] && command -v telepty >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    local tp_pid
    tp_pid=$(telepty session info "$sid" --json 2>/dev/null \
      | jq -r '.transport_pid // .spawnPid // .ptyPid // .processPid // .pid // empty' 2>/dev/null)
    if [[ -n "$tp_pid" && "$tp_pid" != "null" ]]; then
      platform::kill_pid "$tp_pid" || true
      tp_kill_ok=1
    fi
  fi

  # 5. Close the enclosing cmux workspace if wrapped (best-effort).
  if command -v cmux >/dev/null 2>&1; then
    local ws_ref=""
    ws_ref=$({ cmux list-workspaces 2>/dev/null || true; } \
      | awk -v sid="$sid" '$0 ~ sid {for(i=1;i<=NF;i++) if($i ~ /^workspace:/) {print $i; exit}}' \
      || true)
    [[ -n "$ws_ref" ]] && cmux close-workspace --workspace "$ws_ref" 2>/dev/null || true
  fi

  # 6. Trace cleanup: orchestrator-wide pid mutex (per-plan locks stay with the caller).
  rm -f "$HOME/.wtm/contexts/orchestrator/multi-exec.pid" 2>/dev/null || true

  if [[ $tp_kill_ok -eq 1 ]]; then
    echo "[cleanup] session terminated: $sid"
  else
    echo "[cleanup] session state flushed, but telepty termination API unreachable — session may still be live: $sid" >&2
    echo "[cleanup] retry with: curl -sX DELETE http://$tp_host:$tp_port/api/sessions/$sid" >&2
    exit 9
  fi
}

main "$@"
