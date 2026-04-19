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
cmd_on_precompact()     { echo "TODO"; exit 1; }
cmd_on_session_start()  { echo "TODO"; exit 1; }
cmd_on_git_commit()     { echo "TODO"; exit 1; }
cmd_on_tq_transition()  { echo "TODO"; exit 1; }
cmd_on_session_end()    { echo "TODO"; exit 1; }
cmd_restore()           { echo "TODO"; exit 1; }

main "$@"
