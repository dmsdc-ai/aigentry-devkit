#!/usr/bin/env bash
# Test: flock-based locking
echo "  === Lock Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
source "${HOME}/.wtm/lib/atomic.sh"

# Override WTM_LOCKS for test
export WTM_LOCKS="${WTM_HOME}/locks"
mkdir -p "${WTM_LOCKS}"

# Test 1: Acquire and release lock
fd=$(acquire_lock "test-resource" 5)
assert_ok "acquire lock returns fd" test -n "${fd}"
release_lock "${fd}"
echo "  PASS: acquire and release lock"
TESTS_PASSED=$((TESTS_PASSED + 1))
TESTS_TOTAL=$((TESTS_TOTAL + 1))

# Test 2: with_lock runs command
output=$(with_lock "test-resource2" echo "locked-output")
assert_contains "${output}" "locked-output" "with_lock executes command"

# Test 3: Lock file created
fd2=$(acquire_lock "test-resource3" 5)
assert_file_exists "${WTM_LOCKS}/test-resource3.lock" "lock file created"
release_lock "${fd2}"

# Test 4: Journal begin creates file
source "${HOME}/.wtm/lib/atomic.sh"
export WTM_HOME="${TEST_TMPDIR}/.wtm"
export WTM_JOURNALS="${WTM_HOME}/journals"
mkdir -p "${WTM_JOURNALS}"
journal_file=$(journal_begin "test-op")
assert_ok "journal file created" test -f "${journal_file}"

teardown_test_env
