#!/usr/bin/env bash
# Test: Phase 2 automation libraries - defaults.sh, ttl.sh, disk.sh, cache.sh
echo "  === Automation Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
set +e  # Allow non-zero exits in tests

# Create test config.json in test env
echo '{"defaults":{"ttl_hours":48},"display":{"color":true}}' > "${WTM_HOME}/config.json"

# Override WTM_CONFIG to point to test env
export WTM_CONFIG="${WTM_HOME}/config.json"
export WTM_CACHE_ROOT="${WTM_HOME}/shared-cache"

# ─── defaults.sh Tests ───
echo ""
echo "  -- defaults.sh --"

# Test 1: init_config - skips if file exists
init_config
assert_file_exists "${WTM_CONFIG}" "init_config skips existing config"

# Test 2: get_config - dot notation for existing key
ttl_val=$(get_config "defaults.ttl_hours")
assert_eq "48" "${ttl_val}" "get_config reads defaults.ttl_hours"

# Test 3: get_config - nested key display.color
color_val=$(get_config "display.color")
assert_eq "true" "${color_val}" "get_config reads display.color"

# Test 4: get_config - missing key exits 1
if get_config "nonexistent.key" >/dev/null 2>&1; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: get_config missing key should fail"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: get_config missing key exits 1"
fi

# Test 5: set_config - write a new string value
set_config "defaults.session_type" "bugfix"
new_type=$(get_config "defaults.session_type")
assert_eq "bugfix" "${new_type}" "set_config writes string value"

# Test 6: set_config - write a numeric value
set_config "defaults.ttl_hours" "72"
new_ttl=$(get_config "defaults.ttl_hours")
assert_eq "72" "${new_ttl}" "set_config writes numeric value"

# Test 7: set_config - write a boolean JSON literal
set_config "display.color" "false"
new_color=$(get_config "display.color")
assert_eq "false" "${new_color}" "set_config writes boolean false"

# Test 8: init_config on missing file creates defaults
rm -f "${WTM_CONFIG}"
init_config
assert_file_exists "${WTM_CONFIG}" "init_config creates config when missing"
session_type_default=$(get_config "defaults.session_type")
assert_eq "feature" "${session_type_default}" "init_config writes default session_type"

# Restore test config for remaining tests
echo '{"defaults":{"ttl_hours":48},"display":{"color":true}}' > "${WTM_CONFIG}"

# ─── ttl.sh Tests ───
echo ""
echo "  -- ttl.sh --"

# Create sessions with old and recent timestamps for TTL tests
python3 -c "
import json
data = {
  'version': 3,
  'sessions': {
    'proj:feat-old': {
      'project': 'proj',
      'type': 'feat',
      'name': 'old',
      'branch': 'feat/old',
      'status': 'active',
      'created_at': '2025-01-01T00:00:00Z',
      'ttl_hours': 168
    },
    'proj:feat-recent': {
      'project': 'proj',
      'type': 'feat',
      'name': 'recent',
      'branch': 'feat/recent',
      'status': 'active',
      'created_at': '2099-01-01T00:00:00Z',
      'ttl_hours': 168
    },
    'proj:feat-unknown': {
      'project': 'proj',
      'type': 'feat',
      'name': 'unknown',
      'branch': 'feat/unknown',
      'status': 'active'
    }
  }
}
with open('${WTM_SESSIONS}', 'w') as f:
    json.dump(data, f, indent=2)
"

# Test 9: check_session_ttl - old session should be EXPIRED
ttl_result=$(check_session_ttl "proj:feat-old")
assert_contains "${ttl_result}" "EXPIRED" "check_session_ttl detects expired session"

# Test 10: check_session_ttl - future session should be ACTIVE
ttl_active=$(check_session_ttl "proj:feat-recent")
assert_contains "${ttl_active}" "ACTIVE" "check_session_ttl detects active session"

# Test 11: check_session_ttl - missing session returns UNKNOWN
ttl_missing=$(check_session_ttl "proj:feat-doesnotexist")
assert_eq "UNKNOWN" "${ttl_missing}" "check_session_ttl returns UNKNOWN for missing session"

# Test 12: check_session_ttl - session with no created_at returns UNKNOWN
ttl_no_ts=$(check_session_ttl "proj:feat-unknown")
assert_eq "UNKNOWN" "${ttl_no_ts}" "check_session_ttl returns UNKNOWN when no created_at"

# Test 13: list_expired_sessions - lists old session
expired_list=$(list_expired_sessions)
assert_contains "${expired_list}" "proj:feat-old" "list_expired_sessions includes old session"

# Test 14: list_expired_sessions - does not list future session
if echo "${expired_list}" | grep -q "proj:feat-recent"; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: list_expired_sessions should not include future session"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: list_expired_sessions excludes active session"
fi

# ─── disk.sh Tests ───
echo ""
echo "  -- disk.sh --"

# Create a temp worktree dir with some files for disk tests
test_worktree="${WTM_WORKTREES}/test-wt"
mkdir -p "${test_worktree}"
# Write ~4KB of data to ensure non-zero usage
python3 -c "
import os
path = '${test_worktree}/testfile.txt'
with open(path, 'w') as f:
    f.write('x' * 4096)
