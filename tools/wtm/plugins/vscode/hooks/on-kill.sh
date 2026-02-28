#!/usr/bin/env bash
# vscode/hooks/on-kill.sh
# Logs when a session is killed (VS Code plugin)

data_json="${1:-{}}"

session_id=$(echo "${data_json}" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(d.get('session_id', ''))
" 2>/dev/null)

log_file="${HOME}/.wtm/logs/vscode-plugin.log"
mkdir -p "$(dirname "${log_file}")"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [vscode] Session killed: ${session_id}" >> "${log_file}"
