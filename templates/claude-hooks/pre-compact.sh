#!/usr/bin/env bash
# Claude Code PreCompact hook → ctx-router
# Spec: docs/superpowers/specs/2026-04-19-context-compact-switching-design.md §5.1
set -euo pipefail

CTX_ROUTER="${CTX_ROUTER_PATH:-$HOME/projects/aigentry-devkit/bin/ctx-router.sh}"
[[ -x "$CTX_ROUTER" ]] || { echo "[pre-compact] ctx-router not found at $CTX_ROUTER" >&2; exit 0; }

# Claude passes session JSON on stdin
PAYLOAD="$(cat)"
SID="$(echo "$PAYLOAD" | jq -r '.session_id // empty')"
[[ -z "$SID" ]] && { echo "[pre-compact] no session_id in payload; skipping" >&2; exit 0; }

"$CTX_ROUTER" on-precompact "$SID" >&2 || true
# Pre-compact hook expects exit 0 on success; must not block compact
exit 0
