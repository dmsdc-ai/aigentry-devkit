#!/usr/bin/env bash
# ctx-router.sh — Context Compact & Switching glue layer
# Spec: docs/superpowers/specs/2026-04-19-context-compact-switching-design.md
set -euo pipefail

CTX_ROUTER_VERSION="0.1.0"
# shellcheck disable=SC2034
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
# on-session-start(session-id) — Event 5.2
# Emits JSON for Claude Code hookSpecificOutput.additionalContext
cmd_on_session_start() {
  local sid="${1:-}"
  [[ -z "$sid" ]] && { echo "on-session-start: session-id required" >&2; exit 2; }
  local ctx
  ctx="$(cmd_restore "$sid")"
  # Truncate if > 16KB (hookSpecificOutput limit heuristic)
  local max_bytes=16000
  if (( ${#ctx} > max_bytes )); then
    ctx="${ctx:0:$max_bytes}

---
⚠️ truncated. Run 'wtm-context resume $sid' for full history.
"
  fi
  # Emit Claude Code hook JSON
  jq -n --arg c "$ctx" '{hookSpecificOutput: {additionalContext: $c}}'
}
# on-git-commit(project, sha, msg) — Event 5.3
cmd_on_git_commit() {
  local project="${1:-}" sha="${2:-}" msg="${3:-}"
  [[ -z "$project" || -z "$sha" ]] && { echo "on-git-commit: project and sha required" >&2; exit 2; }
  call_brain_append "app:$project" "decision" "[$sha] $msg" || true
  # Cross-reference in orchestrator session journal if present
  local orch_sid="aigentry-orchestrator"
  call_wtm_context log "$orch_sid" milestone "commit $sha $project: $msg" 2>/dev/null || true
  echo "[ctx-router] git-commit handled: $project@$sha"
}

# on-tq-transition(sid, tid, old, new) — Event 5.4
cmd_on_tq_transition() {
  local sid="${1:-}" tid="${2:-}" old="${3:-}" new="${4:-}"
  [[ -z "$sid" || -z "$tid" ]] && { echo "on-tq-transition: sid + tid required" >&2; exit 2; }
  call_wtm_context log "$sid" milestone "task $tid: $old -> $new" || true
  if [[ "$new" == "done" ]]; then
    local desc=""
    if [[ -f state/task-queue.json ]]; then
      desc=$(jq -r --arg id "$tid" '
        .tasks[] | select((.id|tostring)==$id) | .desc // empty
      ' state/task-queue.json 2>/dev/null || echo "")
    fi
    call_brain_append "app:orchestrator" "summary" "task $tid done: $desc" || true
  fi
  echo "[ctx-router] tq-transition handled: $tid $old->$new"
}

cmd_on_session_end()    { echo "TODO"; exit 1; }
# restore(session-id) — read wtm handoff + brain summary, emit merged markdown
cmd_restore() {
  local sid="${1:-}"
  [[ -z "$sid" ]] && { echo "restore: session-id required" >&2; exit 2; }
  local wtm_output="" brain_output=""
  wtm_output="$(call_wtm_context resume "$sid" 2>/dev/null || true)"
  if command -v brain >/dev/null 2>&1; then
    brain_output="$(brain query --scope "session:$sid" --slot conversation_summary 2>/dev/null || true)"
  fi
  cat <<EOF
## Context Restore for $sid

### Session handoff (wtm-context)
$wtm_output

### Session summary (brain)
$brain_output
EOF
}

main "$@"
