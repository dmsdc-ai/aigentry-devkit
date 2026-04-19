#!/usr/bin/env bash
# multi-exec.sh — Plan-driven orchestration runner (Phase 1)
# Spec: docs/superpowers/specs/2026-04-19-multi-exec-automation-design.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./multi-exec-lib.sh
source "$SCRIPT_DIR/multi-exec-lib.sh"

usage() {
  cat <<'EOF'
Usage: multi-exec.sh <plan-file> [--strict] [--auto-trust]

Orchestrator runner for plans with `multi_exec:` frontmatter.
Phase 1: linear dispatch + chunk gate + event log ownership. No review loop.

Options:
  --strict       Reject plans without multi_exec: frontmatter.
  --auto-trust   Auto-run trust-path.sh on first inject (security: default off).
EOF
}

main() {
  local plan="${1:-}"
  [[ -z "$plan" || "$plan" == "-h" || "$plan" == "--help" ]] && { usage; exit 1; }

  shift
  local strict=0 auto_trust=0
  # shellcheck disable=SC2034  # auto_trust reserved for Task 4 dispatch loop
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --strict)     strict=1; shift;;
      --auto-trust) auto_trust=1; shift;;
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

  # TODO(Task 4): actual dispatch loop
  echo "parsed frontmatter OK: $fm"
  echo "(Task 4 will add dispatch loop)"
}

main "$@"
