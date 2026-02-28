#!/usr/bin/env bash
# Test: Cross-project dependencies
echo "  === Cross-Project Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
source "${HOME}/.wtm/lib/atomic.sh"
source "${HOME}/.wtm/lib/cross-project.sh"

# Setup
cat > "${WTM_PROJECTS}" <<'EOJSON'
{"version":3,"aliases":{"proj-a":{"repo":"org/a","local":"/tmp/a","default_base":"main","dependencies":[]},"proj-b":{"repo":"org/b","local":"/tmp/b","default_base":"main","dependencies":[]}},"defaults":{},"machines":{}}
EOJSON

cat > "${WTM_SESSIONS}" <<'EOJSON'
{"version":3,"sessions":{
  "proj-a:feat-x":{"project":"proj-a","type":"feat","name":"x","status":"active","cross_project":{"depends_on":[],"depended_by":[],"shared_group":null}},
  "proj-b:feat-y":{"project":"proj-b","type":"feat","name":"y","status":"active","cross_project":{"depends_on":[],"depended_by":[],"shared_group":null}}
}}
EOJSON

# Test 1: add project dependency
add_project_dependency "proj-a" "proj-b"
deps=$(python3 -c "import json; print(json.load(open('${WTM_PROJECTS}'))['aliases']['proj-a']['dependencies'])")
assert_contains "${deps}" "proj-b" "project dependency added"

# Test 2: add session cross-dep (bidirectional)
add_session_cross_dep "proj-a:feat-x" "proj-b:feat-y"
dep_on=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj-a:feat-x']['cross_project']['depends_on'])")
assert_contains "${dep_on}" "proj-b:feat-y" "session depends_on set"

dep_by=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj-b:feat-y']['cross_project']['depended_by'])")
assert_contains "${dep_by}" "proj-a:feat-x" "session depended_by set"

# Test 3: check_impact
impact=$(check_impact "proj-b:feat-y")
assert_contains "${impact}" "proj-a:feat-x" "impact shows dependent"

# Test 4: remove project dependency
remove_project_dependency "proj-a" "proj-b"
deps2=$(python3 -c "import json; print(json.load(open('${WTM_PROJECTS}'))['aliases']['proj-a']['dependencies'])")
assert_eq "[]" "${deps2}" "project dependency removed"

# Test 5: set shared group
set_shared_group "proj-a:feat-x" "shared-auth"
sg=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['proj-a:feat-x']['cross_project']['shared_group'])")
assert_eq "shared-auth" "${sg}" "shared group set"

teardown_test_env
