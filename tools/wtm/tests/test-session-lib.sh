#!/usr/bin/env bash
# Test: Phase 1 remaining libraries - session.sh, project.sh, ui.sh, conflict.sh
echo "  === Session/Project/UI/Conflict Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
set +e  # Allow non-zero exits in tests

# ---------------------------------------------------------------------------
# Helper: write test sessions JSON
# ---------------------------------------------------------------------------
python3 - "${WTM_SESSIONS}" <<'PYEOF'
import json, sys

data = {
    "version": 3,
    "sessions": {
        "myproj:feat-login": {
            "project": "myproj",
            "type": "feat",
            "name": "login",
            "branch": "feat/login",
            "worktree": "/tmp/worktrees/myproj-feat-login",
            "status": "active"
        },
        "myproj:fix-crash": {
            "project": "myproj",
            "type": "fix",
            "name": "crash",
            "branch": "fix/crash",
            "worktree": "/tmp/worktrees/myproj-fix-crash",
            "status": "stopped"
        },
        "otherproj:feat-api": {
            "project": "otherproj",
            "type": "feat",
            "name": "api",
            "branch": "feat/api",
            "worktree": "/tmp/worktrees/otherproj-feat-api",
            "status": "active"
        },
        "myproj:fix-memleak": {
            "project": "myproj",
            "type": "fix",
            "name": "memleak",
            "branch": "fix/memleak",
            "worktree": "/tmp/worktrees/myproj-fix-memleak",
            "status": "error"
        }
    }
}

with open(sys.argv[1], "w") as f:
    json.dump(data, f, indent=2)
PYEOF

# ---------------------------------------------------------------------------
# Helper: write test projects JSON
# ---------------------------------------------------------------------------
python3 - "${WTM_PROJECTS}" <<'PYEOF'
import json, sys

data = {
    "aliases": {
        "myproj": {
            "repo": "git@github.com:example/myproj.git",
            "local": "/Users/testuser/Projects/myproj",
            "default_base": "main"
        },
        "otherproj": {
            "repo": "git@github.com:example/otherproj.git",
            "local": "/Users/testuser/Projects/otherproj",
            "default_base": "develop"
        }
    },
    "defaults": {
        "worktree_root": "~/.wtm/worktrees",
        "cleanup_after_days": 14
    }
}

with open(sys.argv[1], "w") as f:
    json.dump(data, f, indent=2)
PYEOF

# ===========================================================================
# session.sh tests
# ===========================================================================
echo ""
echo "  --- session.sh ---"

# Test 1: get_session_field - existing field
val=$(get_session_field "myproj:feat-login" "branch")
assert_eq "feat/login" "${val}" "get_session_field: branch value correct"

# Test 2: get_session_field - status field
val=$(get_session_field "myproj:feat-login" "status")
assert_eq "active" "${val}" "get_session_field: status value correct"

# Test 3: get_session_field - missing session returns nonzero
assert_fail "get_session_field nonexistent fails" get_session_field "no-such-session" "branch"

# Test 4: get_session_field - missing field returns nonzero
assert_fail "get_session_field missing field fails" get_session_field "myproj:feat-login" "nonexistent_field"

# Test 5: list_sessions_by_project - myproj has 3 sessions
output=$(list_sessions_by_project "myproj")
count=$(echo "${output}" | grep -c "myproj" || true)
assert_eq "3" "${count}" "list_sessions_by_project: myproj has 3 sessions"

# Test 6: list_sessions_by_project - otherproj has 1 session
output=$(list_sessions_by_project "otherproj")
assert_contains "${output}" "otherproj:feat-api" "list_sessions_by_project: otherproj:feat-api listed"

# Test 7: list_sessions_by_project - unknown project yields empty
output=$(list_sessions_by_project "unknown-project")
assert_eq "" "${output}" "list_sessions_by_project: unknown project yields empty"

# Test 8: list_sessions_by_status - active
output=$(list_sessions_by_status "active")
assert_contains "${output}" "myproj:feat-login" "list_sessions_by_status: active includes feat-login"
assert_contains "${output}" "otherproj:feat-api" "list_sessions_by_status: active includes feat-api"

# Test 9: list_sessions_by_status - stopped
output=$(list_sessions_by_status "stopped")
assert_contains "${output}" "myproj:fix-crash" "list_sessions_by_status: stopped includes fix-crash"

# Test 10: list_sessions_by_status - error
output=$(list_sessions_by_status "error")
assert_contains "${output}" "myproj:fix-memleak" "list_sessions_by_status: error includes fix-memleak"

