#!/usr/bin/env bash
# WTM Lazy - Deferred worktree creation (lazy materialization)

# Create a lazy session: metadata only, no actual worktree yet
# Tmux points to source_dir until materialize_worktree is called
# Args: session_id project type name source_dir base_branch
create_lazy_session() {
  local session_id="$1"
  local project="$2"
  local type="$3"
  local name="$4"
  local source_dir="$5"
  local base_branch="${6:-main}"

  local branch="${type}/${name}"
  local now
  now=$(now_iso)

  local session_json
  session_json=$(python3 -c "
import json, sys
sid, proj, stype, sname, src, base, branch, now = sys.argv[1:]
s = {
    'id': sid,
    'project': proj,
    'type': stype,
    'name': sname,
    'branch': branch,
    'base_branch': base,
    'source_dir': src,
    'worktree': None,
    'status': 'lazy',
    'tmux_session': sid.replace(':', '_').replace('/', '_'),
    'created_at': now,
    'ttl_hours': 168
}
print(json.dumps(s))
" "${session_id}" "${project}" "${type}" "${name}" "${source_dir}" "${base_branch}" "${branch}" "${now}")

  upsert_session "${session_id}" "${session_json}"

  # Open terminal session pointing at source_dir
  local tmux_name
  tmux_name=$(echo "${session_id}" | tr ':/' '__')
  local terminal_type
  terminal_type=$(open_terminal_session "${session_id}" "${source_dir}" "bash") || true

  # Update terminal field after we know the type
  if [[ -n "${terminal_type}" ]]; then
    local caps_json
    caps_json=$(python3 -c "
from json import dumps
caps = {'tmux': ['launch','send_command','check_alive','kill']}.get('${terminal_type}', ['launch'])
print(dumps(caps))")
    local session_name_val
    if [[ "${terminal_type}" == "tmux" ]]; then
      session_name_val="\"${tmux_name}\""
    else
      session_name_val="null"
    fi
    update_session_field "${session_id}" "terminal" "{\"type\": \"${terminal_type}\", \"session_name\": ${session_name_val}, \"pid\": null, \"capabilities\": ${caps_json}}"
  fi

  log_ok "Lazy session created: ${session_id} (worktree deferred)"
  log_info "Terminal '${terminal_type:-unknown}' → ${source_dir} (source dir)"
}

# Materialize a lazy session: create the actual git worktree, set up symlinks, start watcher
# Args: session_id
materialize_worktree() {
  local session_id="$1"

  local session_json
  session_json=$(get_session "${session_id}") || {
    log_error "Session not found: ${session_id}"
    return 1
  }

  local status
  status=$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(s.get('status',''))" "${session_json}")
  if [[ "${status}" != "lazy" ]]; then
    log_warn "Session ${session_id} is not lazy (status=${status}). Nothing to materialize."
    return 0
  fi

  local project source_dir base_branch branch type name
  project=$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(s.get('project',''))" "${session_json}")
  source_dir=$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(s.get('source_dir',''))" "${session_json}")
  base_branch=$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(s.get('base_branch','main'))" "${session_json}")
  branch=$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(s.get('branch',''))" "${session_json}")
  type=$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(s.get('type','feature'))" "${session_json}")
  name=$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(s.get('name',''))" "${session_json}")

  # Resolve worktree path
  local safe_id
  safe_id=$(echo "${session_id}" | tr ':/' '__')
  local worktree="${WTM_WORKTREES}/${safe_id}"

  log_info "Materializing worktree for ${session_id}..."

  # Create git branch and worktree from source_dir
  (
    cd "${source_dir}"
    if ! git show-ref --quiet "refs/heads/${branch}" 2>/dev/null; then
      git branch "${branch}" "${base_branch}" 2>/dev/null || true
    fi
    git worktree add "${worktree}" "${branch}" 2>/dev/null || {
      log_error "Failed to create git worktree at ${worktree}"
      exit 1
    }
  )

  # Set up symlinks for build caches if cache.sh is loaded
  if declare -f setup_build_cache_symlinks &>/dev/null; then
    setup_build_cache_symlinks "${source_dir}" "${worktree}" 2>/dev/null || true
  fi

  # Update session: set worktree, change status to active
  update_session_field "${session_id}" "worktree" "\"${worktree}\""
  update_session_field "${session_id}" "status" '"active"'

  # Re-point terminal to the worktree (tmux: send-keys, Tier 2: pending-cd marker)
  send_terminal_command "${session_id}" "cd '${worktree}'" 2>/dev/null || true

  # Start file watcher if watcher script exists
  local watcher_bin="${WTM_HOME}/bin/wtm-watch"
  if [[ -x "${watcher_bin}" ]]; then
    bash "${watcher_bin}" "${session_id}" &>/dev/null &
    log_info "File watcher started for ${session_id}"
  fi

  log_ok "Worktree materialized: ${worktree}"
}
