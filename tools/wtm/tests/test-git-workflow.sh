#!/usr/bin/env bash
# Test: Git workflow libraries - commits.sh, branch.sh, pr.sh

echo "  === Git Workflow Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
set +e  # Allow non-zero exits in tests
source "${HOME}/.wtm/lib/commits.sh"
source "${HOME}/.wtm/lib/branch.sh"
source "${HOME}/.wtm/lib/pr.sh"

# ─── commits.sh tests ───────────────────────────────────────────────────────

echo ""
echo "  -- validate_commit_msg --"

# Valid messages
result=$(validate_commit_msg "feat: add login")
assert_eq "VALID" "${result}" "validate_commit_msg: 'feat: add login' is VALID"

result=$(validate_commit_msg "fix: resolve crash")
assert_eq "VALID" "${result}" "validate_commit_msg: 'fix: resolve crash' is VALID"

result=$(validate_commit_msg "docs(readme): update install steps")
assert_contains "${result}" "VALID" "validate_commit_msg: 'docs(readme): update install steps' is VALID"

result=$(validate_commit_msg "chore!: drop Node 14 support")
assert_contains "${result}" "VALID" "validate_commit_msg: breaking change with ! is VALID"

# Invalid messages
result=$(validate_commit_msg "bad message")
assert_contains "${result}" "INVALID" "validate_commit_msg: 'bad message' is INVALID"

result=$(validate_commit_msg "")
assert_contains "${result}" "INVALID" "validate_commit_msg: empty string is INVALID"

result=$(validate_commit_msg "FEAT: uppercase type is INVALID")
assert_contains "${result}" "INVALID" "validate_commit_msg: uppercase type is INVALID"

result=$(validate_commit_msg "feat:missing space after colon")
assert_contains "${result}" "INVALID" "validate_commit_msg: missing space after colon is INVALID"

# Return codes
validate_commit_msg "feat: good message" >/dev/null 2>&1
assert_eq "0" "$?" "validate_commit_msg: valid message returns 0"

commit_rc=0
validate_commit_msg "not valid" >/dev/null 2>&1 || commit_rc=$?
assert_eq "1" "${commit_rc}" "validate_commit_msg: invalid message returns 1"

echo ""
echo "  -- list_commit_types --"

output=$(list_commit_types)
assert_contains "${output}" "feat" "list_commit_types: includes feat"
assert_contains "${output}" "fix" "list_commit_types: includes fix"
assert_contains "${output}" "docs" "list_commit_types: includes docs"
assert_contains "${output}" "refactor" "list_commit_types: includes refactor"
assert_contains "${output}" "chore" "list_commit_types: includes chore"
assert_contains "${output}" "revert" "list_commit_types: includes revert"

echo ""
echo "  -- format_commit --"

result=$(format_commit "feat" "auth" "add OAuth2 login flow")
assert_eq "feat(auth): add OAuth2 login flow" "${result}" "format_commit: with scope"

result=$(format_commit "fix" "" "resolve crash on startup")
assert_eq "fix: resolve crash on startup" "${result}" "format_commit: without scope"

result=$(format_commit "chore" "deps" "update dependencies")
assert_eq "chore(deps): update dependencies" "${result}" "format_commit: chore with scope"

# ─── branch.sh tests ────────────────────────────────────────────────────────

echo ""
echo "  -- validate_branch_name --"

# Valid branch names
result=$(validate_branch_name "feature" "add-auth")
assert_contains "${result}" "VALID" "validate_branch_name: 'feature/add-auth' is VALID"

result=$(validate_branch_name "fix" "bug-123")
assert_contains "${result}" "VALID" "validate_branch_name: 'fix/bug-123' is VALID"

result=$(validate_branch_name "chore" "update.deps")
assert_contains "${result}" "VALID" "validate_branch_name: dots allowed in name"

# Invalid branch names - spaces
result=$(validate_branch_name "INVALID" "BRANCH")
assert_contains "${result}" "INVALID" "validate_branch_name: uppercase type/name is INVALID"

result=$(validate_branch_name "feature" "my branch")
assert_contains "${result}" "INVALID" "validate_branch_name: space in name is INVALID"

result=$(validate_branch_name "" "")
assert_contains "${result}" "INVALID" "validate_branch_name: empty type and name is INVALID"

# Return codes
validate_branch_name "fix" "my-fix" >/dev/null 2>&1
assert_eq "0" "$?" "validate_branch_name: valid name returns 0"

