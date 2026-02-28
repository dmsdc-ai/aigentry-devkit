#!/usr/bin/env bash
# WTM Cross-Project Library - Cross-project dependency tracking
#
# Manages dependencies between projects (project-level) and between sessions
# (session-level cross_project fields). Also tracks shared groups for
# cross-project collaboration.
#
# Project-level ops lock on WTM_PROJECTS.
# Session-level ops lock on WTM_SESSIONS.
# All python3 calls pass parameters via sys.argv (no shell interpolation).

# Source common if not already loaded
if [[ -z "${WTM_HOME:-}" ]]; then
  WTM_HOME="${HOME}/.wtm"
  WTM_PROJECTS="${WTM_HOME}/projects.json"
  WTM_SESSIONS="${WTM_HOME}/sessions.json"
fi

# ---------------------------------------------------------------------------
# add_project_dependency
# Add depends_on to a project's dependencies[] in projects.json under lock.
# Args: project depends_on
# ---------------------------------------------------------------------------
add_project_dependency() {
  local project="$1"
  local depends_on="$2"

  with_lock "$(basename "${WTM_PROJECTS}" .json)" python3 - "${project}" "${depends_on}" <<'PYEOF'
import json, sys, os

project, depends_on = sys.argv[1], sys.argv[2]
projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))

with open(projects_file, "r") as f:
    data = json.load(f)

aliases = data.get("aliases", {})

if project not in aliases:
    print(f"Error: project '{project}' not found", file=sys.stderr)
    sys.exit(1)
if depends_on not in aliases:
    print(f"Error: dependency project '{depends_on}' not found", file=sys.stderr)
    sys.exit(1)
if project == depends_on:
    print(f"Error: a project cannot depend on itself", file=sys.stderr)
    sys.exit(1)

deps = aliases[project].setdefault("dependencies", [])
if depends_on not in deps:
    deps.append(depends_on)
    with open(projects_file, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Added dependency: {project} -> {depends_on}")
else:
    print(f"Dependency already exists: {project} -> {depends_on}")
PYEOF
}

# ---------------------------------------------------------------------------
# remove_project_dependency
# Remove depends_on from a project's dependencies[] in projects.json.
# Args: project depends_on
# ---------------------------------------------------------------------------
remove_project_dependency() {
  local project="$1"
  local depends_on="$2"

  with_lock "$(basename "${WTM_PROJECTS}" .json)" python3 - "${project}" "${depends_on}" <<'PYEOF'
import json, sys, os

project, depends_on = sys.argv[1], sys.argv[2]
projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))

with open(projects_file, "r") as f:
    data = json.load(f)

aliases = data.get("aliases", {})

if project not in aliases:
    print(f"Error: project '{project}' not found", file=sys.stderr)
    sys.exit(1)

deps = aliases[project].get("dependencies", [])
if depends_on in deps:
    aliases[project]["dependencies"] = [d for d in deps if d != depends_on]
    with open(projects_file, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Removed dependency: {project} -> {depends_on}")
else:
    print(f"Dependency not found: {project} -> {depends_on}")
PYEOF
}

# ---------------------------------------------------------------------------
# add_session_cross_dep
# Bidirectional: add depends_on_session to session.cross_project.depends_on[]
# AND add session_id to target.cross_project.depended_by[].
# Atomically updates both sessions under a single lock.
# Args: session_id depends_on_session
# ---------------------------------------------------------------------------
add_session_cross_dep() {
  local session_id="$1"
  local depends_on_session="$2"

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${session_id}" "${depends_on_session}" <<'PYEOF'
import json, sys, os

session_id, depends_on_session = sys.argv[1], sys.argv[2]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})

if session_id not in sessions:
    print(f"Error: session '{session_id}' not found", file=sys.stderr)
    sys.exit(1)
if depends_on_session not in sessions:
    print(f"Error: session '{depends_on_session}' not found", file=sys.stderr)
    sys.exit(1)
if session_id == depends_on_session:
    print(f"Error: a session cannot depend on itself", file=sys.stderr)
    sys.exit(1)

# Update session_id.cross_project.depends_on
cp_src = sessions[session_id].setdefault("cross_project", {})
depends_on_list = cp_src.setdefault("depends_on", [])
if depends_on_session not in depends_on_list:
    depends_on_list.append(depends_on_session)

# Update depends_on_session.cross_project.depended_by
cp_tgt = sessions[depends_on_session].setdefault("cross_project", {})
depended_by_list = cp_tgt.setdefault("depended_by", [])
if session_id not in depended_by_list:
    depended_by_list.append(session_id)

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Added cross-dep: {session_id} depends on {depends_on_session}")
PYEOF
}

