#!/usr/bin/env bash
# Test: Context journal and handoff
echo "  === Context Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
source "${HOME}/.wtm/lib/atomic.sh"
source "${HOME}/.wtm/lib/context.sh"

# Setup v3 session
cat > "${WTM_SESSIONS}" <<'EOJSON'
{"version":3,"sessions":{
  "proj:feat-test":{"project":"proj","type":"feat","name":"test","branch":"feat/test","status":"active","context":{"journal_path":null,"last_handoff":null,"conversation_refs":[]},"cross_project":{},"machine":{}}
}}
EOJSON

# Test 1: get_context_dir
dir=$(get_context_dir "proj:feat-test")
assert_contains "${dir}" "contexts/proj/feat-test" "context dir path correct"

# Test 2: init_context
init_context "proj:feat-test"
ctx_dir=$(get_context_dir "proj:feat-test")
assert_file_exists "${ctx_dir}/journal.jsonl" "journal file created"

# Test 3: journal_append
journal_append "proj:feat-test" "note" "test entry" '{}'
line_count=$(wc -l < "${ctx_dir}/journal.jsonl" | tr -d ' ')
assert_eq "1" "${line_count}" "journal has 1 entry"

# Test 4: journal_tail shows entry
output=$(journal_tail "proj:feat-test" 5)
assert_contains "${output}" "test entry" "journal_tail shows content"

# Test 5: add_conversation_ref
add_conversation_ref "proj:feat-test" "ref-123"
refs=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj:feat-test']['context']['conversation_refs'])")
assert_contains "${refs}" "ref-123" "conversation ref added"

# Test 6: add duplicate ref
add_conversation_ref "proj:feat-test" "ref-123"
ref_count=$(python3 -c "import json; print(len(json.load(open('${WTM_SESSIONS}'))['sessions']['proj:feat-test']['context']['conversation_refs']))")
assert_eq "1" "${ref_count}" "duplicate ref not added"

# Re-source context.sh from the devkit tree so tests exercise the current
# source-of-truth, not whatever happens to be installed at ~/.wtm/lib.
DEVKIT_CONTEXT_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/context.sh"
source "${DEVKIT_CONTEXT_SH}"

# Test 7 (#300): restore_handoff reads nested v3 schema
cat > "${WTM_SESSIONS}" <<'EOJSON'
{"version":3,"sessions":{
  "proj:handoff-test":{
    "cwd":"/tmp/proj",
    "last_active":"2026-04-19T10:00:00Z",
    "context":{"last_handoff":{
      "timestamp":"2026-04-19T10:00:00Z",
      "summary":"nested-schema-handoff-summary",
      "open_files":["a.ts","b.ts"],
      "pending_tasks":["impl-x"]
    }}
  }
}}
EOJSON
output=$(restore_handoff "proj:handoff-test")
assert_contains "${output}" "nested-schema-handoff-summary" "restore_handoff reads nested v3 (#300)"
assert_contains "${output}" "a.ts" "restore_handoff prints open_files from nested schema"

# Test 8 (#300): restore_handoff falls back to flat legacy v1 schema
cat > "${WTM_SESSIONS}" <<'EOJSON'
{
  "legacy:flat-test":{
    "context":{"last_handoff":{
      "timestamp":"2026-04-19T10:00:00Z",
      "summary":"flat-schema-handoff-summary",
      "open_files":[],
      "pending_tasks":[]
    }}
  }
}
EOJSON
output=$(restore_handoff "legacy:flat-test")
assert_contains "${output}" "flat-schema-handoff-summary" "restore_handoff falls back to flat legacy (#300)"

# Test 9 (#300): restore_handoff exit 1 on missing session
cat > "${WTM_SESSIONS}" <<'EOJSON'
{"version":3,"sessions":{}}
EOJSON
if restore_handoff "does:not-exist" >/dev/null 2>&1; then
  rh_status=0
else
  rh_status=$?
fi
assert_eq "1" "${rh_status}" "restore_handoff exits 1 for missing sid"

teardown_test_env