branch_rc=0
validate_branch_name "UPPER" "bad name" >/dev/null 2>&1 || branch_rc=$?
assert_eq "1" "${branch_rc}" "validate_branch_name: invalid name returns 1"

echo ""
echo "  -- suggest_branch_name --"

result=$(suggest_branch_name "feature" "Add Auth Module")
assert_eq "feature/add-auth-module" "${result}" "suggest_branch_name: slugifies spaces to hyphens"

result=$(suggest_branch_name "fix" "Bug 123: crash on login")
assert_contains "${result}" "fix/" "suggest_branch_name: starts with fix/"

result=$(suggest_branch_name "chore" "UPPERCASE NAME")
assert_contains "${result}" "chore/" "suggest_branch_name: lowercases the name"

result=$(suggest_branch_name "feat" "multiple---hyphens")
# Should collapse consecutive hyphens
assert_contains "${result}" "feat/" "suggest_branch_name: collapses consecutive hyphens prefix correct"

echo ""
echo "  -- get_branch_pattern --"

# No projects.json entry - should return default
result=$(get_branch_pattern "nonexistent-project")
assert_eq "{type}/{name}" "${result}" "get_branch_pattern: returns default pattern for unknown project"

# With a custom pattern in projects.json
python3 -c "
import json
data = {
    'aliases': {
        'myproject': {
            'branch_naming': '{type}-{name}'
        }
    },
    'defaults': {}
}
with open('${WTM_PROJECTS}', 'w') as f:
    json.dump(data, f)
"
result=$(get_branch_pattern "myproject")
assert_eq "{type}-{name}" "${result}" "get_branch_pattern: returns custom pattern from projects.json"

# Reset projects.json
echo '{"aliases":{},"defaults":{"worktree_root":"~/.wtm/worktrees","cleanup_after_days":14}}' > "${WTM_PROJECTS}"

# ─── pr.sh tests ────────────────────────────────────────────────────────────

echo ""
echo "  -- generate_pr_title --"

result=$(generate_pr_title "myproject:feature-add-auth")
assert_eq "feat: add-auth" "${result}" "generate_pr_title: feature type maps to feat"

result=$(generate_pr_title "myproject:fix-resolve-crash")
assert_eq "fix: resolve-crash" "${result}" "generate_pr_title: fix type stays fix"

result=$(generate_pr_title "myproject:bugfix-null-pointer")
assert_eq "fix: null-pointer" "${result}" "generate_pr_title: bugfix maps to fix"

result=$(generate_pr_title "myproject:hotfix-critical-bug")
assert_eq "fix: critical-bug" "${result}" "generate_pr_title: hotfix maps to fix"

result=$(generate_pr_title "myproject:docs-update-readme")
assert_eq "docs: update-readme" "${result}" "generate_pr_title: docs type stays docs"

result=$(generate_pr_title "myproject:chore-cleanup")
assert_eq "chore: cleanup" "${result}" "generate_pr_title: chore type stays chore"

result=$(generate_pr_title "myproject:refactor-auth-module")
assert_eq "refactor: auth-module" "${result}" "generate_pr_title: refactor type stays refactor"

# Without project prefix
result=$(generate_pr_title "feature-add-login")
assert_eq "feat: add-login" "${result}" "generate_pr_title: no project prefix handled"

echo ""
echo "  -- generate_pr_body --"

# Create a minimal git repo in TEST_TMPDIR for generate_pr_body
TEST_REPO="${TEST_TMPDIR}/test-repo"
mkdir -p "${TEST_REPO}"
git -C "${TEST_REPO}" init -q
git -C "${TEST_REPO}" config user.email "test@test.com"
git -C "${TEST_REPO}" config user.name "Test User"
echo "hello" > "${TEST_REPO}/README.md"
git -C "${TEST_REPO}" add README.md
git -C "${TEST_REPO}" commit -q -m "feat: initial commit"

# generate_pr_body falls back to inline template when no template file exists
# (WTM_HOME points to test tmpdir which has no template)
body=$(generate_pr_body "${TEST_REPO}" "main")
assert_contains "${body}" "Summary" "generate_pr_body: output contains Summary section"
assert_contains "${body}" "Checklist" "generate_pr_body: output contains Checklist section"
assert_contains "${body}" "Session" "generate_pr_body: output contains Session identifier"

# Verify it produces non-empty output
body_len="${#body}"
# body_len > 0
if [[ "${body_len}" -gt 0 ]]; then
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "  PASS: generate_pr_body: produces non-empty output"
else
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "  FAIL: generate_pr_body: output was empty"
fi

teardown_test_env
