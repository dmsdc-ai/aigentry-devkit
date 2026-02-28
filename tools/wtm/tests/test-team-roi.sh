#!/usr/bin/env bash
# Test: Phase 5 Team & ROI libraries - template, metrics, notify, share

echo "  === Team & ROI Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
set +e  # Allow non-zero exits in tests

# Override paths to use test env (common.sh set them before setup_test_env)
export WTM_METRICS="${WTM_HOME}/metrics.json"
export WTM_SHARE_DIR="${WTM_HOME}/shares"
export WTM_TEMPLATES="${WTM_HOME}/templates"
export WTM_SHARE_DIR="${WTM_HOME}/shares"

# ─── Template Tests ─────────────────────────────────────────────────────────

echo ""
echo "  -- template.sh --"

# Create test template JSON
mkdir -p "${WTM_TEMPLATES}"
python3 -c "
import json
t = {
  'name': 'test-template',
  'description': 'Test template',
  'type': 'feature',
  'setup_commands': ['echo hello']
}
with open('${WTM_TEMPLATES}/test-template.json', 'w') as f:
    json.dump(t, f, indent=2)
"

# Test 1: list_templates includes test-template
output=$(list_templates 2>/dev/null)
assert_contains "${output}" "test-template" "list_templates shows test-template"

# Test 2: show_template prints name
output=$(show_template "test-template" 2>/dev/null)
assert_contains "${output}" "test-template" "show_template prints name"

# Test 3: show_template prints description
assert_contains "${output}" "Test template" "show_template prints description"

# Test 4: show_template prints type
assert_contains "${output}" "feature" "show_template prints type"

# Test 5: show_template fails on missing template
show_template "no-such-template" >/dev/null 2>&1
result=$?
assert_eq "1" "${result}" "show_template returns 1 for missing template"

# Test 6: apply_template returns JSON
json_out=$(apply_template "test-template" 2>/dev/null)
assert_contains "${json_out}" "test-template" "apply_template returns JSON with name"

# ─── Metrics Tests ───────────────────────────────────────────────────────────

echo ""
echo "  -- metrics.sh --"

# Test 7: init_metrics creates file
init_metrics
assert_file_exists "${WTM_METRICS}" "init_metrics creates metrics.json"

# Test 8: init_metrics creates valid JSON with version field
version=$(python3 -c "import json; print(json.load(open('${WTM_METRICS}')).get('version',0))")
assert_eq "1" "${version}" "metrics.json has version=1"

# Test 9: get_metric returns 0 for untracked key
val=$(get_metric "sessions_created" "lifetime")
assert_eq "0" "${val}" "get_metric returns 0 for fresh sessions_created"

# Test 10: track_metric increments sessions_created
track_metric "sessions_created" 1
val=$(get_metric "sessions_created" "lifetime")
assert_eq "1" "${val}" "track_metric increments sessions_created to 1"

# Test 11: track_metric increments again
track_metric "sessions_created" 1
val=$(get_metric "sessions_created" "lifetime")
assert_eq "2" "${val}" "track_metric increments sessions_created to 2"

# Test 12: track_metric supports custom increment
track_metric "minutes_saved" 10
val=$(get_metric "minutes_saved" "lifetime")
assert_eq "10" "${val}" "track_metric increments minutes_saved by 10"

# Test 13: get_metric daily scope
val_daily=$(get_metric "sessions_created" "daily")
assert_eq "2" "${val_daily}" "get_metric daily scope matches tracked value"

# Test 14: generate_report runs without error
report=$(generate_report "lifetime" 2>/dev/null)
assert_contains "${report}" "WTM Metrics Report" "generate_report outputs header"

# Test 15: generate_report shows sessions_created count
assert_contains "${report}" "2" "generate_report shows sessions_created=2"

# Test 16: generate_report daily period
report_daily=$(generate_report "daily" 2>/dev/null)
assert_contains "${report_daily}" "WTM Metrics Report" "generate_report daily period works"

# Test 17: generate_report weekly period
report_weekly=$(generate_report "weekly" 2>/dev/null)
assert_contains "${report_weekly}" "WTM Metrics Report" "generate_report weekly period works"

# ─── Notify Tests ────────────────────────────────────────────────────────────

echo ""
echo "  -- notify.sh --"

