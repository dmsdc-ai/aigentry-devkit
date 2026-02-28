#!/usr/bin/env bash
# WTM Terminal Abstraction Layer
# Provides a universal interface for terminal session management
# across all terminal emulators (tmux, iTerm2, Terminal.app, Warp, etc.)
#
# Capability Tiers:
#   Tier 1 (Full):        launch, send_command, check_alive, kill  → tmux
#   Tier 2 (Launch-only): launch                                   → GUI terminals
#   Tier 3 (Background):  launch                                   → headless/SSH

WTM_PIDS="${WTM_HOME}/pids"
WTM_TMP="${WTM_HOME}/tmp"
WTM_PENDING_CD="${WTM_HOME}/pending-cd"

# ═══════════════════════════════════════════════════════════════════
# Capability System
# ═══════════════════════════════════════════════════════════════════

# Get terminal capabilities for a given terminal type
# Args: terminal_type
# Stdout: space-separated list of capabilities
get_terminal_capabilities() {
  local terminal_type="$1"
  case "${terminal_type}" in
    tmux)
      echo "launch send_command check_alive kill"
      ;;
    *)
      echo "launch"
      ;;
  esac
}

# Check if terminal type has a specific capability
# Args: terminal_type capability_name
# Returns: 0 if capable, 1 otherwise
has_capability() {
  local terminal_type="$1"
  local cap_name="$2"
  local caps
  caps=$(get_terminal_capabilities "${terminal_type}")
  [[ " ${caps} " == *" ${cap_name} "* ]]
}

# Get capability tier number
# Args: terminal_type
# Stdout: 1, 2, or 3
get_terminal_tier() {
  local terminal_type="$1"
  case "${terminal_type}" in
    tmux) echo "1" ;;
    background) echo "3" ;;
    *) echo "2" ;;
  esac
}

# ═══════════════════════════════════════════════════════════════════
# Terminal Detection
# ═══════════════════════════════════════════════════════════════════

# Detect the current terminal emulator
# Priority: $TERM_PROGRAM → special env vars → $XDG_CURRENT_DESKTOP → tmux → fallback
# Stdout: terminal type string
detect_terminal() {
  # 1. macOS/cross-platform GUI terminals via $TERM_PROGRAM
  case "${TERM_PROGRAM:-}" in
    iTerm.app)       echo "iterm2"; return ;;
    Apple_Terminal)  echo "terminal.app"; return ;;
    WarpTerminal)    echo "warp"; return ;;
    alacritty)       echo "alacritty"; return ;;
    WezTerm)         echo "wezterm"; return ;;
  esac

  # 2. Kitty: uses $KITTY_WINDOW_ID or $TERM == "xterm-kitty"
  if [[ -n "${KITTY_WINDOW_ID:-}" ]]; then
    echo "kitty"; return
  fi
  if [[ "${TERM:-}" == "xterm-kitty" ]]; then
    echo "kitty"; return
  fi

  # 3. Konsole: $KONSOLE_VERSION
  if [[ -n "${KONSOLE_VERSION:-}" ]]; then
    echo "konsole"; return
  fi

  # 4. GNOME Terminal: $GNOME_TERMINAL_SERVICE
  if [[ -n "${GNOME_TERMINAL_SERVICE:-}" ]] && command -v gnome-terminal &>/dev/null; then
    echo "gnome-terminal"; return
  fi

  # 5. Linux: detect via $XDG_CURRENT_DESKTOP + command availability
  local desktop="${XDG_CURRENT_DESKTOP:-}"
  case "${desktop}" in
    *GNOME*)
      command -v gnome-terminal &>/dev/null && { echo "gnome-terminal"; return; }
      ;;
    *KDE*)
      command -v konsole &>/dev/null && { echo "konsole"; return; }
      ;;
    *XFCE*|*Xfce*)
      command -v xfce4-terminal &>/dev/null && { echo "xfce4-terminal"; return; }
      ;;
  esac

  # 6. tmux: running inside tmux or tmux available
  if [[ -n "${TMUX:-}" ]]; then
    echo "tmux"; return
  fi
  if command -v tmux &>/dev/null; then
    echo "tmux"; return
  fi

  # 7. Linux fallback: first available terminal emulator
  local -a fallback_terms=("gnome-terminal" "konsole" "xfce4-terminal" "xterm")
  for term in "${fallback_terms[@]}"; do
    if command -v "${term}" &>/dev/null; then
      echo "${term}"; return
    fi
  done

  # 8. Ultimate fallback: background mode
  echo "background"
}

