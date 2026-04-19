#!/usr/bin/env bash
# ctx-router.sh — Context Compact & Switching glue layer
# Spec: docs/superpowers/specs/2026-04-19-context-compact-switching-design.md
set -euo pipefail

CTX_ROUTER_VERSION="0.1.0"
CTX_DEFAULT_SCOPE_PREFIX="session"

usage() {
  cat <<'EOF'
Usage: ctx-router.sh <subcommand> [args]

Subcommands:
  classify <event-type> <payload-json>   Print destination (ephemeral|long-term|both)
  on-precompact <session-id>             Handle Claude PreCompact event
  on-session-start <session-id>          Handle Claude SessionStart:compact event
  on-git-commit <project> <sha> <msg>    Handle git post-commit event
  on-tq-transition <sid> <tid> <old> <new>  Handle task-queue status change
  on-session-end <session-id>            Handle session lifecycle end
  restore <session-id>                   Emit merged context (wtm + brain)
  version
EOF
}

main() {
  local sub="${1:-}"
  [[ -z "$sub" ]] && { usage; exit 1; }
  shift
  case "$sub" in
    classify)          cmd_classify "$@" ;;
    on-precompact)     cmd_on_precompact "$@" ;;
    on-session-start)  cmd_on_session_start "$@" ;;
    on-git-commit)     cmd_on_git_commit "$@" ;;
    on-tq-transition)  cmd_on_tq_transition "$@" ;;
    on-session-end)    cmd_on_session_end "$@" ;;
    restore)           cmd_restore "$@" ;;
    version)           echo "$CTX_ROUTER_VERSION" ;;
    *)                 usage; exit 1 ;;
  esac
}

# Stub implementations (filled in next tasks)
# classify(event-type, payload-json) → stdout: "ephemeral" | "long-term" | "both"
cmd_classify() {
  local event="${1:-}"
  local payload="${2:-}"
  [[ -z "$payload" ]] && payload='{}'
  [[ -z "$event" ]] && { echo "classify: event required" >&2; exit 2; }
  case "$event" in
    precompact)          echo "both" ;;           # wtm handoff + brain summary
    session-start)       echo "restore" ;;         # read from both
    git-commit)          echo "long-term" ;;       # brain decision
    tq-transition)
      # status=done → both (promote summary), else ephemeral
      local new_status
      new_status=$(echo "$payload" | jq -r '.new // empty')
      if [[ "$new_status" == "done" ]]; then echo "both"; else echo "ephemeral"; fi
      ;;
    session-end)         echo "both" ;;            # final handoff + learning promote
    *)                   echo "classify: unknown event '$event'" >&2; exit 2 ;;
  esac
}
# call_wtm_context(args...) — wtm-context CLI wrapper with fallback
call_wtm_context() {
  if command -v wtm-context >/dev/null 2>&1; then
    wtm-context "$@"
  elif [[ -x "$HOME/.wtm/bin/wtm-context" ]]; then
    "$HOME/.wtm/bin/wtm-context" "$@"
  else
    echo "[ctx-router] wtm-context not found; skipping wtm call" >&2
    return 0  # fail soft per §8 Error Handling
  fi
}

# call_brain_append(scope, category, content) — brain MCP append wrapper
call_brain_append() {
  local scope="$1" category="$2" content="$3"
  # Check if brain CLI available; MCP-only deployments may use different entry point
  if command -v brain >/dev/null 2>&1; then
    brain append --scope "$scope" --category "$category" --content "$content" 2>&1 || {
      echo "[ctx-router] brain append failed; continuing" >&2
      return 0
    }
  else
    echo "[ctx-router] brain CLI not found; skipping long-term persist" >&2
    return 0
  fi
}

# on-precompact(session-id) — Event 5.1
cmd_on_precompact() {
  local sid="${1:-}"
  [[ -z "$sid" ]] && { echo "on-precompact: session-id required" >&2; exit 2; }
  local cwd summary
  cwd="$(pwd)"
  summary="auto-compact snapshot @ $(date -Iseconds) cwd=$cwd"
  call_wtm_context handoff "$sid" "$summary" || true
  call_wtm_context log "$sid" milestone "precompact event" || true
  call_brain_append "session:$sid" "summary" "$summary" || true
  echo "[ctx-router] precompact handled: sid=$sid"
}
cmd_on_session_start()  { echo "TODO"; exit 1; }
cmd_on_git_commit()     { echo "TODO"; exit 1; }
cmd_on_tq_transition()  { echo "TODO"; exit 1; }
cmd_on_session_end()    { echo "TODO"; exit 1; }
cmd_restore()           { echo "TODO"; exit 1; }

main "$@"
