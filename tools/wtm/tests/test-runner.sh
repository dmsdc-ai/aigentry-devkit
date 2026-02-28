#!/usr/bin/env bash
# WTM Test Runner - Minimal bash test framework
# Usage: bash tests/test-runner.sh [test-file...]

set -uo pipefail

TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0
TEST_TMPDIR=""

# Setup isolated test environment
setup_test_env() {
  TEST_TMPDIR=$(mktemp -d /tmp/wtm-test.XXXXXX)
  export WTM_HOME="${TEST_TMPDIR}/.wtm"
  export WTM_SESSIONS="${WTM_HOME}/sessions.json"
  export WTM_PROJECTS="${WTM_HOME}/projects.json"
  export WTM_WORKTREES="${WTM_HOME}/worktrees"
  export WTM_LOGS="${WTM_HOME}/logs"
  export WTM_WATCHERS="${WTM_HOME}/watchers"
  mkdir -p "${WTM_HOME}"/{bin,lib,logs,worktrees,watchers,locks,journals,backups,contexts,migrations,hooks,templates,plugins,pids,tmp,pending-cd}
  echo '{"version":1,"sessions":{}}' > "${WTM_SESSIONS}"
  echo '{"aliases":{},"defaults":{"worktree_root":"~/.wtm/worktrees","cleanup_after_days":14}}' > "${WTM_PROJECTS}"
}

# Cleanup test environment
teardown_test_env() {
  [[ -n "${TEST_TMPDIR}" ]] && rm -rf "${TEST_TMPDIR}"
}

# Assertion functions
assert_eq() {
  local expected="$1" actual="$2" msg="${3:-assertion}"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [[ "${expected}" == "${actual}" ]]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  PASS: ${msg}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  FAIL: ${msg} (expected='${expected}', actual='${actual}')"
  fi
}

assert_ok() {
  local msg="${1:-command succeeds}"
  shift
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if "$@" >/dev/null 2>&1; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  PASS: ${msg}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  FAIL: ${msg} (command failed: $*)"
  fi
}

assert_fail() {
  local msg="${1:-command fails}"
  shift
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if "$@" >/dev/null 2>&1; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  FAIL: ${msg} (expected failure but succeeded: $*)"
  else
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  PASS: ${msg}"
  fi
}

assert_file_exists() {
  local path="$1" msg="${2:-file exists: ${path}}"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [[ -e "${path}" ]]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  PASS: ${msg}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  FAIL: ${msg}"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" msg="${3:-contains check}"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [[ "${haystack}" == *"${needle}"* ]]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  PASS: ${msg}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  FAIL: ${msg} ('${haystack}' does not contain '${needle}')"
  fi
}

# Print test summary
print_summary() {
  echo ""
  echo "  ═══════════════════════════════"
  echo "  Tests:  ${TESTS_TOTAL}"
  echo "  Passed: ${TESTS_PASSED}"
  echo "  Failed: ${TESTS_FAILED}"
  echo "  ═══════════════════════════════"
  echo ""
  [[ ${TESTS_FAILED} -eq 0 ]] && return 0 || return 1
}

# Run test files
if [[ $# -gt 0 ]]; then
  test_files=("$@")
else
  test_files=()
  for _f in "${HOME}/.wtm/tests"/test-*.sh; do
    [[ "$(basename "$_f")" == "test-runner.sh" ]] && continue
    [[ -f "$_f" ]] && test_files+=("$_f")
  done
fi

if [[ ${#test_files[@]} -eq 0 ]]; then
  echo "No test files found."
  exit 0
fi

for test_file in "${test_files[@]}"; do
  echo ""
  echo "━━━ Running: $(basename "${test_file}") ━━━"
  source "${test_file}"
done

print_summary
