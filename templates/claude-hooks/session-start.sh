#!/usr/bin/env bash
# Claude Code SessionStart hook → ctx-router restore
# Triggered on resume/compact/clear
set -euo pipefail

CTX_ROUTER="${CTX_ROUTER_PATH:-$HOME/projects/aigentry-devkit/bin/ctx-router.sh}"
[[ -x "$CTX_ROUTER" ]] || { echo '{}' ; exit 0; }

PAYLOAD="$(cat)"
TRIGGER="$(echo "$PAYLOAD" | jq -r '.trigger // empty')"
SID="$(echo "$PAYLOAD" | jq -r '.session_id // empty')"

# Only act on compact trigger (not resume/clear which Claude handles)
if [[ "$TRIGGER" != "compact" ]]; then
  echo '{}'
  exit 0
fi

[[ -z "$SID" ]] && { echo '{}' ; exit 0; }

"$CTX_ROUTER" on-session-start "$SID" || echo '{}'