# ---------------------------------------------------------------------------
# remove_session_cross_dep
# Remove bidirectional cross-project dependency between two sessions.
# Args: session_id depends_on_session
# ---------------------------------------------------------------------------
remove_session_cross_dep() {
  local session_id="$1"
  local depends_on_session="$2"

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${session_id}" "${depends_on_session}" <<'PYEOF'
import json, sys, os

session_id, depends_on_session = sys.argv[1], sys.argv[2]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})

if session_id not in sessions:
    print(f"Error: session '{session_id}' not found", file=sys.stderr)
    sys.exit(1)

# Remove from session_id.cross_project.depends_on
cp_src = sessions[session_id].get("cross_project", {})
deps = cp_src.get("depends_on", [])
cp_src["depends_on"] = [d for d in deps if d != depends_on_session]
sessions[session_id]["cross_project"] = cp_src

# Remove from depends_on_session.cross_project.depended_by (if session exists)
if depends_on_session in sessions:
    cp_tgt = sessions[depends_on_session].get("cross_project", {})
    depended_by = cp_tgt.get("depended_by", [])
    cp_tgt["depended_by"] = [d for d in depended_by if d != session_id]
    sessions[depends_on_session]["cross_project"] = cp_tgt

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Removed cross-dep: {session_id} no longer depends on {depends_on_session}")
PYEOF
}

# ---------------------------------------------------------------------------
# set_shared_group
# Set the cross_project.shared_group field on a session.
# Args: session_id group_name
# ---------------------------------------------------------------------------
set_shared_group() {
  local session_id="$1"
  local group_name="$2"

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${session_id}" "${group_name}" <<'PYEOF'
import json, sys, os

session_id, group_name = sys.argv[1], sys.argv[2]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})

if session_id not in sessions:
    print(f"Error: session '{session_id}' not found", file=sys.stderr)
    sys.exit(1)

cp = sessions[session_id].setdefault("cross_project", {})
cp["shared_group"] = group_name

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Set shared_group '{group_name}' on session '{session_id}'")
PYEOF
}

# ---------------------------------------------------------------------------
# check_impact
# Find all sessions where the given session appears in their depended_by list.
# Prints impact list showing which sessions would be affected by changes.
# Args: session_id
# ---------------------------------------------------------------------------
check_impact() {
  local session_id="$1"

  python3 - "${session_id}" <<'PYEOF'
import json, sys, os

session_id = sys.argv[1]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file) as f:
    data = json.load(f)

sessions = data.get("sessions", {})

if session_id not in sessions:
    print(f"Error: session '{session_id}' not found", file=sys.stderr)
    sys.exit(1)

# Find all sessions that depend on session_id
# i.e., sessions where session_id is in their cross_project.depended_by
# OR session_id is in their cross_project.depends_on (depends_on this session)
impacted = []
for sid, s in sessions.items():
    if sid == session_id:
        continue
    cp = s.get("cross_project", {})
    depends_on = cp.get("depends_on", [])
    if session_id in depends_on:
        impacted.append((sid, s))

if not impacted:
    print(f"No sessions are impacted by changes to '{session_id}'")
    sys.exit(0)

print(f"Sessions impacted by changes to '{session_id}':")
for sid, s in impacted:
    stype  = s.get("type", "?")
    branch = s.get("branch", "?")
    status = s.get("status", "?")
    project = s.get("project", "?")
    print(f"  {sid} | project={project} | type={stype} | branch={branch} | status={status}")
PYEOF
}

# ---------------------------------------------------------------------------
# list_project_deps
# Print project-level dependencies from projects.json for a given project.
# Args: project
# ---------------------------------------------------------------------------
list_project_deps() {
  local project="$1"

  python3 - "${project}" <<'PYEOF'
import json, sys, os

project = sys.argv[1]
projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))

with open(projects_file) as f:
    data = json.load(f)

aliases = data.get("aliases", {})

if project not in aliases:
    print(f"Error: project '{project}' not found", file=sys.stderr)
    sys.exit(1)

deps = aliases[project].get("dependencies", [])

if not deps:
    print(f"Project '{project}' has no dependencies")
    sys.exit(0)

print(f"Dependencies for project '{project}':")
for dep in deps:
    dep_info = aliases.get(dep, {})
    local_path = dep_info.get("local", "?")
    repo = dep_info.get("repo", "?")
    print(f"  {dep} | local={local_path} | repo={repo}")
PYEOF
}