# Resolve terminal to use, respecting config.json preferences
# Stdout: terminal type string
resolve_terminal() {
  local preferred
  preferred=$(get_config "terminal.preferred" 2>/dev/null || echo "auto")

  if [[ "${preferred}" != "auto" ]]; then
    # Verify the preferred terminal is usable
    local available=false
    case "${preferred}" in
      tmux)
        command -v tmux &>/dev/null && available=true ;;
      iterm2|terminal.app|warp)
        [[ "$(uname)" == "Darwin" ]] && available=true ;;
      alacritty|kitty|wezterm|gnome-terminal|konsole|xfce4-terminal|xterm)
        command -v "${preferred}" &>/dev/null && available=true ;;
      background)
        available=true ;;
    esac

    if $available; then
      echo "${preferred}"
      return
    fi
    log_warn "Preferred terminal '${preferred}' not available, falling back to auto-detect"
  fi

  # Read fallback order from config
  local fallback_order
  fallback_order=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        config = json.load(f)
    order = config.get('terminal', {}).get('fallback_order', ['detected', 'tmux', 'background'])
    print(' '.join(order))
except:
    print('detected tmux background')
" "${WTM_CONFIG:-${WTM_HOME}/config.json}" 2>/dev/null) || fallback_order="detected tmux background"

  for method in ${fallback_order}; do
    case "${method}" in
      detected)
        local detected
        detected=$(detect_terminal)
        if [[ "${detected}" != "background" ]]; then
          echo "${detected}"; return
        fi
        ;;
      tmux)
        command -v tmux &>/dev/null && { echo "tmux"; return; }
        ;;
      background)
        echo "background"; return
        ;;
    esac
  done

  echo "background"
}

# ═══════════════════════════════════════════════════════════════════
# Internal Helpers
# ═══════════════════════════════════════════════════════════════════

# Sanitize session ID for filesystem use
_safe_id() {
  echo "$1" | tr ':/' '__'
}

# Get PID file path
_get_pid_file() {
  local safe_id
  safe_id=$(_safe_id "$1")
  echo "${WTM_PIDS}/${safe_id}.json"
}

# Get wrapper script path
_get_wrapper_path() {
  local safe_id
  safe_id=$(_safe_id "$1")
  echo "${WTM_TMP}/wrapper-${safe_id}.sh"
}

# Generate wrapper script that tracks PID and cleans up on exit
# Args: session_id workdir command
# Stdout: path to generated wrapper
_generate_wrapper() {
  local session_id="$1"
  local workdir="$2"
  local command="$3"
  local safe_id
  safe_id=$(_safe_id "${session_id}")
  local wrapper_path
  wrapper_path=$(_get_wrapper_path "${session_id}")
  local pid_file
  pid_file=$(_get_pid_file "${session_id}")

  mkdir -p "${WTM_TMP}" "${WTM_PIDS}"

  cat > "${wrapper_path}" <<WRAPPER_EOF
#!/usr/bin/env bash
# WTM Terminal Wrapper - Auto-generated, do not edit
set -euo pipefail

export WTM_SESSION_ID="${safe_id}"

# Record PID atomically
_write_pid() {
  python3 -c "
import json, os, time, sys
pid_data = {
    'pid': os.getpid(),
    'ppid': os.getppid(),
    'start_time': time.time(),
    'command': sys.argv[1],
    'session_id': sys.argv[2]
}
with open(sys.argv[3], 'w') as f:
    json.dump(pid_data, f, indent=2)
" "\${0}" "${session_id}" "${pid_file}"
}

if [[ -f "${WTM_HOME}/lib/atomic.sh" ]]; then
  source "${WTM_HOME}/lib/atomic.sh"
  with_lock "pid-${safe_id}" _write_pid
else
  _write_pid
fi

# Clean up on exit
_cleanup() {
  rm -f "${pid_file}"
  rm -f "\$0"
}
trap _cleanup EXIT INT TERM

cd "${workdir}"
exec ${command}
WRAPPER_EOF

  chmod +x "${wrapper_path}"
  echo "${wrapper_path}"
}

# ═══════════════════════════════════════════════════════════════════
# Per-Terminal Launch Functions
# ═══════════════════════════════════════════════════════════════════

_launch_tmux() {
  local session_id="$1" workdir="$2" wrapper="$3"
  local safe_id
  safe_id=$(_safe_id "${session_id}")
  tmux new-session -d -s "${safe_id}" -c "${workdir}" "bash '${wrapper}'" 2>/dev/null
}

_launch_iterm2() {
  local workdir="$1" wrapper="$2"
  osascript -e "
    tell application \"iTerm2\"
      create window with default profile command \"bash '${wrapper}'\"
    end tell
  " 2>/dev/null
}

