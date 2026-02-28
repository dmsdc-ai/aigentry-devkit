#!/usr/bin/env bash
# WTM Project Library - CRUD operations for WTM projects
# Provides focused helpers for reading, listing, counting, and registering
# project records stored in WTM_PROJECTS (projects.json).
# All writes are performed under with_lock "projects" for safety.

export WTM_PROJECTS="${WTM_PROJECTS:-${WTM_HOME:-${HOME}/.wtm}/projects.json}"
export WTM_SESSIONS="${WTM_SESSIONS:-${WTM_HOME:-${HOME}/.wtm}/sessions.json}"

# ---------------------------------------------------------------------------
# list_projects
#
# Print all registered project aliases, one per line.
# ---------------------------------------------------------------------------
list_projects() {
  python3 - "${WTM_PROJECTS}" <<'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    data = json.load(f)

for alias in data.get("aliases", {}):
    print(alias)
PYEOF
}

# ---------------------------------------------------------------------------
# project_exists <alias>
#
# Returns 0 if the project alias exists, 1 otherwise.
# ---------------------------------------------------------------------------
project_exists() {
  local alias="$1"

  python3 - "${alias}" "${WTM_PROJECTS}" <<'PYEOF'
import json, sys

alias, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)

sys.exit(0 if alias in data.get("aliases", {}) else 1)
PYEOF
}

# ---------------------------------------------------------------------------
# get_project_field <alias> <field>
#
# Read a single top-level (or dot-notation nested) field from a project entry.
# Prints the value as a plain string. Returns 1 if alias or field not found.
# ---------------------------------------------------------------------------
get_project_field() {
  local alias="$1"
  local field="$2"

  python3 - "${alias}" "${field}" "${WTM_PROJECTS}" <<'PYEOF'
import json, sys

alias, field_path, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)

p = data.get("aliases", {}).get(alias)
if p is None:
    sys.exit(1)

keys = field_path.split(".")
obj = p
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
# get_project_local <alias>
#
# Shortcut: print the local filesystem path for a registered project.
# Returns 1 if the project or local field is not found.
# ---------------------------------------------------------------------------
get_project_local() {
  local alias="$1"
  get_project_field "${alias}" "local"
}

# ---------------------------------------------------------------------------
# count_project_sessions <alias>
#
# Print the number of sessions that belong to the given project alias.
# ---------------------------------------------------------------------------
count_project_sessions() {
  local alias="$1"

  python3 - "${alias}" "${WTM_SESSIONS}" <<'PYEOF'
import json, sys

alias, sessions_path = sys.argv[1], sys.argv[2]
with open(sessions_path) as f:
    data = json.load(f)

count = sum(
    1 for s in data.get("sessions", {}).values()
    if s.get("project") == alias
)
print(count)
PYEOF
}

# ---------------------------------------------------------------------------
# register_project <alias> <repo> <local> <default_base>
#
# Register a new project entry under the projects lock.
# Fails with an error if the alias is already registered.
# ---------------------------------------------------------------------------
register_project() {
  local alias="$1"
  local repo="$2"
  local local_path="$3"
  local default_base="${4:-main}"

  with_lock "projects" python3 - "${alias}" "${repo}" "${local_path}" "${default_base}" "${WTM_PROJECTS}" <<'PYEOF'
import json, sys, datetime

alias, repo, local_path, default_base, path = \
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]

with open(path, "r") as f:
    data = json.load(f)

aliases = data.setdefault("aliases", {})
if alias in aliases:
    print(f"Project already registered: {alias}", file=sys.stderr)
    sys.exit(1)

aliases[alias] = {
    "repo": repo,
    "local": local_path,
    "default_base": default_base,
    "registered_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}

with open(path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
}
