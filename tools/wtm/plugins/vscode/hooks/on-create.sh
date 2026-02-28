#!/usr/bin/env bash
# vscode/hooks/on-create.sh
# Opens VS Code (or configured IDE) in the worktree when a session is created

data_json="${1:-{}}"

worktree=$(echo "${data_json}" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(d.get('worktree', ''))
" 2>/dev/null)

if [[ -n "${worktree}" ]] && [[ -d "${worktree}" ]]; then
  config_file="${HOME}/.wtm/config.json"
  ide="code"  # default
  if [[ -f "${config_file}" ]]; then
    ide=$(python3 -c "
import json
try:
    print(json.load(open('${config_file}')).get('ide', 'code'))
except Exception:
    print('code')
" 2>/dev/null || echo "code")
  fi
  command -v "${ide}" &>/dev/null && "${ide}" "${worktree}" &
fi
