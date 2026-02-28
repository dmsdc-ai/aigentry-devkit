#!/usr/bin/env bash
# WTM Share Library - Session export, import, and handoff

WTM_SHARE_DIR="${WTM_SHARE_DIR:-${WTM_HOME}/shares}"

# Export a session as a .tar.gz bundle with metadata and git bundle
# Args: session_id
# Stdout: path to .tar.gz
export_session() {
  local session_id="$1"

  if [[ -z "${session_id}" ]]; then
    log_error "Usage: export_session <session_id>"
    return 1
  fi

  local session_json
  session_json=$(get_session "${session_id}" 2>/dev/null) || {
    log_error "Session not found: ${session_id}"
    return 1
  }

  mkdir -p "${WTM_SHARE_DIR}"

  local worktree base_branch branch
  worktree=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))" 2>/dev/null) || worktree=""
  base_branch=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('base_branch','main'))" 2>/dev/null) || base_branch="main"
  branch=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('branch',''))" 2>/dev/null) || branch=""

  if [[ -z "${worktree}" ]] || [[ ! -d "${worktree}" ]]; then
    log_error "Worktree not found for session: ${session_id}"
    return 1
  fi

  # Create temp staging directory
  local safe_id="${session_id//[:\/]/_}"
  local timestamp
  timestamp=$(date -u +"%Y%m%dT%H%M%SZ")
  local stage_dir
  stage_dir=$(mktemp -d)
  local output_tar="${WTM_SHARE_DIR}/${safe_id}_${timestamp}.tar.gz"

  # Export session.json metadata
  echo "${session_json}" > "${stage_dir}/session.json"

  # Create git bundle if worktree is a git repo
  if [[ -d "${worktree}/.git" ]] || git -C "${worktree}" rev-parse --git-dir &>/dev/null 2>&1; then
    local bundle_file="${stage_dir}/branch.bundle"
    if git -C "${worktree}" bundle create "${bundle_file}" "${base_branch}..HEAD" 2>/dev/null; then
      log_info "Git bundle created for branch: ${branch}"
    else
      log_warn "Could not create git bundle (no commits ahead of ${base_branch}?)"
    fi
  fi

  # Create the tar.gz
  tar -czf "${output_tar}" -C "${stage_dir}" .
  rm -rf "${stage_dir}"

  log_ok "Session exported to: ${output_tar}"
  echo "${output_tar}"
}

# Import a session from a bundle
# Args: bundle_path
import_session() {
  local bundle_path="$1"

  if [[ -z "${bundle_path}" ]] || [[ ! -f "${bundle_path}" ]]; then
    log_error "Bundle file not found: ${bundle_path}"
    return 1
  fi

  local extract_dir
  extract_dir=$(mktemp -d)

  # Extract
  tar -xzf "${bundle_path}" -C "${extract_dir}" || {
    log_error "Failed to extract bundle: ${bundle_path}"
    rm -rf "${extract_dir}"
    return 1
  }

  # Read session.json
  if [[ ! -f "${extract_dir}/session.json" ]]; then
    log_error "Bundle missing session.json"
    rm -rf "${extract_dir}"
    return 1
  fi

  local session_json session_id
  session_json=$(cat "${extract_dir}/session.json")
  session_id=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id',''))" 2>/dev/null) || session_id=""

  if [[ -z "${session_id}" ]]; then
    log_error "session.json missing 'id' field"
    rm -rf "${extract_dir}"
    return 1
  fi

  # Import git bundle if present
  if [[ -f "${extract_dir}/branch.bundle" ]]; then
    local worktree
    worktree=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))" 2>/dev/null) || worktree=""
    if [[ -n "${worktree}" ]] && [[ -d "${worktree}" ]]; then
      git -C "${worktree}" bundle unbundle "${extract_dir}/branch.bundle" 2>/dev/null && \
        log_ok "Git bundle imported into ${worktree}" || \
        log_warn "Could not unbundle git bundle (worktree may not be set up)"
    else
      log_warn "Worktree not found; skipping git bundle import"
    fi
  fi

  # Register session
  upsert_session "${session_id}" "${session_json}"

  rm -rf "${extract_dir}"
  log_ok "Session imported: ${session_id}"
  echo "${session_id}"
}

# Push branch and generate handoff information
# Args: session_id [message]
handoff_session() {
  local session_id="$1"
  local message="${2:-Handoff from WTM}"

  if [[ -z "${session_id}" ]]; then
    log_error "Usage: handoff_session <session_id> [message]"
    return 1
  fi

  local session_json
  session_json=$(get_session "${session_id}" 2>/dev/null) || {
    log_error "Session not found: ${session_id}"
    return 1
  }

  local worktree branch
  worktree=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))" 2>/dev/null) || worktree=""
  branch=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('branch',''))" 2>/dev/null) || branch=""

  if [[ -z "${worktree}" ]] || [[ ! -d "${worktree}" ]]; then
    log_error "Worktree not found for session: ${session_id}"
    return 1
  fi

  # Push branch to remote
  local push_result=0
  git -C "${worktree}" push origin "${branch}" 2>/dev/null || push_result=$?

  local remote_url
  remote_url=$(git -C "${worktree}" remote get-url origin 2>/dev/null) || remote_url="unknown"

  # Generate handoff info
  local handoff_time
  handoff_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  echo "=== WTM Session Handoff ==="
  echo "  Session:   ${session_id}"
  echo "  Branch:    ${branch}"
  echo "  Remote:    ${remote_url}"
  echo "  Time:      ${handoff_time}"
  echo "  Message:   ${message}"
  if [[ ${push_result} -eq 0 ]]; then
    echo "  Push:      SUCCESS"
  else
    echo "  Push:      FAILED (manual push may be needed)"
  fi
  echo ""
  echo "  To resume: wtm context resume ${session_id}"

  # Track handoff metric
  if declare -f track_metric &>/dev/null; then
    track_metric "handoffs" 1 2>/dev/null || true
  fi

  # Update session context
  update_session_field "${session_id}" "context.last_handoff" "\"${handoff_time}\"" 2>/dev/null || true

  log_ok "Handoff complete for session: ${session_id}"
}
