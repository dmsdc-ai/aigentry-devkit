#!/usr/bin/env bash
# WTM Session Relationship Library - Parent/child, groups, and chain management
#
# Manages hierarchical and lateral relationships between WTM sessions:
#   - Parent/child tree structure
#   - Named groups for lateral organization
#   - Ordered chains (previous/next links)
#
# All write operations use with_lock for safe concurrent access.
# All python3 calls pass parameters via sys.argv (no shell interpolation).

# Source common if not already loaded
if [[ -z "${WTM_HOME:-}" ]]; then
  WTM_HOME="${HOME}/.wtm"
  WTM_SESSIONS="${WTM_HOME}/sessions.json"
fi

# ---------------------------------------------------------------------------
# set_parent
# Establish a parent/child relationship between two sessions.
# Atomically updates both sessions in a single locked write.
# Args: child_id parent_id
# ---------------------------------------------------------------------------
set_parent() {
  local child_id="$1"
  local parent_id="$2"

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${child_id}" "${parent_id}" <<'PYEOF'
import json, sys, os

child_id, parent_id = sys.argv[1], sys.argv[2]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})

if child_id not in sessions:
    print(f"Error: child session '{child_id}' not found", file=sys.stderr)
    sys.exit(1)
if parent_id not in sessions:
    print(f"Error: parent session '{parent_id}' not found", file=sys.stderr)
    sys.exit(1)

# Prevent circular references
def get_ancestors(sid, visited=None):
    visited = visited or set()
    if sid in visited:
        return visited
    visited.add(sid)
    parent = sessions[sid].get("parent_session")
    if parent and parent in sessions:
        get_ancestors(parent, visited)
    return visited

if child_id in get_ancestors(parent_id):
    print(f"Error: setting parent would create a circular reference", file=sys.stderr)
    sys.exit(1)

# Set child's parent
sessions[child_id]["parent_session"] = parent_id

# Append child to parent's child_sessions list
children = sessions[parent_id].setdefault("child_sessions", [])
if child_id not in children:
    children.append(child_id)

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Set parent: {child_id} -> {parent_id}")
PYEOF
}

# ---------------------------------------------------------------------------
# unset_parent
# Remove parent/child relationship for a session.
# Atomically updates both child and parent sessions.
# Args: child_id
# ---------------------------------------------------------------------------
unset_parent() {
  local child_id="$1"

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${child_id}" <<'PYEOF'
import json, sys, os

child_id = sys.argv[1]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})

if child_id not in sessions:
    print(f"Error: session '{child_id}' not found", file=sys.stderr)
    sys.exit(1)

parent_id = sessions[child_id].get("parent_session")
if not parent_id:
    print(f"Session '{child_id}' has no parent", file=sys.stderr)
    sys.exit(0)

# Remove parent reference from child
sessions[child_id]["parent_session"] = None

# Remove child from parent's child_sessions list
if parent_id in sessions:
    children = sessions[parent_id].get("child_sessions", [])
    sessions[parent_id]["child_sessions"] = [c for c in children if c != child_id]

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Unset parent for: {child_id} (was: {parent_id})")
PYEOF
}

# ---------------------------------------------------------------------------
# create_group
# Assign a named group to multiple sessions at once.
# Args: group_name session_id [session_id ...]
# ---------------------------------------------------------------------------
create_group() {
  local group_name="$1"
  shift
  local session_ids=("$@")

  if [[ ${#session_ids[@]} -eq 0 ]]; then
    log_error "create_group: no session IDs provided"
    return 1
  fi

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${group_name}" "${session_ids[@]}" <<'PYEOF'
import json, sys, os

group_name = sys.argv[1]
session_ids = sys.argv[2:]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})
missing = [sid for sid in session_ids if sid not in sessions]
if missing:
    print(f"Error: sessions not found: {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

for sid in session_ids:
    sessions[sid]["session_group"] = group_name

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Created group '{group_name}' with {len(session_ids)} session(s)")
PYEOF
}

# ---------------------------------------------------------------------------
# add_to_group
# Add a single session to a named group.
# Args: session_id group_name
# ---------------------------------------------------------------------------
add_to_group() {
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

sessions[session_id]["session_group"] = group_name

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Added '{session_id}' to group '{group_name}'")
PYEOF
}

# ---------------------------------------------------------------------------
# remove_from_group
# Remove a session from its current group (sets session_group to null).
# Args: session_id
# ---------------------------------------------------------------------------
remove_from_group() {
  local session_id="$1"

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${session_id}" <<'PYEOF'
import json, sys, os

session_id = sys.argv[1]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})
if session_id not in sessions:
    print(f"Error: session '{session_id}' not found", file=sys.stderr)
    sys.exit(1)

old_group = sessions[session_id].get("session_group")
sessions[session_id]["session_group"] = None

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Removed '{session_id}' from group '{old_group}'")
PYEOF
}

