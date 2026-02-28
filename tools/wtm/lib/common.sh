#!/usr/bin/env bash
# WTM Common Library - Shared functions for all WTM scripts

set -euo pipefail

export WTM_HOME="${WTM_HOME:-${HOME}/.wtm}"
export WTM_PROJECTS="${WTM_PROJECTS:-${WTM_HOME}/projects.json}"
export WTM_SESSIONS="${WTM_SESSIONS:-${WTM_HOME}/sessions.json}"
WTM_WORKTREES="${WTM_WORKTREES:-${WTM_HOME}/worktrees}"
WTM_LOGS="${WTM_LOGS:-${WTM_HOME}/logs}"
WTM_WATCHERS="${WTM_WATCHERS:-${WTM_HOME}/watchers}"
WTM_LOCKS="${WTM_LOCKS:-${WTM_HOME}/locks}"
WTM_BACKUPS="${WTM_BACKUPS:-${WTM_HOME}/backups}"
WTM_HOOKS="${WTM_HOOKS:-${WTM_HOME}/hooks}"
WTM_CONTEXTS="${WTM_CONTEXTS:-${WTM_HOME}/contexts}"
WTM_SYNC_WORKTREE="${WTM_SYNC_WORKTREE:-${WTM_HOME}/sync-worktree}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[WTM]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[WTM]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WTM]${NC} $*"; }
log_error() { echo -e "${RED}[WTM]${NC} $*" >&2; }

# Ensure WTM directories exist
ensure_dirs() {
  mkdir -p "${WTM_HOME}"/{bin,lib,logs,worktrees,watchers,locks,journals,backups,contexts,migrations,hooks,templates,plugins,tests,pids,tmp,pending-cd}
  [[ -f "${WTM_SESSIONS}" ]] || echo '{"version":1,"sessions":{}}' > "${WTM_SESSIONS}"
  [[ -f "${WTM_PROJECTS}" ]] || echo '{"aliases":{},"defaults":{}}' > "${WTM_PROJECTS}"
}

