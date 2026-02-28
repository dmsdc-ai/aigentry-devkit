#!/usr/bin/env bash
# claude-code/hooks/on-kill.sh
# Logs session kill to WTM HUD log for Claude Code integration

data_json="${1:-{}}"

session_id=$(echo "${data_json}" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(d.get('session_id', ''))
" 2>/dev/null)

log_file="${HOME}/.wtm/logs/hud.log"
mkdir -p "$(dirname "${log_file}")"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [WTM-HUD] Session killed: ${session_id}" >> "${log_file}"
