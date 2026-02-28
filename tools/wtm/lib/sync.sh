#!/usr/bin/env bash
# sync.sh - Cross-machine state sync via git worktree on orphan branch
# Part of WTM (WorkTree Manager) cross-dimension library

# Source common utilities if not already loaded
[[ -n "${WTM_HOME}" ]] || WTM_HOME="${HOME}/.wtm"
[[ -n "${WTM_SESSIONS}" ]] || WTM_SESSIONS="${WTM_HOME}/sessions.json"
[[ -n "${WTM_PROJECTS}" ]] || WTM_PROJECTS="${WTM_HOME}/projects.json"

# Dedicated sync worktree root (separate from project worktrees)
WTM_SYNC_WORKTREE="${WTM_HOME}/sync-worktree"

# ---------------------------------------------------------------------------
# get_machine_id()
# Returns stable machine ID: hostname -s || uname -n || "unknown-$$"
# Lowercase, sanitized to [a-z0-9-]
# ---------------------------------------------------------------------------
get_machine_id() {
  local raw_id

  # Try hostname -s first (short hostname)
  raw_id=$(hostname -s 2>/dev/null)

  # Fallback to uname -n
  if [[ -z "${raw_id}" ]]; then
    raw_id=$(uname -n 2>/dev/null)
  fi

  # Final fallback
  if [[ -z "${raw_id}" ]]; then
    raw_id="unknown-$$"
  fi

  # Lowercase and sanitize to [a-z0-9-]
  echo "${raw_id}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'
}

