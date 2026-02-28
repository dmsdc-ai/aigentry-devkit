#!/usr/bin/env bash
# WTM Terminal Abstraction Layer Tests
set -euo pipefail

# Test framework
TT_RUN=0
TT_PASSED=0
TT_FAILED=0

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  TT_RUN=$((TT_RUN + 1))
  if [[ "${expected}" == "${actual}" ]]; then
    TT_PASSED=$((TT_PASSED + 1))
    echo "  [PASS] ${desc}"
  else
    TT_FAILED=$((TT_FAILED + 1))
    echo "  [FAIL] ${desc}"
    echo "         expected: '${expected}'"
    echo "         actual:   '${actual}'"
  fi
}

assert_true() {
  local desc="$1"; shift
  TT_RUN=$((TT_RUN + 1))
  if eval "$@" 2>/dev/null; then
    TT_PASSED=$((TT_PASSED + 1))
    echo "  [PASS] ${desc}"
  else
    TT_FAILED=$((TT_FAILED + 1))
    echo "  [FAIL] ${desc}"
  fi
}

assert_false() {
  local desc="$1"; shift
  TT_RUN=$((TT_RUN + 1))
  if eval "$@" 2>/dev/null; then
    TT_FAILED=$((TT_FAILED + 1))
    echo "  [FAIL] ${desc} (expected failure but got success)"
  else
    TT_PASSED=$((TT_PASSED + 1))
    echo "  [PASS] ${desc}"
  fi
}

# Setup test environment
export WTM_HOME=$(mktemp -d)
export WTM_SESSIONS="${WTM_HOME}/sessions.json"
export WTM_PROJECTS="${WTM_HOME}/projects.json"
export WTM_CONFIG="${WTM_HOME}/config.json"
export WTM_PIDS="${WTM_HOME}/pids"
export WTM_TMP="${WTM_HOME}/tmp"
export WTM_PENDING_CD="${WTM_HOME}/pending-cd"
export WTM_LOCKS="${WTM_HOME}/locks"
export WTM_JOURNALS="${WTM_HOME}/journals"
export WTM_WATCHERS="${WTM_HOME}/watchers"
export WTM_BACKUPS="${WTM_HOME}/backups"
export WTM_LOGS="${WTM_HOME}/logs"
export WTM_WORKTREES="${WTM_HOME}/worktrees"
mkdir -p "${WTM_HOME}"/{pids,tmp,pending-cd,locks,journals,watchers,backups,logs,worktrees,migrations,contexts,hooks,templates,plugins,bin,lib}
echo '{"version":4,"sessions":{}}' > "${WTM_SESSIONS}"
echo '{"aliases":{},"defaults":{}}' > "${WTM_PROJECTS}"

# Source libraries (minimal set needed for terminal.sh)
source "${HOME}/.wtm/lib/logging.sh"
source "${HOME}/.wtm/lib/atomic.sh"
source "${HOME}/.wtm/lib/defaults.sh"
# Need common.sh functions but avoid full source chain
# Define minimal stubs
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
log_info()  { echo -e "[INFO] $*"; }
log_ok()    { echo -e "[OK] $*"; }
log_warn()  { echo -e "[WARN] $*"; }
log_error() { echo -e "[ERR] $*" >&2; }
get_config() {
  local key="$1"
  python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f: data = json.load(f)
    keys = sys.argv[2].split('.')
    obj = data
    for k in keys:
        obj = obj[k]
    if obj is None: print('null')
    elif isinstance(obj, bool): print(str(obj).lower())
    else: print(obj)
except: sys.exit(1)
" "${WTM_CONFIG}" "${key}" 2>/dev/null
}

source "${HOME}/.wtm/lib/terminal.sh"

# Initialize config for tests
init_config 2>/dev/null || true

cleanup() {
  rm -rf "${WTM_HOME}"
}
trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  WTM Terminal Abstraction Layer Tests"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── 1. detect_terminal() tests ──
echo "── detect_terminal() ──"

# Run detect_terminal in subshells to isolate env, but assert in parent
_UNSET_ALL="unset TERM_PROGRAM KITTY_WINDOW_ID KONSOLE_VERSION TMUX GNOME_TERMINAL_SERVICE XDG_CURRENT_DESKTOP TERM 2>/dev/null;"

result=$(eval "${_UNSET_ALL} export TERM_PROGRAM=iTerm.app; detect_terminal")
assert_eq "iTerm.app detected" "iterm2" "${result}"

