#!/usr/bin/env bash
# WTM Backup Manager - Pre-destructive session snapshots

WTM_BACKUPS="${WTM_HOME}/backups"

# Backup a session before destructive operation
# Args: session_id
# Returns: backup directory path
backup_session() {
  local session_id="$1"
  local safe_id="${session_id//[:\/]/_}"
  local backup_dir="${WTM_BACKUPS}/${safe_id}/$(date +%Y%m%d_%H%M%S)"
  mkdir -p "${backup_dir}"

  # Backup session metadata from sessions.json
  get_session "${session_id}" > "${backup_dir}/session.json" 2>/dev/null || true

  # Backup git state from worktree
  local worktree
  worktree=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))" < "${backup_dir}/session.json" 2>/dev/null) || true

  if [[ -n "${worktree}" ]] && [[ -d "${worktree}" ]]; then
    git -C "${worktree}" diff > "${backup_dir}/uncommitted.diff" 2>/dev/null || true
    git -C "${worktree}" diff --cached > "${backup_dir}/staged.diff" 2>/dev/null || true
    git -C "${worktree}" log --oneline -20 > "${backup_dir}/recent_commits.log" 2>/dev/null || true
    git -C "${worktree}" stash list > "${backup_dir}/stashes.log" 2>/dev/null || true
  fi

  echo "${backup_dir}"
}

# Restore session metadata from backup (metadata only, not worktree)
restore_session_metadata() {
  local backup_dir="$1"
  if [[ -f "${backup_dir}/session.json" ]]; then
    local session_data
    session_data=$(cat "${backup_dir}/session.json")
    # Extract session_id - it's in the format project:type-name
    local project type name
    project=$(echo "${session_data}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('project',''))")
    type=$(echo "${session_data}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('type',''))")
    name=$(echo "${session_data}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('name',''))")
    local session_id="${project}:${type}-${name}"
    upsert_session "${session_id}" "${session_data}"
    log_ok "Restored session metadata for ${session_id}"
  fi
}

# List available backups
list_backups() {
  if [[ ! -d "${WTM_BACKUPS}" ]] || [[ -z "$(ls -A "${WTM_BACKUPS}" 2>/dev/null)" ]]; then
    echo "  No backups available."
    return 0
  fi
  echo ""
  printf "  %-30s %-20s %-10s\n" "Session" "Timestamp" "Files"
  printf "  %-30s %-20s %-10s\n" "$(printf '─%.0s' {1..30})" "$(printf '─%.0s' {1..20})" "$(printf '─%.0s' {1..10})"
  for session_dir in "${WTM_BACKUPS}"/*/; do
    [[ -d "${session_dir}" ]] || continue
    local session_name=$(basename "${session_dir}")
    for ts_dir in "${session_dir}"*/; do
      [[ -d "${ts_dir}" ]] || continue
      local ts=$(basename "${ts_dir}")
      local file_count=$(ls -1 "${ts_dir}" 2>/dev/null | wc -l | tr -d ' ')
      printf "  %-30s %-20s %-10s\n" "${session_name}" "${ts}" "${file_count}"
    done
  done
  echo ""
}

# Remove backups older than N days
cleanup_old_backups() {
  local max_age_days="${1:-30}"
  if [[ -d "${WTM_BACKUPS}" ]]; then
    find "${WTM_BACKUPS}" -mindepth 2 -maxdepth 2 -type d -mtime "+${max_age_days}" -exec rm -rf {} + 2>/dev/null || true
    # Remove empty session directories
    find "${WTM_BACKUPS}" -mindepth 1 -maxdepth 1 -type d -empty -delete 2>/dev/null || true
  fi
}
