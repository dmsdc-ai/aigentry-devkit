#!/usr/bin/env bash
# Test: Schema migration
echo "  === Migration Tests ==="

setup_test_env

# Copy real WTM libs to test env
source "${HOME}/.wtm/lib/common.sh"
source "${HOME}/.wtm/lib/migrate.sh"

# Copy migration scripts to test env
mkdir -p "${WTM_HOME}/migrations"
cp "${HOME}/.wtm/migrations"/*.py "${WTM_HOME}/migrations/"

# Override for test
export WTM_MIGRATIONS="${WTM_HOME}/migrations"

# Test 1: sessions v1 -> v2 migration
echo '{"version":1,"sessions":{"test:feat-x":{"project":"test","type":"feat","name":"x","branch":"feat/x","base_branch":"main","worktree":"/tmp/wt","source":"/tmp/src","tmux":"wtm_test_feat-x","status":"active","created_at":"2026-01-01T00:00:00Z"}}}' > "${WTM_SESSIONS}"
python3 "${WTM_MIGRATIONS}/001_sessions_v1_to_v2.py" "${WTM_SESSIONS}"
v=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['version'])")
assert_eq "2" "${v}" "sessions migrated to v2"

# Test 2: v2 has health field
has_health=$(python3 -c "import json; d=json.load(open('${WTM_SESSIONS}')); print('yes' if 'health' in d['sessions']['test:feat-x'] else 'no')")
assert_eq "yes" "${has_health}" "v2 has health field"

# Test 3: sessions v2 -> v3 migration
python3 "${WTM_MIGRATIONS}/003_sessions_v2_to_v3.py" "${WTM_SESSIONS}"
v3=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['version'])")
assert_eq "3" "${v3}" "sessions migrated to v3"

# Test 4: v3 has cross-dimension fields
has_context=$(python3 -c "import json; d=json.load(open('${WTM_SESSIONS}')); print('yes' if 'context' in d['sessions']['test:feat-x'] else 'no')")
assert_eq "yes" "${has_context}" "v3 has context field"

# Test 5: projects v0 -> v2 migration
echo '{"aliases":{"test":{"repo":"org/test","local":"/tmp/test","default_base":"main"}},"defaults":{"worktree_root":"~/.wtm/worktrees","cleanup_after_days":14}}' > "${WTM_PROJECTS}"
python3 "${WTM_MIGRATIONS}/002_projects_v0_to_v2.py" "${WTM_PROJECTS}"
pv=$(python3 -c "import json; print(json.load(open('${WTM_PROJECTS}'))['version'])")
assert_eq "2" "${pv}" "projects migrated to v2"

# Test 6: projects v2 -> v3 migration
python3 "${WTM_MIGRATIONS}/004_projects_v2_to_v3.py" "${WTM_PROJECTS}"
pv3=$(python3 -c "import json; print(json.load(open('${WTM_PROJECTS}'))['version'])")
assert_eq "3" "${pv3}" "projects migrated to v3"

# Test 7: migration is idempotent
python3 "${WTM_MIGRATIONS}/003_sessions_v2_to_v3.py" "${WTM_SESSIONS}"
v3_again=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['version'])")
assert_eq "3" "${v3_again}" "migration is idempotent"

# Test 8: existing data preserved
proj_name=$(python3 -c "import json; print(json.load(open('${WTM_SESSIONS}'))['sessions']['test:feat-x']['project'])")
assert_eq "test" "${proj_name}" "existing data preserved after migration"

# ── v3→v4 Migration Tests (terminal abstraction) ──
echo ""
echo "── v3→v4 Migration (terminal abstraction) ──"

# Test: tmux field converts to terminal field
V3_FILE=$(mktemp)
cat > "${V3_FILE}" <<'V3EOF'
{
  "version": 3,
  "sessions": {
    "proj:feature-test": {
      "project": "proj",
      "tmux": "wtm_proj_feature-test",
      "status": "active",
      "health": {"worktree_ok": true, "tmux_ok": true, "watcher_ok": true, "symlinks_ok": true}
    }
  }
}
V3EOF
python3 "${HOME}/.wtm/migrations/005_sessions_v3_to_v4.py" "${V3_FILE}"
# Check version bumped to 4
V4_VERSION=$(python3 -c "import json; print(json.load(open('${V3_FILE}')).get('version'))")
assert_eq "4" "${V4_VERSION}" "v3→v4: version bumped to 4"

# Check terminal field created
TERM_TYPE=$(python3 -c "import json; s=json.load(open('${V3_FILE}'))['sessions']['proj:feature-test']; print(s['terminal']['type'])")
assert_eq "tmux" "${TERM_TYPE}" "v3→v4: terminal.type = tmux"

TERM_NAME=$(python3 -c "import json; s=json.load(open('${V3_FILE}'))['sessions']['proj:feature-test']; print(s['terminal']['session_name'])")
assert_eq "wtm_proj_feature-test" "${TERM_NAME}" "v3→v4: terminal.session_name preserved"

# Check health.terminal_ok added
TERM_OK=$(python3 -c "import json; s=json.load(open('${V3_FILE}'))['sessions']['proj:feature-test']; print(s['health']['terminal_ok'])")
assert_eq "True" "${TERM_OK}" "v3→v4: health.terminal_ok added"

# Check old tmux field preserved for backward compat
OLD_TMUX=$(python3 -c "import json; s=json.load(open('${V3_FILE}'))['sessions']['proj:feature-test']; print(s.get('tmux',''))")
assert_eq "wtm_proj_feature-test" "${OLD_TMUX}" "v3→v4: old tmux field preserved"

rm -f "${V3_FILE}"

# Test: tmux_session field (from lazy.sh) also converts
V3B_FILE=$(mktemp)
cat > "${V3B_FILE}" <<'V3BEOF'
{
  "version": 3,
  "sessions": {
    "proj:feature-lazy": {
      "project": "proj",
      "tmux_session": "proj__feature_lazy",
      "status": "lazy",
      "health": {}
    }
  }
}
V3BEOF
python3 "${HOME}/.wtm/migrations/005_sessions_v3_to_v4.py" "${V3B_FILE}"
LAZY_TYPE=$(python3 -c "import json; s=json.load(open('${V3B_FILE}'))['sessions']['proj:feature-lazy']; print(s['terminal']['type'])")
assert_eq "tmux" "${LAZY_TYPE}" "v3→v4: tmux_session field converts"
rm -f "${V3B_FILE}"

# Test: Idempotency (running twice produces same result)
IDEM_FILE=$(mktemp)
cat > "${IDEM_FILE}" <<'IDEMEOF'
{
  "version": 3,
  "sessions": {
    "proj:idem-test": {
      "project": "proj",
      "tmux": "wtm_proj_idem",
      "status": "active",
      "health": {"tmux_ok": true}
    }
  }
}
IDEMEOF
python3 "${HOME}/.wtm/migrations/005_sessions_v3_to_v4.py" "${IDEM_FILE}"
FIRST=$(python3 -c "import json; print(json.dumps(json.load(open('${IDEM_FILE}')), sort_keys=True))")
python3 "${HOME}/.wtm/migrations/005_sessions_v3_to_v4.py" "${IDEM_FILE}"
SECOND=$(python3 -c "import json; print(json.dumps(json.load(open('${IDEM_FILE}')), sort_keys=True))")
assert_eq "${FIRST}" "${SECOND}" "v3→v4: idempotent (two runs same result)"
rm -f "${IDEM_FILE}"

teardown_test_env
