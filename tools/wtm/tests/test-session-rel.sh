#!/usr/bin/env bash
# Test: Session relationships
echo "  === Session Relationship Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
source "${HOME}/.wtm/lib/atomic.sh"
source "${HOME}/.wtm/lib/session-rel.sh"

# Setup: create v3 sessions
cat > "${WTM_SESSIONS}" <<'EOJSON'
{"version":3,"sessions":{
  "proj:feat-parent":{"project":"proj","type":"feat","name":"parent","branch":"feat/parent","status":"active","parent_session":null,"child_sessions":[],"session_group":null,"session_chain":{"previous":null,"next":null},"context":{},"cross_project":{"depends_on":[],"depended_by":[],"shared_group":null},"machine":{}},
  "proj:feat-child":{"project":"proj","type":"feat","name":"child","branch":"feat/child","status":"active","parent_session":null,"child_sessions":[],"session_group":null,"session_chain":{"previous":null,"next":null},"context":{},"cross_project":{"depends_on":[],"depended_by":[],"shared_group":null},"machine":{}},
  "proj:feat-sibling":{"project":"proj","type":"feat","name":"sibling","branch":"feat/sibling","status":"active","parent_session":null,"child_sessions":[],"session_group":null,"session_chain":{"previous":null,"next":null},"context":{},"cross_project":{"depends_on":[],"depended_by":[],"shared_group":null},"machine":{}}
}}
EOJSON

# Test 1: set_parent creates bidirectional link
set_parent "proj:feat-child" "proj:feat-parent"
parent=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj:feat-child']['parent_session'])")
assert_eq "proj:feat-parent" "${parent}" "child has parent set"

children=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj:feat-parent']['child_sessions'])")
assert_contains "${children}" "proj:feat-child" "parent has child in list"

# Test 2: create_group
create_group "auth-work" "proj:feat-parent" "proj:feat-child"
g1=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj:feat-parent']['session_group'])")
assert_eq "auth-work" "${g1}" "group assigned to parent"

# Test 3: list_group
members=$(list_group "auth-work")
assert_contains "${members}" "proj:feat-parent" "list_group returns parent"
assert_contains "${members}" "proj:feat-child" "list_group returns child"

# Test 4: chain_sessions
chain_sessions "proj:feat-parent" "proj:feat-child"
next=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj:feat-parent']['session_chain']['next'])")
assert_eq "proj:feat-child" "${next}" "chain next set"

teardown_test_env