_launch_terminal_app() {
  local workdir="$1" wrapper="$2"
  osascript -e "
    tell application \"Terminal\"
      do script \"bash '${wrapper}'\"
      activate
    end tell
  " 2>/dev/null
}

_launch_warp() {
  local workdir="$1" wrapper="$2"
  # Warp lacks CLI command execution API
  # Use Terminal.app osascript as reliable fallback on macOS
  if [[ "$(uname)" == "Darwin" ]]; then
    osascript -e "
      tell application \"Terminal\"
        do script \"cd '${workdir}' && bash '${wrapper}'\"
        activate
      end tell
    " 2>/dev/null
  else
    nohup bash "${wrapper}" &>/dev/null &
  fi
}

_launch_alacritty() {
  local workdir="$1" wrapper="$2"
  alacritty --working-directory "${workdir}" -e bash "${wrapper}" &>/dev/null &
}

_launch_kitty() {
  local workdir="$1" wrapper="$2"
  # Try remote control (existing instance), then new instance
  if kitty @ ls &>/dev/null 2>&1; then
    kitty @ launch --cwd "${workdir}" bash "${wrapper}" 2>/dev/null
  else
    kitty --directory "${workdir}" bash "${wrapper}" &>/dev/null &
  fi
}

_launch_wezterm() {
  local workdir="$1" wrapper="$2"
  wezterm start --cwd "${workdir}" -- bash "${wrapper}" &>/dev/null &
}

_launch_gnome_terminal() {
  local workdir="$1" wrapper="$2"
  gnome-terminal --working-directory="${workdir}" -- bash "${wrapper}" &>/dev/null &
}

_launch_konsole() {
  local workdir="$1" wrapper="$2"
  konsole --workdir "${workdir}" -e bash "${wrapper}" &>/dev/null &
}

_launch_xfce4_terminal() {
  local workdir="$1" wrapper="$2"
  xfce4-terminal --working-directory="${workdir}" -e "bash '${wrapper}'" &>/dev/null &
}

_launch_xterm() {
  local workdir="$1" wrapper="$2"
  xterm -e "bash '${wrapper}'" &>/dev/null &
}

_launch_background() {
  local workdir="$1" wrapper="$2"
  nohup bash "${wrapper}" &>/dev/null &
}

# ═══════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════

# Open a new terminal session
# Args: session_id workdir [command]
# Returns: 0 on success
open_terminal_session() {
  local session_id="$1"
  local workdir="$2"
  local command="${3:-bash}"

  local terminal_type
  terminal_type=$(resolve_terminal)

  local wrapper
  wrapper=$(_generate_wrapper "${session_id}" "${workdir}" "${command}")
  local pid_file
  pid_file=$(_get_pid_file "${session_id}")

  case "${terminal_type}" in
    tmux)              _launch_tmux "${session_id}" "${workdir}" "${wrapper}" ;;
    iterm2)            _launch_iterm2 "${workdir}" "${wrapper}" ;;
    terminal.app)      _launch_terminal_app "${workdir}" "${wrapper}" ;;
    warp)              _launch_warp "${workdir}" "${wrapper}" ;;
    alacritty)         _launch_alacritty "${workdir}" "${wrapper}" ;;
    kitty)             _launch_kitty "${workdir}" "${wrapper}" ;;
    wezterm)           _launch_wezterm "${workdir}" "${wrapper}" ;;
    gnome-terminal)    _launch_gnome_terminal "${workdir}" "${wrapper}" ;;
    konsole)           _launch_konsole "${workdir}" "${wrapper}" ;;
    xfce4-terminal)    _launch_xfce4_terminal "${workdir}" "${wrapper}" ;;
    xterm)             _launch_xterm "${workdir}" "${wrapper}" ;;
    background)        _launch_background "${workdir}" "${wrapper}" ;;
    *)
      log_error "Unsupported terminal type: ${terminal_type}"
      return 1
      ;;
  esac

  # Wait for PID file (max 3 seconds)
  local wait_count=0
  while [[ ! -f "${pid_file}" ]] && [[ ${wait_count} -lt 6 ]]; do
    sleep 0.5
    (( wait_count++ ))
  done

  if [[ ! -f "${pid_file}" ]] && [[ "${terminal_type}" != "warp" ]]; then
    log_warn "PID file not created within 3s for session ${session_id}"
  fi

  # Return the terminal type and tier for the caller to store
  echo "${terminal_type}"
  return 0
}

