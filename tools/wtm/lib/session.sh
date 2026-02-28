#!/usr/bin/env bash
# WTM Session Library - CRUD operations for WTM sessions
# Provides focused helpers for reading, filtering, counting, and updating
# session records stored in WTM_SESSIONS (sessions.json).
# All writes are performed under with_lock "sessions" for safety.

export WTM_SESSIONS="${WTM_SESSIONS:-${WTM_HOME:-${HOME}/.wtm}/sessions.json}"

# ---------------------------------------------------------------------------
# get_session_field <session_id> <field>
#
# Read a single top-level (or dot-notation nested) field from a session.
# Prints the value as a plain string. Returns 1 if session or field not found.
# ---------------------------------------------------------------------------
get_session_field() {
  local session_id="$1"
  local field="$2"

  python3 - "${session_id}" "${field}" "${WTM_SESSIONS}" <<'PYEOF'
import json, sys

sid, field_path, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)

s = data.get("sessions", {}).get(sid)
if s is None:
    sys.exit(1)

keys = field_path.split(".")
obj = s
for k in keys:
    if not isinstance(obj, dict) or k not in obj:
        sys.exit(1)
    obj = obj[k]

if isinstance(obj, (dict, list)):
    print(json.dumps(obj))
else:
    print(obj)
PYEOF
}

# ---------------------------------------------------------------------------
# list_sessions_by_project <project>
#
# Print session IDs (one per line) whose "project" field matches the argument.
# ---------------------------------------------------------------------------
list_sessions_by_project() {
  local project="$1"

  python3 - "${project}" "${WTM_SESSIONS}" <<'PYEOF'
import json, sys

project, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)

for sid, s in data.get("sessions", {}).items():
    if s.get("project") == project:
        print(sid)
PYEOF
}

# ---------------------------------------------------------------------------
# list_sessions_by_status <status>
#
# Print session IDs (one per line) whose "status" field matches the argument.
# Common statuses: active, lazy, stopped, error
# ---------------------------------------------------------------------------
list_sessions_by_status() {
  local status="$1"

  python3 - "${status}" "${WTM_SESSIONS}" <<'PYEOF'
import json, sys

status, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)

for sid, s in data.get("sessions", {}).items():
    if s.get("status") == status:
        print(sid)
PYEOF
}

# ---------------------------------------------------------------------------
# count_sessions [project]
#
# Print the number of sessions. If project is provided, count only sessions
# belonging to that project.
# ---------------------------------------------------------------------------
count_sessions() {
  local project="${1:-}"

  python3 - "${project}" "${WTM_SESSIONS}" <<'PYEOF'
import json, sys

project, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)

sessions = data.get("sessions", {})
if project:
    count = sum(1 for s in sessions.values() if s.get("project") == project)
else:
    count = len(sessions)
print(count)
PYEOF
}

# ---------------------------------------------------------------------------
# session_exists <session_id>
#
# Returns 0 if the session exists, 1 otherwise.
# ---------------------------------------------------------------------------
session_exists() {
  local session_id="$1"

  python3 - "${session_id}" "${WTM_SESSIONS}" <<'PYEOF'
import json, sys

sid, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)

sys.exit(0 if sid in data.get("sessions", {}) else 1)
PYEOF
}

# ---------------------------------------------------------------------------
# get_session_worktree <session_id>
#
# Shortcut: print the worktree path for a session.
# Returns 1 if the session or worktree field is not found.
# ---------------------------------------------------------------------------
get_session_worktree() {
  local session_id="$1"
  get_session_field "${session_id}" "worktree"
}

# ---------------------------------------------------------------------------
# update_session_status <session_id> <new_status>
#
# Atomically update the "status" field of a session under the sessions lock.
# Also updates "updated_at" to the current UTC ISO timestamp.
# Returns 1 if the session does not exist.
# ---------------------------------------------------------------------------
update_session_status() {
  local session_id="$1"
  local new_status="$2"

  with_lock "sessions" python3 - "${session_id}" "${new_status}" "${WTM_SESSIONS}" <<'PYEOF'
import json, sys, datetime

sid, new_status, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r") as f:
    data = json.load(f)

s = data.get("sessions", {}).get(sid)
if s is None:
    print(f"Session not found: {sid}", file=sys.stderr)
    sys.exit(1)

s["status"] = new_status
s["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

with open(path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
}