result=$(eval "${_UNSET_ALL} export TERM_PROGRAM=Apple_Terminal; detect_terminal")
assert_eq "Terminal.app detected" "terminal.app" "${result}"

result=$(eval "${_UNSET_ALL} export TERM_PROGRAM=WarpTerminal; detect_terminal")
assert_eq "Warp detected" "warp" "${result}"

result=$(eval "${_UNSET_ALL} export TERM_PROGRAM=alacritty; detect_terminal")
assert_eq "Alacritty detected" "alacritty" "${result}"

result=$(eval "${_UNSET_ALL} export TERM_PROGRAM=WezTerm; detect_terminal")
assert_eq "WezTerm detected" "wezterm" "${result}"

result=$(eval "${_UNSET_ALL} export KITTY_WINDOW_ID=1; detect_terminal")
assert_eq "Kitty detected via KITTY_WINDOW_ID" "kitty" "${result}"

result=$(eval "${_UNSET_ALL} export TERM=xterm-kitty; detect_terminal")
assert_eq "Kitty detected via TERM=xterm-kitty" "kitty" "${result}"

result=$(eval "${_UNSET_ALL} export KONSOLE_VERSION=21.12.3; detect_terminal")
assert_eq "Konsole detected via KONSOLE_VERSION" "konsole" "${result}"

result=$(eval "${_UNSET_ALL} export TMUX=/tmp/tmux-501/default,12345,0; detect_terminal")
assert_eq "tmux detected via TMUX env" "tmux" "${result}"

# ── 2. get_terminal_capabilities() tests ──
echo ""
echo "── get_terminal_capabilities() ──"

assert_eq "tmux has full caps" "launch send_command check_alive kill" "$(get_terminal_capabilities tmux)"
assert_eq "iterm2 has launch only" "launch" "$(get_terminal_capabilities iterm2)"
assert_eq "background has launch only" "launch" "$(get_terminal_capabilities background)"
assert_eq "terminal.app has launch only" "launch" "$(get_terminal_capabilities terminal.app)"

# ── 3. has_capability() tests ──
echo ""
echo "── has_capability() ──"

assert_true "tmux has send_command" has_capability "tmux" "send_command"
assert_true "tmux has kill" has_capability "tmux" "kill"
assert_false "iterm2 lacks send_command" has_capability "iterm2" "send_command"
assert_false "background lacks kill" has_capability "background" "kill"

# ── 4. get_terminal_tier() tests ──
echo ""
echo "── get_terminal_tier() ──"

assert_eq "tmux is Tier 1" "1" "$(get_terminal_tier tmux)"
assert_eq "iterm2 is Tier 2" "2" "$(get_terminal_tier iterm2)"
assert_eq "terminal.app is Tier 2" "2" "$(get_terminal_tier terminal.app)"
assert_eq "background is Tier 3" "3" "$(get_terminal_tier background)"

# ── 5. resolve_terminal() with config ──
echo ""
echo "── resolve_terminal() ──"

# Test auto (default) - should detect something
result=$(resolve_terminal)
assert_true "resolve_terminal returns non-empty" [[ -n "${result}" ]]

# Test explicit preference
python3 -c "
import json
with open('${WTM_CONFIG}') as f: config = json.load(f)
config['terminal'] = {'preferred': 'background', 'fallback_order': ['detected', 'tmux', 'background'], 'custom_launch_cmd': None}
with open('${WTM_CONFIG}', 'w') as f: json.dump(config, f, indent=2)
"
result=$(resolve_terminal)
assert_eq "resolve_terminal respects preferred=background" "background" "${result}"

# Reset config
python3 -c "
import json
with open('${WTM_CONFIG}') as f: config = json.load(f)
config['terminal']['preferred'] = 'auto'
with open('${WTM_CONFIG}', 'w') as f: json.dump(config, f, indent=2)
"

# ── 6. Wrapper script generation ──
echo ""
echo "── _generate_wrapper() ──"

WRAPPER=$(_generate_wrapper "test:feature-foo" "/tmp" "bash")
assert_true "wrapper file exists" [[ -f "${WRAPPER}" ]]
assert_true "wrapper is executable" [[ -x "${WRAPPER}" ]]
assert_true "wrapper contains SESSION_ID" grep -q "WTM_SESSION_ID" "${WRAPPER}"
assert_true "wrapper contains PID recording" grep -q "pid_data" "${WRAPPER}"
assert_true "wrapper contains cleanup trap" grep -q "trap _cleanup" "${WRAPPER}"
rm -f "${WRAPPER}"

# ── 7. _safe_id() ──
echo ""
echo "── _safe_id() ──"