# Check if a terminal session is alive
# Args: session_id
# Returns: 0 if alive, 1 if dead
check_terminal_alive() {
  local session_id="$1"
  local safe_id
  safe_id=$(_safe_id "${session_id}")

  # Read session to determine terminal type
  local session_json terminal_type
  session_json=$(get_session "${session_id}" 2>/dev/null) || true

  if [[ -n "${session_json}" ]]; then
    terminal_type=$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
t = s.get('terminal', {})
if isinstance(t, dict):
    print(t.get('type', ''))
elif s.get('tmux'):
    print('tmux')
else:
    print('')
" "${session_json}" 2>/dev/null) || terminal_type=""
  fi

  # Tier 1 (tmux): use tmux has-session
  if [[ "${terminal_type}" == "tmux" ]]; then
    local tmux_name
    tmux_name=$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
t = s.get('terminal', {})
if isinstance(t, dict):
    print(t.get('session_name', ''))
else:
    print(s.get('tmux', ''))
" "${session_json}" 2>/dev/null) || tmux_name=""
    if [[ -n "${tmux_name}" ]] && tmux has-session -t "${tmux_name}" 2>/dev/null; then
      return 0
    fi
  fi

  # All tiers: PID-based check
  local pid_file
  pid_file=$(_get_pid_file "${session_id}")

  [[ -f "${pid_file}" ]] || return 1

  local pid start_time
  pid=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('pid',''))" "${pid_file}" 2>/dev/null) || return 1
  start_time=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('start_time',''))" "${pid_file}" 2>/dev/null) || start_time=""

  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1

  # Verify PID hasn't been reused (start_time comparison)
  if [[ -n "${start_time}" ]]; then
    local is_same
    if [[ "$(uname)" == "Darwin" ]]; then
      is_same=$(python3 -c "
import subprocess, sys, time
pid, recorded = sys.argv[1], float(sys.argv[2])
try:
    r = subprocess.run(['ps', '-p', pid, '-o', 'etime='], capture_output=True, text=True, timeout=5)
    if r.returncode != 0: print('false'); sys.exit(0)
    etime = r.stdout.strip()
    parts = etime.replace('-', ':').split(':')
    parts = [int(p) for p in parts]
    if len(parts) == 2: elapsed = parts[0]*60 + parts[1]
    elif len(parts) == 3: elapsed = parts[0]*3600 + parts[1]*60 + parts[2]
    elif len(parts) == 4: elapsed = parts[0]*86400 + parts[1]*3600 + parts[2]*60 + parts[3]
    else: elapsed = 0
    actual_start = time.time() - elapsed
    print('true' if abs(actual_start - recorded) < 5 else 'false')
except: print('true')
" "${pid}" "${start_time}" 2>/dev/null) || is_same="true"
    else
      is_same=$(python3 -c "
import os, sys
pid, recorded = sys.argv[1], float(sys.argv[2])
try:
    with open(f'/proc/{pid}/stat') as f: stat = f.read().split()
    ticks = int(stat[21])
    hz = os.sysconf('SC_CLK_TCK')
    with open('/proc/stat') as f:
        btime = int([l for l in f if l.startswith('btime')][0].split()[1])
    actual = btime + ticks/hz
    print('true' if abs(actual - recorded) < 5 else 'false')
except: print('true')
" "${pid}" "${start_time}" 2>/dev/null) || is_same="true"
    fi
    [[ "${is_same}" == "true" ]] || return 1
  fi

  return 0
}

# Kill a terminal session
# Args: session_id
kill_terminal_session() {
  local session_id="$1"
  local safe_id
  safe_id=$(_safe_id "${session_id}")

  # Read session for terminal type
  local session_json terminal_type
  session_json=$(get_session "${session_id}" 2>/dev/null) || true

  if [[ -n "${session_json}" ]]; then
    terminal_type=$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
t = s.get('terminal', {})
if isinstance(t, dict): print(t.get('type', ''))
elif s.get('tmux'): print('tmux')
else: print('')
" "${session_json}" 2>/dev/null) || terminal_type=""
  fi

  # tmux: kill session
  if [[ "${terminal_type}" == "tmux" ]]; then
    local tmux_name
    tmux_name=$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
t = s.get('terminal', {})
if isinstance(t, dict): print(t.get('session_name', ''))
else: print(s.get('tmux', ''))
" "${session_json}" 2>/dev/null) || tmux_name=""
    [[ -n "${tmux_name}" ]] && tmux kill-session -t "${tmux_name}" 2>/dev/null || true
  fi

  # PID-based kill (all tiers)
  local pid_file
  pid_file=$(_get_pid_file "${session_id}")

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('pid',''))" "${pid_file}" 2>/dev/null) || pid=""
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      pkill -P "${pid}" 2>/dev/null || true
      kill "${pid}" 2>/dev/null || true
      sleep 0.5
      kill -0 "${pid}" 2>/dev/null && kill -9 "${pid}" 2>/dev/null || true
    fi
    rm -f "${pid_file}"
  fi

  # Clean up wrapper and pending-cd
  rm -f "$(_get_wrapper_path "${session_id}")"
  rm -f "${WTM_PENDING_CD}/${safe_id}"
  return 0
}