"

# Test 15: get_worktree_disk_usage - returns non-empty size string
wt_usage=$(get_worktree_disk_usage "${test_worktree}")
assert_contains "${wt_usage}" "K" "get_worktree_disk_usage returns size with K suffix"

# Test 16: get_worktree_disk_usage - non-existent dir returns 0K
usage_missing=$(get_worktree_disk_usage "/tmp/wtm-nonexistent-dir-$$")
assert_eq "0K" "${usage_missing}" "get_worktree_disk_usage returns 0K for missing dir"

# Test 17: get_total_wtm_disk_usage - returns a size string for WTM_WORKTREES
total_usage=$(get_total_wtm_disk_usage)
# Should be a valid size string (K/M/G suffix or 0K)
assert_contains "${total_usage}" "K" "get_total_wtm_disk_usage returns size string"

# Test 18: get_total_wtm_disk_usage - no worktrees dir returns 0K
old_wt="${WTM_WORKTREES}"
export WTM_WORKTREES="/tmp/wtm-no-wt-dir-$$"
total_missing=$(get_total_wtm_disk_usage)
assert_eq "0K" "${total_missing}" "get_total_wtm_disk_usage returns 0K when no worktrees dir"
export WTM_WORKTREES="${old_wt}"

# Test 19: check_disk_warning - under threshold returns 0
export WTM_DISK_WARNING_MB=999999
check_disk_warning
assert_eq "0" "$?" "check_disk_warning returns 0 under threshold"

# Test 20: check_disk_warning - over threshold returns 1
export WTM_DISK_WARNING_MB=0
disk_warn_rc=0
check_disk_warning >/dev/null 2>&1 || disk_warn_rc=$?
assert_eq "1" "${disk_warn_rc}" "check_disk_warning returns 1 over threshold"
export WTM_DISK_WARNING_MB=5120

# ─── cache.sh Tests ───
echo ""
echo "  -- cache.sh --"

# Test 21: BUILD_CACHE_PATTERNS array exists and has entries
pattern_count="${#BUILD_CACHE_PATTERNS[@]}"
if (( pattern_count > 0 )); then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: BUILD_CACHE_PATTERNS array has ${pattern_count} entries"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: BUILD_CACHE_PATTERNS array is empty"
fi

# Test 22: BUILD_CACHE_PATTERNS contains .turbo entry
found_turbo=false
for p in "${BUILD_CACHE_PATTERNS[@]}"; do
  [[ "${p}" == ".turbo:dir" ]] && found_turbo=true && break
done
if $found_turbo; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: BUILD_CACHE_PATTERNS contains .turbo:dir"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: BUILD_CACHE_PATTERNS missing .turbo:dir"
fi

# Test 23: setup_build_cache_symlinks - creates symlinks in worktree
cache_source="/tmp/wtm-cache-src-$$"
cache_worktree="${WTM_WORKTREES}/cache-wt-$$"
mkdir -p "${cache_source}" "${cache_worktree}"
setup_build_cache_symlinks "${cache_source}" "${cache_worktree}" >/dev/null 2>&1
# Check that at least one symlink was created
link_count=$(find "${cache_worktree}" -maxdepth 1 -type l 2>/dev/null | wc -l | tr -d ' ')
if (( link_count > 0 )); then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: setup_build_cache_symlinks created ${link_count} symlink(s)"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: setup_build_cache_symlinks created no symlinks"
fi

# Test 24: setup_build_cache_symlinks - skips non-existent worktree
setup_build_cache_symlinks "${cache_source}" "/tmp/wtm-no-wt-$$" >/dev/null 2>&1
assert_eq "0" "$?" "setup_build_cache_symlinks returns 0 for missing worktree"

# Test 25: setup_build_cache_symlinks - real dir in worktree not overridden
real_dir_wt="${WTM_WORKTREES}/real-dir-wt-$$"
mkdir -p "${real_dir_wt}/.turbo"
setup_build_cache_symlinks "${cache_source}" "${real_dir_wt}" >/dev/null 2>&1
# .turbo should still be a real directory, not a symlink
if [[ -d "${real_dir_wt}/.turbo" ]] && [[ ! -L "${real_dir_wt}/.turbo" ]]; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: setup_build_cache_symlinks skips real dir .turbo"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: setup_build_cache_symlinks should not replace real dir"
fi

# Test 26: get_cache_stats - no cache root returns no-cache message
old_cache_root="${WTM_CACHE_ROOT}"
export WTM_CACHE_ROOT="/tmp/wtm-no-cache-$$"
stats_missing=$(get_cache_stats)
assert_contains "${stats_missing}" "No shared build caches" "get_cache_stats reports no caches when root missing"
export WTM_CACHE_ROOT="${old_cache_root}"

# Test 27: get_cache_stats - after setup_build_cache_symlinks shows stats
stats_output=$(get_cache_stats)
assert_contains "${stats_output}" "Cache root:" "get_cache_stats shows cache root"

# Test 28: get_cache_stats - output contains entries count
assert_contains "${stats_output}" "entries" "get_cache_stats output contains entries count"

# Cleanup temp dirs
rm -rf "${cache_source}" "${cache_worktree}" "${real_dir_wt}"

teardown_test_env