# Test 11: list_sessions_by_status - nonexistent status yields empty
output=$(list_sessions_by_status "totally-unknown")
assert_eq "" "${output}" "list_sessions_by_status: unknown status yields empty"

# Test 12: count_sessions - total (4 sessions)
total=$(count_sessions)
assert_eq "4" "${total}" "count_sessions: total is 4"

# Test 13: count_sessions - filtered by project
myproj_count=$(count_sessions "myproj")
assert_eq "3" "${myproj_count}" "count_sessions: myproj has 3"

# Test 14: count_sessions - filtered by other project
other_count=$(count_sessions "otherproj")
assert_eq "1" "${other_count}" "count_sessions: otherproj has 1"

# Test 15: count_sessions - unknown project yields 0
none=$(count_sessions "no-such")
assert_eq "0" "${none}" "count_sessions: unknown project yields 0"

# Test 16: session_exists - existing session returns 0
assert_ok "session_exists: existing session" session_exists "myproj:feat-login"

# Test 17: session_exists - nonexistent session returns 1
assert_fail "session_exists: nonexistent session fails" session_exists "no-such-session"

# Test 18: get_session_worktree - returns correct path
wt=$(get_session_worktree "myproj:feat-login")
assert_eq "/tmp/worktrees/myproj-feat-login" "${wt}" "get_session_worktree: correct path"

# Test 19: get_session_worktree - nonexistent session returns nonzero
assert_fail "get_session_worktree: nonexistent session fails" get_session_worktree "no-such"

# Test 20: update_session_status - status changes
update_session_status "myproj:feat-login" "lazy"
new_status=$(get_session_field "myproj:feat-login" "status")
assert_eq "lazy" "${new_status}" "update_session_status: status updated to lazy"

# Test 21: update_session_status - updated_at field is set
updated_at=$(get_session_field "myproj:feat-login" "updated_at")
assert_contains "${updated_at}" "T" "update_session_status: updated_at is an ISO timestamp"

# Test 22: update_session_status - nonexistent session returns nonzero
assert_fail "update_session_status: nonexistent session fails" update_session_status "ghost-session" "active"

# ===========================================================================
# project.sh tests
# ===========================================================================
echo ""
echo "  --- project.sh ---"

# Test 23: list_projects - both aliases present
proj_list=$(list_projects)
assert_contains "${proj_list}" "myproj" "list_projects: myproj listed"
assert_contains "${proj_list}" "otherproj" "list_projects: otherproj listed"

# Test 24: project_exists - known alias returns 0
assert_ok "project_exists: myproj exists" project_exists "myproj"

# Test 25: project_exists - unknown alias returns nonzero
assert_fail "project_exists: unknown project fails" project_exists "does-not-exist"

# Test 26: get_project_field - repo field
repo=$(get_project_field "myproj" "repo")
assert_eq "git@github.com:example/myproj.git" "${repo}" "get_project_field: repo correct"

# Test 27: get_project_field - default_base field
base=$(get_project_field "otherproj" "default_base")
assert_eq "develop" "${base}" "get_project_field: default_base correct"

# Test 28: get_project_field - missing alias returns nonzero
assert_fail "get_project_field: missing alias fails" get_project_field "no-alias" "repo"

# Test 29: get_project_field - missing field returns nonzero
assert_fail "get_project_field: missing field fails" get_project_field "myproj" "nonexistent"

# Test 30: get_project_local - shortcut returns local path
local_path=$(get_project_local "myproj")
assert_eq "/Users/testuser/Projects/myproj" "${local_path}" "get_project_local: correct path"

# Test 31: get_project_local - nonexistent alias returns nonzero
assert_fail "get_project_local: nonexistent alias fails" get_project_local "ghost"

# Test 32: count_project_sessions - myproj has 3 sessions
cnt=$(count_project_sessions "myproj")
assert_eq "3" "${cnt}" "count_project_sessions: myproj has 3"

# Test 33: count_project_sessions - otherproj has 1 session
cnt2=$(count_project_sessions "otherproj")
assert_eq "1" "${cnt2}" "count_project_sessions: otherproj has 1"

# Test 34: count_project_sessions - unknown project has 0
cnt3=$(count_project_sessions "ghost")
assert_eq "0" "${cnt3}" "count_project_sessions: unknown project yields 0"

# Test 35: register_project - new project added
register_project "newproj" "git@github.com:example/new.git" "/Users/testuser/Projects/new" "main"
assert_ok "register_project: new project exists after register" project_exists "newproj"

# Test 36: register_project - repo field stored correctly
new_repo=$(get_project_field "newproj" "repo")
assert_eq "git@github.com:example/new.git" "${new_repo}" "register_project: repo stored"