assert_eq "colon replaced" "project_feature-foo" "$(_safe_id "project:feature-foo")"
assert_eq "slash replaced" "a_b_c" "$(_safe_id "a/b/c")"
assert_eq "mixed replaced" "p_type-name" "$(_safe_id "p:type-name")"

# ── 8. PID file operations ──
echo ""
echo "── PID file operations ──"

PID_FILE=$(_get_pid_file "test:session-1")
assert_true "PID file path contains pids dir" [[ "${PID_FILE}" == *"/pids/"* ]]
assert_eq "PID file path ends with .json" ".json" "${PID_FILE: -5}"

# ── 9. terminal_session_exists() ──
echo ""
echo "── terminal_session_exists() ──"

assert_false "non-existent session returns false" terminal_session_exists "nonexistent_session_xyz"

# Create a fake PID file for a running process ($$)
mkdir -p "${WTM_PIDS}"
_start_time=$(python3 -c 'import time; print(time.time())')
echo "{\"pid\": $$, \"start_time\": ${_start_time}}" > "${WTM_PIDS}/test_alive.json"
assert_true "existing PID file with live process returns true" terminal_session_exists "test_alive"

# Create a fake PID file for a dead process
echo '{"pid": 99999999, "start_time": 0}' > "${WTM_PIDS}/test_dead.json"
assert_false "PID file with dead process returns false" terminal_session_exists "test_dead"

# ── 10. send_terminal_command() pending-cd ──
echo ""
echo "── send_terminal_command() pending-cd ──"

# Create a fake session in sessions.json with non-tmux terminal
python3 -c "
import json
with open('${WTM_SESSIONS}') as f: data = json.load(f)
data['sessions']['test:cd-session'] = {
    'terminal': {'type': 'iterm2', 'session_name': None, 'pid': None, 'capabilities': ['launch']},
    'status': 'active'
}
with open('${WTM_SESSIONS}', 'w') as f: json.dump(data, f, indent=2)
"

send_terminal_command "test:cd-session" "cd '/tmp/test-worktree'" 2>/dev/null || true
SAFE=$(_safe_id "test:cd-session")
MARKER="${WTM_PENDING_CD}/${SAFE}"
assert_true "pending-cd marker created for Tier 2" [[ -f "${MARKER}" ]]
if [[ -f "${MARKER}" ]]; then
  CONTENT=$(cat "${MARKER}")
  assert_eq "pending-cd contains correct path" "/tmp/test-worktree" "${CONTENT}"
  rm -f "${MARKER}"
fi

# ── 11. check_terminal_alive() ──
echo ""
echo "── check_terminal_alive() ──"

# Create session with PID of current process
python3 -c "
import json, time, sys
with open(sys.argv[1]) as f: data = json.load(f)
data['sessions']['test:alive-check'] = {
    'terminal': {'type': 'background', 'session_name': None, 'pid': None, 'capabilities': ['launch']},
    'status': 'active'
}
with open(sys.argv[1], 'w') as f: json.dump(data, f, indent=2)
# Create PID file with the bash process PID (still alive)
pid_data = {'pid': int(sys.argv[3]), 'start_time': time.time(), 'command': 'bash', 'session_id': 'test:alive-check'}
with open(sys.argv[2], 'w') as f: json.dump(pid_data, f)
" "${WTM_SESSIONS}" "${WTM_PIDS}/test_alive-check.json" "$$"
assert_true "check_terminal_alive for live PID" check_terminal_alive "test:alive-check"

# Create session with dead PID
python3 -c "
import json
with open('${WTM_SESSIONS}') as f: data = json.load(f)
data['sessions']['test:dead-check'] = {
    'terminal': {'type': 'background', 'session_name': None, 'pid': None, 'capabilities': ['launch']},
    'status': 'active'
}
with open('${WTM_SESSIONS}', 'w') as f: json.dump(data, f, indent=2)
"
echo '{"pid": 99999999, "start_time": 0, "command": "bash", "session_id": "test:dead-check"}' > "${WTM_PIDS}/test_dead-check.json"
assert_false "check_terminal_alive for dead PID" check_terminal_alive "test:dead-check"

# ── Summary ──
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Results: ${TT_PASSED}/${TT_RUN} passed, ${TT_FAILED} failed"
echo "═══════════════════════════════════════════════════════"
echo ""

# Use return when sourced by test-runner, exit when standalone
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  [[ ${TT_FAILED} -eq 0 ]] && exit 0 || exit 1
else
  [[ ${TT_FAILED} -eq 0 ]] && return 0 || return 1
fi