# ---------------------------------------------------------------------------
# list_group
# List all sessions belonging to a named group.
# Output: "sid|type|branch|status" per line
# Args: group_name
# ---------------------------------------------------------------------------
list_group() {
  local group_name="$1"

  python3 - "${group_name}" <<'PYEOF'
import json, sys, os

group_name = sys.argv[1]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file) as f:
    data = json.load(f)

sessions = data.get("sessions", {})
members = [
    (sid, s) for sid, s in sessions.items()
    if s.get("session_group") == group_name
]

if not members:
    print(f"No sessions in group '{group_name}'", file=sys.stderr)
    sys.exit(0)

for sid, s in members:
    stype  = s.get("type", "?")
    branch = s.get("branch", "?")
    status = s.get("status", "?")
    print(f"{sid}|{stype}|{branch}|{status}")
PYEOF
}

# ---------------------------------------------------------------------------
# chain_sessions
# Link two sessions in sequence: previous.session_chain.next = current,
# and current.session_chain.previous = previous.
# Atomically updates both sessions.
# Args: previous_id current_id
# ---------------------------------------------------------------------------
chain_sessions() {
  local previous_id="$1"
  local current_id="$2"

  with_lock "$(basename "${WTM_SESSIONS}" .json)" python3 - "${previous_id}" "${current_id}" <<'PYEOF'
import json, sys, os

previous_id, current_id = sys.argv[1], sys.argv[2]
sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

with open(sessions_file, "r") as f:
    data = json.load(f)

sessions = data.get("sessions", {})

if previous_id not in sessions:
    print(f"Error: session '{previous_id}' not found", file=sys.stderr)
    sys.exit(1)
if current_id not in sessions:
    print(f"Error: session '{current_id}' not found", file=sys.stderr)
    sys.exit(1)

# Set previous -> current link
prev_chain = sessions[previous_id].setdefault("session_chain", {})
prev_chain["next"] = current_id

# Set current -> previous link
curr_chain = sessions[current_id].setdefault("session_chain", {})
curr_chain["previous"] = previous_id

with open(sessions_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Chained: {previous_id} -> {current_id}")
PYEOF
}

# ---------------------------------------------------------------------------
# get_chain
# Walk previous/next links from a starting session and print the full chain
# as a numbered list, marking the given session as current.
# Args: session_id
# ---------------------------------------------------------------------------
get_chain() {
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

# Walk backward to find chain head
visited = set()
head = session_id
while True:
    if head in visited:
        # Cycle detected, stop
        break
    visited.add(head)
    prev = sessions.get(head, {}).get("session_chain", {}).get("previous")
    if not prev or prev not in sessions:
        break
    head = prev

# Walk forward from head to build ordered list
chain = []
visited2 = set()
cursor = head
while cursor:
    if cursor in visited2:
        break
    visited2.add(cursor)
    chain.append(cursor)
    nxt = sessions.get(cursor, {}).get("session_chain", {}).get("next")
    cursor = nxt if (nxt and nxt in sessions) else None

# Print numbered list
for i, sid in enumerate(chain, 1):
    marker = " <-- current" if sid == session_id else ""
    s = sessions.get(sid, {})
    branch = s.get("branch", "?")
    status = s.get("status", "?")
    print(f"{i}. {sid} [{branch}] ({status}){marker}")
PYEOF
}