# Test 37: register_project - local field stored correctly
new_local=$(get_project_local "newproj")
assert_eq "/Users/testuser/Projects/new" "${new_local}" "register_project: local stored"

# Test 38: register_project - default_base stored correctly
new_base=$(get_project_field "newproj" "default_base")
assert_eq "main" "${new_base}" "register_project: default_base stored"

# Test 39: register_project - duplicate alias fails
assert_fail "register_project: duplicate alias fails" register_project "myproj" "git@github.com:x/y.git" "/x/y" "main"

# ===========================================================================
# ui.sh tests
# ===========================================================================
echo ""
echo "  --- ui.sh ---"

# Test 40: format_duration - hours and minutes
result=$(format_duration 90)
assert_eq "1h 30m" "${result}" "format_duration: 90 min -> 1h 30m"

# Test 41: format_duration - minutes only
result=$(format_duration 45)
assert_eq "45m" "${result}" "format_duration: 45 min -> 45m"

# Test 42: format_duration - whole hours
result=$(format_duration 120)
assert_eq "2h 0m" "${result}" "format_duration: 120 min -> 2h 0m"

# Test 43: format_duration - zero
result=$(format_duration 0)
assert_eq "0m" "${result}" "format_duration: 0 min -> 0m"

# Test 44: format_duration - single minute
result=$(format_duration 1)
assert_eq "1m" "${result}" "format_duration: 1 min -> 1m"

# Test 45: format_bytes - kilobytes (< 1024)
result=$(format_bytes 512)
assert_eq "512K" "${result}" "format_bytes: 512 -> 512K"

# Test 46: format_bytes - megabytes
result=$(format_bytes 2048)
assert_eq "2.0M" "${result}" "format_bytes: 2048 -> 2.0M"

# Test 47: format_bytes - gigabytes
result=$(format_bytes 1572864)
assert_eq "1.5G" "${result}" "format_bytes: 1572864 -> 1.5G"

# Test 48: format_bytes - zero
result=$(format_bytes 0)
assert_eq "0K" "${result}" "format_bytes: 0 -> 0K"

# Test 49: truncate - short string unchanged
result=$(truncate "hello" 20)
assert_eq "hello" "${result}" "truncate: short string unchanged"

# Test 50: truncate - exact length unchanged
result=$(truncate "1234567890" 10)
assert_eq "1234567890" "${result}" "truncate: exact length unchanged"

# Test 51: truncate - long string truncated with ellipsis
result=$(truncate "abcdefghijklmnopqrstuvwxyz" 10)
assert_eq "abcdefg..." "${result}" "truncate: long string gets ellipsis"

# Test 52: truncate - uses default max_len of 20
long="abcdefghijklmnopqrstuvwxyz"
result=$(truncate "${long}" 20)
assert_eq "abcdefghijklmnopq..." "${result}" "truncate: default max_len=20 works"

# Test 53: color_status - active contains the word active
result=$(color_status "active")
assert_contains "${result}" "active" "color_status: active output contains 'active'"

# Test 54: color_status - lazy contains the word lazy
result=$(color_status "lazy")
assert_contains "${result}" "lazy" "color_status: lazy output contains 'lazy'"

# Test 55: color_status - stopped contains the word stopped
result=$(color_status "stopped")
assert_contains "${result}" "stopped" "color_status: stopped output contains 'stopped'"

# Test 56: color_status - error contains the word error
result=$(color_status "error")
assert_contains "${result}" "error" "color_status: error output contains 'error'"

# Test 57: color_status - unknown passes through unchanged
result=$(color_status "pending")
assert_eq "pending" "${result}" "color_status: unknown status passed through"

# ===========================================================================
# conflict.sh tests
# ===========================================================================
echo ""
echo "  --- conflict.sh ---"

# Test 58: detect_branch_conflicts function exists
assert_ok "detect_branch_conflicts function exists" bash -c 'source "${HOME}/.wtm/lib/common.sh" && declare -f detect_branch_conflicts > /dev/null'

# Test 59: suggest_conflict_resolution function exists
assert_ok "suggest_conflict_resolution function exists" bash -c 'source "${HOME}/.wtm/lib/common.sh" && declare -f suggest_conflict_resolution > /dev/null'

# Test 60: detect_branch_conflicts - returns nonzero for missing worktree
result=0
detect_branch_conflicts "/nonexistent/worktree/path" "main" 2>/dev/null || result=$?
assert_eq "1" "${result}" "detect_branch_conflicts: missing worktree returns 1"

teardown_test_env