# Test 18: send_notification function is declared
if declare -f send_notification >/dev/null 2>&1; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: send_notification function is declared"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: send_notification function is not declared"
fi

# Test 19: send_notification accepts 3 args without crashing
# Use a config with no webhooks so no real network call is made
send_notification "Test Title" "Test message" "low" >/dev/null 2>&1
result=$?
assert_eq "0" "${result}" "send_notification returns 0 with no webhooks configured"

# Test 20: send_notification urgency defaults (2 args)
send_notification "Title" "Message" >/dev/null 2>&1
result=$?
assert_eq "0" "${result}" "send_notification works with 2 args (default urgency)"

# ─── Share Tests ─────────────────────────────────────────────────────────────

echo ""
echo "  -- share.sh --"

# Set up a fake git repo as worktree for export testing
FAKE_WORKTREE="${TEST_TMPDIR}/fake-worktree"
mkdir -p "${FAKE_WORKTREE}"
git -C "${FAKE_WORKTREE}" init -q
git -C "${FAKE_WORKTREE}" config user.email "test@test.com"
git -C "${FAKE_WORKTREE}" config user.name "Test"

# Create initial commit so branch exists
echo "test" > "${FAKE_WORKTREE}/README.md"
git -C "${FAKE_WORKTREE}" add README.md
git -C "${FAKE_WORKTREE}" commit -q -m "init"

SHARE_SESSION_ID="shareproj:feat-share-test"

# Register session with worktree in sessions.json
python3 -c "
import json
with open('${WTM_SESSIONS}', 'r') as f:
    data = json.load(f)
data.setdefault('sessions', {})['${SHARE_SESSION_ID}'] = {
    'id': '${SHARE_SESSION_ID}',
    'project': 'shareproj',
    'type': 'feat',
    'name': 'share-test',
    'branch': 'feat/share-test',
    'base_branch': 'main',
    'status': 'active',
    'worktree': '${FAKE_WORKTREE}',
    'tags': [],
    'symlink_patterns': []
}
with open('${WTM_SESSIONS}', 'w') as f:
    json.dump(data, f, indent=2)
"

# Test 21: export_session function is declared
if declare -f export_session >/dev/null 2>&1; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: export_session function is declared"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: export_session function is not declared"
fi

# Test 22: export_session creates a tar.gz file
mkdir -p "${WTM_SHARE_DIR}"
exported_path=$(export_session "${SHARE_SESSION_ID}" 2>/dev/null | tail -1)
assert_file_exists "${exported_path}" "export_session creates tar.gz bundle"

# Test 23: exported file is a valid tar.gz (ends with .tar.gz)
assert_contains "${exported_path}" ".tar.gz" "export_session output path ends with .tar.gz"

# Test 24: tar.gz contains session.json
if [[ -f "${exported_path}" ]]; then
  tar_contents=$(tar -tzf "${exported_path}" 2>/dev/null)
  assert_contains "${tar_contents}" "session.json" "exported bundle contains session.json"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: exported bundle contains session.json (bundle not created)"
fi

# Test 25: export_session fails on missing session
bad_export=$(export_session "no-such-session:feat-x" 2>/dev/null)
result=$?
assert_eq "1" "${result}" "export_session returns 1 for missing session"

# Test 26: import_session function is declared
if declare -f import_session >/dev/null 2>&1; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: import_session function is declared"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: import_session function is not declared"
fi

# Test 27: import_session round-trip - re-import the exported bundle
if [[ -f "${exported_path}" ]]; then
  # Remove the session first so we can test import
  python3 -c "
import json
with open('${WTM_SESSIONS}', 'r') as f:
    data = json.load(f)
data.get('sessions', {}).pop('${SHARE_SESSION_ID}', None)
with open('${WTM_SESSIONS}', 'w') as f:
    json.dump(data, f, indent=2)
"
  imported_id=$(import_session "${exported_path}" 2>/dev/null | tail -1)
  assert_eq "${SHARE_SESSION_ID}" "${imported_id}" "import_session returns correct session id"
fi

# Test 28: import_session fails on missing bundle
import_session "/tmp/no-such-bundle.tar.gz" >/dev/null 2>&1
result=$?
assert_eq "1" "${result}" "import_session returns 1 for missing bundle"

# ─── Cleanup ─────────────────────────────────────────────────────────────────

teardown_test_env
