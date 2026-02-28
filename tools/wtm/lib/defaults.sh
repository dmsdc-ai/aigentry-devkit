#!/usr/bin/env bash
# WTM Defaults - Smart defaults and config management

WTM_CONFIG="${WTM_CONFIG:-${WTM_HOME}/config.json}"

# Initialize config.json with defaults if it doesn't exist
init_config() {
  if [[ -f "${WTM_CONFIG}" ]]; then
    return 0
  fi
  python3 -c "
import json
config = {
  'defaults': {
    'session_type': 'feature',
    'auto_watch': True,
    'auto_symlink': True,
    'conventional_commits': True,
    'pr_template': True,
    'auto_cleanup_on_merge': True,
    'ttl_hours': 168,
    'max_sessions': 10
  },
  'display': {
    'colors': True,
    'compact_list': False,
    'show_metrics': True
  },
  'notifications': {
    'slack_webhook': None,
    'discord_webhook': None,
    'desktop': True
  },
  'terminal': {
    'preferred': 'auto',
    'fallback_order': ['detected', 'tmux', 'background'],
    'custom_launch_cmd': None
  }
}
import sys
path = sys.argv[1]
with open(path, 'w') as f:
    json.dump(config, f, indent=2)
print(f'[WTM] Config initialized at {path}')
" "${WTM_CONFIG}"
}

# Read a config value using dot-notation key (e.g., "defaults.session_type")
# Outputs the value as a string; exits 1 if key not found
get_config() {
  local key="$1"
  if [[ ! -f "${WTM_CONFIG}" ]]; then
    init_config
  fi
  python3 -c "
import json, sys

path = sys.argv[1]
key_path = sys.argv[2]

with open(path) as f:
    data = json.load(f)

keys = key_path.split('.')
obj = data
for k in keys:
    if not isinstance(obj, dict) or k not in obj:
        sys.exit(1)
    obj = obj[k]

if obj is None:
    print('null')
elif isinstance(obj, bool):
    print(str(obj).lower())
else:
    print(obj)
" "${WTM_CONFIG}" "${key}"
}

# Set a config value using dot-notation key, under lock
# Value is interpreted as a JSON literal if valid, otherwise as a plain string
set_config() {
  local key="$1"
  local value="$2"
  if [[ ! -f "${WTM_CONFIG}" ]]; then
    init_config
  fi
  with_lock "config" python3 -c "
import json, sys

path = sys.argv[1]
key_path = sys.argv[2]
val_str = sys.argv[3]

# Try to parse as JSON first; fall back to plain string
try:
    val = json.loads(val_str)
except (json.JSONDecodeError, ValueError):
    val = val_str

with open(path, 'r') as f:
    data = json.load(f)

keys = key_path.split('.')
obj = data
for k in keys[:-1]:
    obj = obj.setdefault(k, {})
obj[keys[-1]] = val

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" "${WTM_CONFIG}" "${key}" "${value}"
}
