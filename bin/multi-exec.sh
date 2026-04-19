#!/usr/bin/env bash
# multi-exec.sh — Plan-driven orchestration runner (Phase 1)
# Spec: docs/superpowers/specs/2026-04-19-multi-exec-automation-design.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./multi-exec-lib.sh
source "$SCRIPT_DIR/multi-exec-lib.sh"

usage() {
  cat <<'EOF'
Usage: multi-exec.sh <plan-file> [--strict] [--auto-trust] [--dry-run]

Orchestrator runner for plans with `multi_exec:` frontmatter.
Phase 1: linear dispatch + chunk gate + event log ownership. No review loop.

Options:
  --strict       Reject plans without multi_exec: frontmatter.
  --auto-trust   Auto-run trust-path.sh on first inject (security: default off).
  --dry-run      Print planned dispatch order and exit without injecting.
EOF
}

main() {
  local plan="${1:-}"
  [[ -z "$plan" || "$plan" == "-h" || "$plan" == "--help" ]] && { usage; exit 1; }

  shift
  local strict=0 auto_trust=0 dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --strict)     strict=1; shift;;
      --auto-trust) auto_trust=1; shift;;
      --dry-run)    dry_run=1; shift;;
      *) echo "unknown flag: $1" >&2; exit 2;;
    esac
  done

  acquire_pid_mutex || exit 4
  acquire_lock "$plan" || { release_pid_mutex; exit 5; }
  trap 'release_lock; release_pid_mutex' EXIT

  local fm
  if ! fm=$(parse_frontmatter "$plan"); then
    if [[ $strict -eq 1 ]]; then
      echo "multi_exec frontmatter missing — rejected (--strict)" >&2
      exit 3
    fi
    echo "no multi_exec: frontmatter in $plan — no-op exit" >&2
    exit 0
  fi

  local coder_session
  coder_session=$(echo "$fm" | jq -r '.coder_session // empty')
  if [[ -z "$coder_session" ]]; then
    echo "multi_exec.coder_session required" >&2
    exit 6
  fi

  local cleanup_on_success preserve_on_error
  cleanup_on_success=$(echo "$fm" | jq -r '.cleanup_on_success // false')
  preserve_on_error=$(echo "$fm" | jq -r '.preserve_on_error // true')

  if [[ "$dry_run" -eq 1 ]]; then
    echo "=== Plan dispatch preview ==="
    while IFS=$'\t' read -r chunk task line; do
      echo "chunk=$chunk task=$task line=$line"
    done < <(parse_tasks "$plan")
    echo "=== coder_session: $coder_session ==="
    echo "=== chunk_gates: $(echo "$fm" | jq -c '.chunk_gates // []') ==="
    # auto_trust reserved for Task 4 — acknowledge value to silence lint.
    [[ "$auto_trust" -eq 1 ]] && echo "=== auto_trust: on ==="
    exit 0
  fi

  emit_event "runner_start" "$(jq -n --arg plan "$plan" '{plan:$plan}')"

  local prev_chunk=0
  while IFS=$'\t' read -r chunk task line; do
    if [[ "$chunk" != "$prev_chunk" && "$prev_chunk" != 0 ]]; then
      handle_chunk_gate "$fm" "$prev_chunk" || exit $?
    fi
    prev_chunk="$chunk"

    dispatch_task "$coder_session" "$plan" "$chunk" "$task" "$line" "$auto_trust"
    await_task_report "$coder_session" "$task" || exit $?
  done < <(parse_tasks "$plan")

  if [[ "$prev_chunk" != 0 ]]; then
    handle_chunk_gate "$fm" "$prev_chunk" || exit $?
  fi

  emit_event "runner_end" "$(jq -n --arg plan "$plan" '{plan:$plan}')"

  # Cleanup coder session if flag set AND no stuck events during this run.
  if [[ "$cleanup_on_success" == "true" ]]; then
    local had_error=0
    local events_log="$HOME/.wtm/contexts/orchestrator/journal.jsonl"
    if [[ -f "$events_log" ]]; then
      tail -200 "$events_log" 2>/dev/null | grep -q '"event":"stuck"' && had_error=1
    fi
    if [[ "$had_error" -eq 1 && "$preserve_on_error" == "true" ]]; then
      echo "[multi-exec] stuck detected — preserving $coder_session per preserve_on_error" >&2
    else
      echo "[multi-exec] cleanup_on_success → calling session-cleanup.sh $coder_session" >&2
      "$SCRIPT_DIR/session-cleanup.sh" "$coder_session" \
        || echo "[multi-exec] cleanup failed (non-fatal)" >&2
      emit_event "session_cleanup_invoked" "$(jq -n --arg s "$coder_session" '{session:$s}')"
    fi
  fi
}

main "$@"
