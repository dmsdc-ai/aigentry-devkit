#!/usr/bin/env bash
# WTM Health Manager - Session health checks, auto-healing, and background daemon

WTM_HEALTH_DAEMON_PID="${WTM_HOME}/health_daemon.pid"
WTM_WATCHERS="${WTM_HOME}/watchers"

# Check health of a single session
# Args: session_id
# Outputs: "score/4|issue1 issue2 ..." to stdout
# Returns: 0 if fully healthy, 1 if any issues
check_session_health() {
  local session_id="$1"
  local score=0
  local issues=()

  # Retrieve session JSON
  local session_json
  session_json=$(get_session "${session_id}" 2>/dev/null) || true

  if [[ -z "${session_json}" ]]; then
    echo "0/4|session_missing"
    return 1
  fi

  local worktree tmux_name terminal_type
  worktree=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))" 2>/dev/null) || true
  tmux_name=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('tmux',''))" 2>/dev/null) || true
  # Also extract terminal type for abstraction layer
  terminal_type=$(echo "${session_json}" | python3 -c "
import json,sys
s = json.loads(sys.stdin.read())
t = s.get('terminal', {})
if isinstance(t, dict): print(t.get('type', ''))
elif s.get('tmux'): print('tmux')
else: print('')
" 2>/dev/null) || true

  # Check 1: worktree directory exists and has .git
  if [[ -n "${worktree}" ]] && [[ -d "${worktree}" ]] && [[ -e "${worktree}/.git" ]]; then
    (( score++ ))
  else
    issues+=("worktree_missing")
  fi

  # Check 2: terminal session is alive (PID-based + tmux fallback)
  if check_terminal_alive "${session_id}" 2>/dev/null; then
    (( score++ ))
  else
    issues+=("terminal_dead")
  fi

  # Check 3: watcher PID file exists and process is alive
  local watcher_pid_file="${WTM_WATCHERS}/${session_id//[:\/]/_}.pid"
  if [[ -f "${watcher_pid_file}" ]]; then
    local watcher_pid
    watcher_pid=$(cat "${watcher_pid_file}" 2>/dev/null)
    if [[ -n "${watcher_pid}" ]] && kill -0 "${watcher_pid}" 2>/dev/null; then
      (( score++ ))
    else
      issues+=("watcher_dead")
    fi
  else
    issues+=("watcher_dead")
  fi

  # Check 4: symlinks are intact
  if [[ -n "${worktree}" ]]; then
    # Source symlink.sh if not already loaded
    if ! declare -f verify_symlinks &>/dev/null; then
      # shellcheck source=/dev/null
      source "${WTM_HOME}/lib/symlink.sh" 2>/dev/null || true
    fi
    if declare -f verify_symlinks &>/dev/null && verify_symlinks "${worktree}" 2>/dev/null; then
      (( score++ ))
    else
      issues+=("symlinks_broken")
    fi
  else
    issues+=("symlinks_broken")
  fi

  local issues_str="${issues[*]}"
  echo "${score}/4|${issues_str}"

  [[ ${score} -eq 4 ]]
}

# Auto-heal a specific issue for a session
# Args: session_id, issue
# Returns: 0 on success, 1 on failure
auto_heal() {
  local session_id="$1"
  local issue="$2"

  local session_json
  session_json=$(get_session "${session_id}" 2>/dev/null) || true

  if [[ -z "${session_json}" ]]; then
    log_error "Cannot heal ${session_id}: session not found"
    return 1
  fi

  local worktree tmux_name terminal_type
  worktree=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))" 2>/dev/null) || true
  tmux_name=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('tmux',''))" 2>/dev/null) || true
  # Also extract terminal type for abstraction layer
  terminal_type=$(echo "${session_json}" | python3 -c "
import json,sys
s = json.loads(sys.stdin.read())
t = s.get('terminal', {})
if isinstance(t, dict): print(t.get('type', ''))
elif s.get('tmux'): print('tmux')
else: print('')
" 2>/dev/null) || true

  case "${issue}" in
    terminal_dead)
      # Restart terminal session pointing at the worktree
      if [[ -n "${worktree}" ]] && [[ -d "${worktree}" ]]; then
        open_terminal_session "${session_id}" "${worktree}" "bash" &>/dev/null && \
          log_ok "Healed terminal session for ${session_id}" || \
          { log_error "Failed to restart terminal for ${session_id}"; return 1; }
      else
        log_error "Cannot heal terminal_dead for ${session_id}: missing worktree"
        return 1
      fi
      ;;

    watcher_dead)
      # Restart wtm-watch in background, save new PID
      local safe_id="${session_id//[:\/]/_}"
      local watcher_pid_file="${WTM_WATCHERS}/${safe_id}.pid"
      if command -v wtm-watch &>/dev/null; then
        wtm-watch "${session_id}" &>/dev/null &
        echo $! > "${watcher_pid_file}"
        log_ok "Healed watcher for ${session_id} (PID: $!)"
      else
        log_warn "wtm-watch not found; cannot heal watcher for ${session_id}"
        return 1
      fi
      ;;

    symlinks_broken)
      # Source symlink.sh and re-setup symlinks
      if ! declare -f setup_symlinks &>/dev/null; then
        # shellcheck source=/dev/null
        source "${WTM_HOME}/lib/symlink.sh" 2>/dev/null || true
      fi
      if declare -f setup_symlinks &>/dev/null && [[ -n "${worktree}" ]]; then
        local source_dir
        source_dir=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('source',''))" 2>/dev/null) || true
        setup_symlinks "${source_dir}" "${worktree}" 2>/dev/null && \
          log_ok "Healed symlinks for ${session_id}" || \
          { log_error "Failed to re-setup symlinks for ${session_id}"; return 1; }
      else
        log_error "Cannot heal symlinks_broken for ${session_id}: setup_symlinks unavailable"
        return 1
      fi
      ;;

    *)
      log_warn "Unknown issue '${issue}' for ${session_id}; no heal action available"
      return 1
      ;;
  esac

  return 0
}