# ---------------------------------------------------------------------------
# register_machine(machine_id)
# Write to projects.json machines{} section under lock.
# Includes hostname, registered_at, last_seen.
# ---------------------------------------------------------------------------
register_machine() {
  local machine_id="$1"
  local hostname_val
  hostname_val=$(hostname 2>/dev/null || echo "unknown")

  with_lock "projects" python3 -c "
import json, sys, datetime

projects_file = sys.argv[1]
machine_id = sys.argv[2]
hostname_val = sys.argv[3]
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

try:
    with open(projects_file, 'r') as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {}

if 'machines' not in data:
    data['machines'] = {}

if machine_id not in data['machines']:
    data['machines'][machine_id] = {
        'hostname': hostname_val,
        'registered_at': now,
        'last_seen': now
    }
    print(f'Registered new machine: {machine_id}')
else:
    data['machines'][machine_id]['last_seen'] = now
    print(f'Updated last_seen for machine: {machine_id}')

with open(projects_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
" "${WTM_PROJECTS}" "${machine_id}" "${hostname_val}"
}

# ---------------------------------------------------------------------------
# list_machines()
# Print formatted table of registered machines.
# ---------------------------------------------------------------------------
list_machines() {
  python3 -c "
import json, sys

projects_file = sys.argv[1]

try:
    with open(projects_file, 'r') as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    print('No projects file found or empty.')
    sys.exit(0)

machines = data.get('machines', {})
if not machines:
    print('No machines registered.')
    sys.exit(0)

print(f'{'Machine ID':<30} {'Hostname':<30} {'Registered At':<25} {'Last Seen':<25}')
print('-' * 110)
for mid, info in machines.items():
    hostname = info.get('hostname', 'unknown')
    registered = info.get('registered_at', 'unknown')
    last_seen = info.get('last_seen', 'unknown')
    print(f'{mid:<30} {hostname:<30} {registered:<25} {last_seen:<25}')
" "${WTM_PROJECTS}"
}

# ---------------------------------------------------------------------------
# sync_init(project)
# Get project info, create orphan branch "wtm-state/{machine-id}" via
# dedicated worktree (NOT branch switch). Copy sessions.json, projects.json,
# contexts/ to worktree. Initial commit.
# ---------------------------------------------------------------------------
sync_init() {
  local project="$1"
  local project_info

  project_info=$(get_project "${project}") || {
    log_error "Project not found: ${project}"
    return 1
  }

  IFS='|' read -r repo local_path base_branch <<< "${project_info}"

  local machine_id
  machine_id=$(get_machine_id)
  local sync_branch="wtm-state/${machine_id}"
  local sync_dir="${WTM_SYNC_WORKTREE}/${project}"

  mkdir -p "${WTM_SYNC_WORKTREE}"

  cd "${local_path}" || {
    log_error "Cannot cd to project path: ${local_path}"
    return 1
  }

  if ! git rev-parse --verify "${sync_branch}" &>/dev/null; then
    # Branch does not exist: create orphan branch via worktree
    git worktree add --detach "${sync_dir}" 2>/dev/null || true

    cd "${sync_dir}" || {
      log_error "Cannot cd to sync dir: ${sync_dir}"
      return 1
    }

    git checkout --orphan "${sync_branch}"
    git rm -rf . 2>/dev/null || true

    # Copy current WTM state
    mkdir -p wtm-state
    cp "${WTM_SESSIONS}" wtm-state/sessions.json
    cp "${WTM_PROJECTS}" wtm-state/projects.json
    [[ -d "${WTM_HOME}/contexts" ]] && cp -r "${WTM_HOME}/contexts" wtm-state/contexts

    git add .
    git commit -m "WTM: Initial state sync from ${machine_id}"

    cd "${local_path}" || true
  else
    # Branch exists: just add worktree if missing
    [[ -d "${sync_dir}" ]] || git worktree add "${sync_dir}" "${sync_branch}"
  fi

  register_machine "${machine_id}"
  log_ok "Sync initialized: branch=${sync_branch}, dir=${sync_dir}"
}

# ---------------------------------------------------------------------------
# sync_push(project)
# Copy current state to sync worktree, git add, commit if changes, push.
# ---------------------------------------------------------------------------
sync_push() {
  local project="$1"
  local project_info

  project_info=$(get_project "${project}") || {
    log_error "Project not found: ${project}"
    return 1
  }

  IFS='|' read -r repo local_path base_branch <<< "${project_info}"

  local machine_id
  machine_id=$(get_machine_id)
  local sync_dir="${WTM_SYNC_WORKTREE}/${project}"

  if [[ ! -d "${sync_dir}" ]]; then
    log_warn "Sync not initialized for project: ${project}. Run sync_init first."
    return 1
  fi

  # Copy current state to sync worktree
  mkdir -p "${sync_dir}/wtm-state"
  cp "${WTM_SESSIONS}" "${sync_dir}/wtm-state/sessions.json"
  cp "${WTM_PROJECTS}" "${sync_dir}/wtm-state/projects.json"
  [[ -d "${WTM_HOME}/contexts" ]] && cp -r "${WTM_HOME}/contexts" "${sync_dir}/wtm-state/contexts"

  cd "${sync_dir}" || {
    log_error "Cannot cd to sync dir: ${sync_dir}"
    return 1
  }

  git add .

  # Only commit if there are actual changes
  if git diff --cached --quiet; then
    log_info "No changes to push for project: ${project}"
    cd "${local_path}" || true
    return 0
  fi

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%Y-%m-%dT%H:%M:%SZ)
  git commit -m "WTM: State sync from ${machine_id} at ${ts}"
  git push origin "$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null || \
    git push --set-upstream origin "$(git rev-parse --abbrev-ref HEAD)"

  cd "${local_path}" || true
  log_ok "State pushed for project: ${project} (machine: ${machine_id})"

  # Emit sync event
  emit_event "sync.push" "{\"project\":\"${project}\",\"machine\":\"${machine_id}\"}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# sync_pull(project, from_machine)
# Fetch remote branch, show remote sessions (read-only display).
# ---------------------------------------------------------------------------
sync_pull() {
  local project="$1"
  local from_machine="$2"
  local project_info

  project_info=$(get_project "${project}") || {
    log_error "Project not found: ${project}"
    return 1
  }

  IFS='|' read -r repo local_path base_branch <<< "${project_info}"

  local remote_branch="wtm-state/${from_machine}"

  cd "${local_path}" || {
    log_error "Cannot cd to project path: ${local_path}"
    return 1
  }

  log_info "Fetching remote branch: ${remote_branch}"
  git fetch origin "${remote_branch}" 2>/dev/null || {
    log_error "Failed to fetch remote branch: ${remote_branch}"
    return 1
  }

  # Read-only display of remote sessions
  log_info "Remote sessions from machine: ${from_machine}"
  git show "origin/${remote_branch}:wtm-state/sessions.json" 2>/dev/null | python3 -c "
import json, sys

try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    print('Could not parse remote sessions.json')
    sys.exit(1)

if not data:
    print('No sessions found on remote.')
    sys.exit(0)

print(f'{'Session ID':<40} {'Status':<15} {'Started':<25}')
print('-' * 80)
for sid, info in data.items():
    status = info.get('status', 'unknown')
    started = info.get('started_at', info.get('created_at', 'unknown'))
    print(f'{sid:<40} {status:<15} {started:<25}')
" || log_warn "Could not display remote sessions."

  # Emit sync event
  emit_event "sync.pull" "{\"project\":\"${project}\",\"from_machine\":\"${from_machine}\"}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# sync_merge_session(project, from_machine, session_id)
# Extract specific session from remote state, upsert into local.
# ---------------------------------------------------------------------------
sync_merge_session() {
  local project="$1"
  local from_machine="$2"
  local session_id="$3"
  local project_info

  project_info=$(get_project "${project}") || {
    log_error "Project not found: ${project}"
    return 1
  }

  IFS='|' read -r repo local_path base_branch <<< "${project_info}"

  local remote_branch="wtm-state/${from_machine}"

  cd "${local_path}" || {
    log_error "Cannot cd to project path: ${local_path}"
    return 1
  }

  # Extract the specific session from remote state
  local remote_session_json
  remote_session_json=$(git show "origin/${remote_branch}:wtm-state/sessions.json" 2>/dev/null | python3 -c "
import json, sys

session_id = sys.argv[1]

try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    print('{}')
    sys.exit(1)

session = data.get(session_id)
if session is None:
    print('{}')
    sys.exit(1)

print(json.dumps(session))
" "${session_id}") || {
    log_error "Could not extract session ${session_id} from remote branch: ${remote_branch}"
    return 1
  }

  if [[ "${remote_session_json}" == "{}" ]]; then
    log_error "Session not found on remote: ${session_id}"
    return 1
  fi

  # Upsert into local sessions.json
  upsert_session "${session_id}" "${remote_session_json}"
  log_ok "Merged session ${session_id} from machine: ${from_machine}"
}
