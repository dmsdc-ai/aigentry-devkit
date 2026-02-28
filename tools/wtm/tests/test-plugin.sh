#!/usr/bin/env bash
# Test: Plugin architecture (plugin.sh) and external API (api.sh)
echo "  === Plugin & API Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
set +e  # Allow non-zero exits in tests
# Re-export plugin paths to use test env (common.sh set them before setup_test_env)
export WTM_PLUGINS="${WTM_HOME}/plugins"
source "${HOME}/.wtm/lib/plugin.sh"
source "${HOME}/.wtm/lib/api.sh"

# ---------------------------------------------------------------------------
# Create a fake plugin in test env
# ---------------------------------------------------------------------------
FAKE_PLUGIN_DIR="${WTM_HOME}/plugins/test-plugin"
mkdir -p "${FAKE_PLUGIN_DIR}/hooks"

python3 -c "
import json
data = {
    'name': 'test-plugin',
    'version': '1.0',
    'description': 'A test plugin',
    'hooks': {
        'session.created': 'hooks/on-create.sh'
    },
    'commands': []
}
with open('${FAKE_PLUGIN_DIR}/plugin.json', 'w') as f:
    json.dump(data, f, indent=2)
"

cat > "${FAKE_PLUGIN_DIR}/hooks/on-create.sh" <<'EOHOOK'
#!/usr/bin/env bash
echo "hook fired"
EOHOOK
chmod +x "${FAKE_PLUGIN_DIR}/hooks/on-create.sh"

# ---------------------------------------------------------------------------
# Set up test sessions and projects data for API tests
# ---------------------------------------------------------------------------
python3 -c "
import json
data = {
    'version': 3,
    'sessions': {
        'proj:feat-alpha': {
            'project': 'proj',
            'type': 'feat',
            'name': 'alpha',
            'branch': 'feat/alpha',
            'status': 'active'
        },
        'proj:feat-beta': {
            'project': 'proj',
            'type': 'feat',
            'name': 'beta',
            'branch': 'feat/beta',
            'status': 'idle',
            'type': 'lazy'
        }
    }
}
with open('${WTM_SESSIONS}', 'w') as f:
    json.dump(data, f, indent=2)
"

python3 -c "
import json
data = {
    'aliases': {
        'myproject': {'path': '/tmp/myproject', 'worktree_root': '~/.wtm/worktrees'},
        'otherproject': {'path': '/tmp/other', 'worktree_root': '~/.wtm/worktrees'}
    },
    'defaults': {
        'worktree_root': '~/.wtm/worktrees',
        'cleanup_after_days': 14
    }
}
with open('${WTM_PROJECTS}', 'w') as f:
    json.dump(data, f, indent=2)
"

# ---------------------------------------------------------------------------
# Tests: plugin.sh — list_plugins
# ---------------------------------------------------------------------------
output=$(list_plugins 2>/dev/null)
assert_contains "${output}" "test-plugin" "list_plugins shows test-plugin"
assert_contains "${output}" "1.0" "list_plugins shows version"

# ---------------------------------------------------------------------------
# Tests: plugin.sh — get_plugin_info
# ---------------------------------------------------------------------------
info=$(get_plugin_info "test-plugin" 2>/dev/null)
assert_contains "${info}" "test-plugin" "get_plugin_info shows name"
assert_contains "${info}" "1.0" "get_plugin_info shows version"
assert_contains "${info}" "session.created" "get_plugin_info shows hook event"
assert_contains "${info}" "hooks/on-create.sh" "get_plugin_info shows hook script"

# get_plugin_info on missing plugin returns error
assert_fail "get_plugin_info on missing plugin fails" get_plugin_info "no-such-plugin"

# ---------------------------------------------------------------------------
# Tests: plugin.sh — load_plugin_commands
# ---------------------------------------------------------------------------
# Plugin has no commands/ dir — should succeed silently (return 0)
assert_ok "load_plugin_commands with no commands dir succeeds" load_plugin_commands "test-plugin"

# Add a real commands dir with an executable script and verify it loads
mkdir -p "${FAKE_PLUGIN_DIR}/commands"
cat > "${FAKE_PLUGIN_DIR}/commands/hello" <<'EOCMD'
#!/usr/bin/env bash
wtm_hello() { echo "hello from plugin"; }
EOCMD
chmod +x "${FAKE_PLUGIN_DIR}/commands/hello"

assert_ok "load_plugin_commands with command script succeeds" load_plugin_commands "test-plugin"

# After sourcing, the function defined in the command script should exist
type wtm_hello >/dev/null 2>&1
assert_eq "0" "$?" "load_plugin_commands sources command script (function available)"

# ---------------------------------------------------------------------------
# Tests: api.sh — api_status
# ---------------------------------------------------------------------------
status_json=$(api_status 2>/dev/null)
assert_contains "${status_json}" "sessions_count" "api_status returns sessions_count field"
assert_contains "${status_json}" "active" "api_status returns active field"
assert_contains "${status_json}" "lazy" "api_status returns lazy field"
assert_contains "${status_json}" "projects" "api_status returns projects field"
assert_contains "${status_json}" "myproject" "api_status lists project aliases"

# Validate it's proper JSON
valid=$(python3 -c "import json,sys; json.loads(sys.argv[1]); print('ok')" "${status_json}" 2>/dev/null)
assert_eq "ok" "${valid}" "api_status output is valid JSON"

# ---------------------------------------------------------------------------
# Tests: api.sh — api_sessions
# ---------------------------------------------------------------------------
sessions_json=$(api_sessions 2>/dev/null)
assert_contains "${sessions_json}" "proj:feat-alpha" "api_sessions contains session id"
assert_contains "${sessions_json}" "feat/alpha" "api_sessions contains branch info"

# Validate it's a JSON array
is_array=$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])
print('yes' if isinstance(data, list) else 'no')
" "${sessions_json}" 2>/dev/null)
assert_eq "yes" "${is_array}" "api_sessions returns a JSON array"

# ---------------------------------------------------------------------------
# Tests: api.sh — api_projects
# ---------------------------------------------------------------------------
projects_json=$(api_projects 2>/dev/null)
assert_contains "${projects_json}" "myproject" "api_projects contains myproject alias"
assert_contains "${projects_json}" "otherproject" "api_projects contains otherproject alias"

# Validate it's a JSON array
is_proj_array=$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])
print('yes' if isinstance(data, list) else 'no')
" "${projects_json}" 2>/dev/null)
assert_eq "yes" "${is_proj_array}" "api_projects returns a JSON array"

# Each entry should have the 'alias' field injected
has_alias=$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])
print('yes' if all('alias' in e for e in data) else 'no')
" "${projects_json}" 2>/dev/null)
assert_eq "yes" "${has_alias}" "api_projects entries have alias field"

# ---------------------------------------------------------------------------
# Tests: api.sh — api_sessions with empty sessions file
# ---------------------------------------------------------------------------
echo '{"version":3,"sessions":{}}' > "${WTM_SESSIONS}"
empty_json=$(api_sessions 2>/dev/null)
is_empty_array=$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])
print('yes' if isinstance(data, list) and len(data) == 0 else 'no')
" "${empty_json}" 2>/dev/null)
assert_eq "yes" "${is_empty_array}" "api_sessions returns empty array when no sessions"

# ---------------------------------------------------------------------------
# Tests: api.sh — api_projects with missing projects file
# ---------------------------------------------------------------------------
rm -f "${WTM_PROJECTS}"
missing_json=$(api_projects 2>/dev/null)
assert_eq "[]" "${missing_json}" "api_projects returns [] when projects file missing"

teardown_test_env