# Run health checks on ALL active sessions and print summary table
system_health() {
  local sessions_file="${WTM_HOME}/sessions.json"

  if [[ ! -f "${sessions_file}" ]]; then
    echo "  No sessions file found at ${sessions_file}."
    return 0
  fi

  # Gather active session IDs
  local session_ids
  mapfile -t session_ids < <(python3 - <<'PYEOF' "${sessions_file}"
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
for sid, sess in data.items():
    if sess.get('status') == 'active':
        print(sid)
PYEOF
)

  if [[ ${#session_ids[@]} -eq 0 ]]; then
    echo "  No active sessions to check."
    return 0
  fi

  echo ""
  printf "  %-35s %-8s %-s\n" "Session" "Health" "Issues"
  printf "  %-35s %-8s %-s\n" "$(printf '─%.0s' {1..35})" "$(printf '─%.0s' {1..8})" "$(printf '─%.0s' {1..30})"

  local total=0 healthy=0

  for session_id in "${session_ids[@]}"; do
    (( total++ ))
    local result
    result=$(check_session_health "${session_id}")
    local score issues_str
    score="${result%%|*}"
    issues_str="${result##*|}"

    local score_num="${score%%/*}"
    local status_icon
    if [[ "${score_num}" -eq 4 ]]; then
      status_icon="OK"
      (( healthy++ ))
    elif [[ "${score_num}" -ge 2 ]]; then
      status_icon="WARN"
    else
      status_icon="CRIT"
    fi

    printf "  %-35s %-8s %-s\n" "${session_id}" "${score} ${status_icon}" "${issues_str}"
  done

  echo ""
  printf "  Summary: %d/%d sessions healthy\n" "${healthy}" "${total}"
  echo ""
}

# Start health daemon in background
# Args: [interval_minutes] (default: 30)
start_health_daemon() {
  local interval_minutes="${1:-30}"
  local interval_seconds=$(( interval_minutes * 60 ))

  # Check if already running
  if [[ -f "${WTM_HEALTH_DAEMON_PID}" ]]; then
    local existing_pid
    existing_pid=$(cat "${WTM_HEALTH_DAEMON_PID}" 2>/dev/null)
    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      log_warn "Health daemon already running (PID: ${existing_pid})"
      return 0
    fi
  fi

  # Launch background daemon loop
  (
    while true; do
      # Run health on all active sessions, attempt auto-heal for each issue
      local sessions_file="${WTM_HOME}/sessions.json"
      if [[ -f "${sessions_file}" ]]; then
        local session_ids
        mapfile -t session_ids < <(python3 - <<'PYEOF' "${sessions_file}"
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
for sid, sess in data.items():
    if sess.get('status') == 'active':
        print(sid)
PYEOF
)
        for session_id in "${session_ids[@]}"; do
          local result
          result=$(check_session_health "${session_id}" 2>/dev/null)
          local score_num="${result%%/*}"
          local issues_str="${result##*|}"
          if [[ "${score_num}" != "4" ]] && [[ -n "${issues_str}" ]]; then
            for issue in ${issues_str}; do
              auto_heal "${session_id}" "${issue}" 2>/dev/null || true
            done
          fi
        done
      fi
      sleep "${interval_seconds}"
    done
  ) &>/dev/null &

  local daemon_pid=$!
  echo "${daemon_pid}" > "${WTM_HEALTH_DAEMON_PID}"
  log_ok "Health daemon started (PID: ${daemon_pid}, interval: ${interval_minutes}min)"
}

# Stop the health daemon
stop_health_daemon() {
  if [[ ! -f "${WTM_HEALTH_DAEMON_PID}" ]]; then
    log_warn "No health daemon PID file found"
    return 0
  fi

  local daemon_pid
  daemon_pid=$(cat "${WTM_HEALTH_DAEMON_PID}" 2>/dev/null)

  if [[ -z "${daemon_pid}" ]]; then
    log_warn "Health daemon PID file is empty"
    rm -f "${WTM_HEALTH_DAEMON_PID}"
    return 0
  fi

  if kill -0 "${daemon_pid}" 2>/dev/null; then
    kill "${daemon_pid}" 2>/dev/null && \
      log_ok "Health daemon stopped (PID: ${daemon_pid})" || \
      log_error "Failed to stop health daemon (PID: ${daemon_pid})"
  else
    log_warn "Health daemon (PID: ${daemon_pid}) was not running"
  fi

  rm -f "${WTM_HEALTH_DAEMON_PID}"
}