# Get project config by alias
get_project() {
  local alias="$1"
  if [[ ! -f "${WTM_PROJECTS}" ]]; then
    log_error "No projects.json found. Run 'wtm init' first."
    return 1
  fi
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
alias = sys.argv[2]
if alias in data.get('aliases', {}):
    p = data['aliases'][alias]
    print(f\"{p['repo']}|{p['local']}|{p.get('default_base', 'main')}\")
else:
    sys.exit(1)
" "${WTM_PROJECTS}" "${alias}"
}

# Read session from sessions.json
get_session() {
  local session_id="$1"
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
s = data.get('sessions', {}).get(sys.argv[2])
if s:
    print(json.dumps(s))
else:
    sys.exit(1)
" "${WTM_SESSIONS}" "${session_id}"
}

# Add/update session in sessions.json
upsert_session() {
  local session_id="$1"
  local session_json="$2"
  echo "${session_json}" | with_lock "sessions" python3 -c "
import json, sys
session_data = json.loads(sys.stdin.read())
with open(sys.argv[1], 'r') as f:
    data = json.load(f)
data.setdefault('sessions', {})[sys.argv[2]] = session_data
with open(sys.argv[1], 'w') as f:
    json.dump(data, f, indent=2)
" "${WTM_SESSIONS}" "${session_id}"
}

# Remove session from sessions.json
remove_session() {
  local session_id="$1"
  with_lock "sessions" python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    data = json.load(f)
data.get('sessions', {}).pop(sys.argv[2], None)
with open(sys.argv[1], 'w') as f:
    json.dump(data, f, indent=2)
" "${WTM_SESSIONS}" "${session_id}"
}

# Generate session ID from project + type + name
make_session_id() {
  local project="$1"
  local type="$2"
  local name="$3"
  echo "${project}:${type}-${name}"
}

# Check if tmux session exists (backward compat wrapper)
tmux_session_exists() {
  local name="$1"
  # Delegate to terminal abstraction if loaded, else direct tmux check
  if declare -f terminal_session_exists &>/dev/null; then
    terminal_session_exists "${name}"
  else
    tmux has-session -t "${name}" 2>/dev/null
  fi
}

# Get current timestamp
now_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Source new libraries (order matters: atomic first for locking, terminal before health)
source "${HOME}/.wtm/lib/logging.sh"
source "${HOME}/.wtm/lib/atomic.sh"
source "${HOME}/.wtm/lib/terminal.sh"
source "${HOME}/.wtm/lib/backup.sh"
source "${HOME}/.wtm/lib/health.sh"
source "${HOME}/.wtm/lib/migrate.sh"
source "${HOME}/.wtm/lib/events.sh"
source "${HOME}/.wtm/lib/detect.sh"
source "${HOME}/.wtm/lib/session-rel.sh"
source "${HOME}/.wtm/lib/cross-project.sh"
source "${HOME}/.wtm/lib/context.sh"
source "${HOME}/.wtm/lib/sync.sh"

# Phase 1 remaining
source "${HOME}/.wtm/lib/conflict.sh"
source "${HOME}/.wtm/lib/session.sh"
source "${HOME}/.wtm/lib/project.sh"
source "${HOME}/.wtm/lib/ui.sh"

# Phase 2: Automation Engine
source "${HOME}/.wtm/lib/defaults.sh"
source "${HOME}/.wtm/lib/ttl.sh"
source "${HOME}/.wtm/lib/disk.sh"
source "${HOME}/.wtm/lib/lazy.sh"
source "${HOME}/.wtm/lib/cache.sh"

# Phase 3: Git Workflow
source "${HOME}/.wtm/lib/commits.sh"
source "${HOME}/.wtm/lib/branch.sh"
source "${HOME}/.wtm/lib/pr.sh"

# Phase 4: Plugin Architecture
source "${HOME}/.wtm/lib/plugin.sh"
source "${HOME}/.wtm/lib/api.sh"

# Phase 5: Team & ROI
source "${HOME}/.wtm/lib/template.sh"
source "${HOME}/.wtm/lib/metrics.sh"
source "${HOME}/.wtm/lib/notify.sh"
source "${HOME}/.wtm/lib/share.sh"

# ─── Utility Functions (used by cross-dimension libs) ───

# Get stable machine identifier
get_machine_id() {
  local id
  id=$(hostname -s 2>/dev/null) || id=$(uname -n 2>/dev/null) || id="unknown-$$"
  echo "${id}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g'
}

# Expand ~ in paths
expand_path() {
  local p="$1"
  echo "${p/#\~/$HOME}"
}

# Update a single field in a session (read-modify-write under lock)
# Supports dot notation for nested fields: "context.last_handoff"
update_session_field() {
  local session_id="$1"
  local field="$2"
  local value="$3"
  with_lock "sessions" python3 -c "
import json, sys
sid, field_path, val_str = sys.argv[1], sys.argv[2], sys.argv[3]
with open(sys.argv[4], 'r') as f:
    data = json.load(f)
s = data.get('sessions', {}).get(sid)
if s is None:
    sys.exit(1)
keys = field_path.split('.')
obj = s
for k in keys[:-1]:
    obj = obj.setdefault(k, {})
obj[keys[-1]] = json.loads(val_str)
with open(sys.argv[4], 'w') as f:
    json.dump(data, f, indent=2)
" "${session_id}" "${field}" "${value}" "${WTM_SESSIONS}"
}

# Update a single field in projects.json
update_project_field() {
  local alias_name="$1"
  local field="$2"
  local value="$3"
  with_lock "projects" python3 -c "
import json, sys
alias_name, field_path, val_str = sys.argv[1], sys.argv[2], sys.argv[3]
with open(sys.argv[4], 'r') as f:
    data = json.load(f)
a = data.get('aliases', {}).get(alias_name)
if a is None:
    sys.exit(1)
keys = field_path.split('.')
obj = a
for k in keys[:-1]:
    obj = obj.setdefault(k, {})
obj[keys[-1]] = json.loads(val_str)
with open(sys.argv[4], 'w') as f:
    json.dump(data, f, indent=2)
" "${alias_name}" "${field}" "${value}" "${WTM_PROJECTS}"
}
