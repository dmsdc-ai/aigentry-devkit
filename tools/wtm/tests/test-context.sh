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

teardown_test_env