# List all terminal sessions from PID files
# Stdout: JSON array of {session_id, pid, alive}
list_terminal_sessions() {
  mkdir -p "${WTM_PIDS}"
  python3 -c "
import json, os, sys
pids_dir = sys.argv[1]
sessions = []
for fname in sorted(os.listdir(pids_dir)):
    if not fname.endswith('.json'): continue
    fpath = os.path.join(pids_dir, fname)
    try:
        with open(fpath) as f: data = json.load(f)
        pid = data.get('pid')
        alive = False
        if pid:
            try: os.kill(int(pid), 0); alive = True
            except: pass
        sessions.append({'session_id': data.get('session_id', fname[:-5]), 'pid': pid, 'alive': alive})
    except: pass
print(json.dumps(sessions))
" "${WTM_PIDS}"
}

# Drop-in replacement for tmux_session_exists()
# Args: session_name_or_id
# Returns: 0 if exists, 1 if not
terminal_session_exists() {
  local name="$1"
  # tmux check
  if command -v tmux &>/dev/null && tmux has-session -t "${name}" 2>/dev/null; then
    return 0
  fi
  # PID file check
  local pid_file="${WTM_PIDS}/${name}.json"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('pid',''))" "${pid_file}" 2>/dev/null) || return 1
    [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null && return 0
  fi
  return 1
}

# Send a command to a terminal session
# tmux (Tier 1): tmux send-keys
# Tier 2/3: pending-cd marker file (cd commands only)
# Args: session_id command
send_terminal_command() {
  local session_id="$1"
  local command="$2"
  local safe_id
  safe_id=$(_safe_id "${session_id}")

  local session_json terminal_type
  session_json=$(get_session "${session_id}" 2>/dev/null) || true

  if [[ -n "${session_json}" ]]; then
    terminal_type=$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
t = s.get('terminal', {})
if isinstance(t, dict): print(t.get('type', ''))
elif s.get('tmux'): print('tmux')
else: print('')
" "${session_json}" 2>/dev/null) || terminal_type=""
  fi

  # Tier 1: tmux send-keys
  if [[ "${terminal_type}" == "tmux" ]]; then
    local tmux_name
    tmux_name=$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
t = s.get('terminal', {})
if isinstance(t, dict): print(t.get('session_name', ''))
else: print(s.get('tmux', ''))
" "${session_json}" 2>/dev/null) || tmux_name=""
    if [[ -n "${tmux_name}" ]] && tmux has-session -t "${tmux_name}" 2>/dev/null; then
      tmux send-keys -t "${tmux_name}" "${command}" Enter 2>/dev/null
      return $?
    fi
  fi

  # Tier 2/3: pending-cd marker file for cd commands
  local cd_path=""
  if [[ "${command}" =~ ^cd[[:space:]]+[\'\"]?(.+)[\'\"]?$ ]]; then
    cd_path="${BASH_REMATCH[1]}"
    cd_path="${cd_path%\'}"
    cd_path="${cd_path%\"}"
  fi

  if [[ -n "${cd_path}" ]]; then
    mkdir -p "${WTM_PENDING_CD}"
    echo "${cd_path}" > "${WTM_PENDING_CD}/${safe_id}"
    return 0
  fi

  log_warn "send_terminal_command: non-cd commands not supported for ${terminal_type:-unknown} terminals"
  return 1
}

# Get terminal display info for wtm-info
# Args: session_id
# Stdout: "terminal_type (Tier N)"
get_terminal_display_info() {
  local session_id="$1"
  local session_json
  session_json=$(get_session "${session_id}" 2>/dev/null) || true

  if [[ -z "${session_json}" ]]; then
    echo "unknown (Tier ?)"
    return
  fi

  local terminal_type
  terminal_type=$(python3 -c "
import json, sys
s = json.loads(sys.argv[1])
t = s.get('terminal', {})
if isinstance(t, dict): print(t.get('type', 'unknown'))
elif s.get('tmux'): print('tmux')
else: print('unknown')
" "${session_json}" 2>/dev/null) || terminal_type="unknown"

  local tier
  tier=$(get_terminal_tier "${terminal_type}")
  echo "${terminal_type} (Tier ${tier})"
}
