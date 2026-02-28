#!/usr/bin/env bash
# api.sh - External JSON API for programmatic access to WTM state
# Part of WTM (WorkTree Manager)

[[ -n "${WTM_HOME}" ]] || WTM_HOME="${HOME}/.wtm"

WTM_SESSIONS="${WTM_SESSIONS:-${WTM_HOME}/sessions.json}"
WTM_PROJECTS="${WTM_PROJECTS:-${WTM_HOME}/projects.json}"
WTM_LOGS="${WTM_LOGS:-${WTM_HOME}/logs}"

# ---------------------------------------------------------------------------
# api_status()
# Output JSON status summary of all sessions.
# {"sessions_count": N, "active": N, "lazy": N, "projects": [...]}
# ---------------------------------------------------------------------------
api_status() {
  python3 -c "
import json, sys, os

sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))
projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))

sessions = {}
if os.path.isfile(sessions_file):
    with open(sessions_file) as f:
        data = json.load(f)
    sessions = data.get('sessions', {})

projects = []
if os.path.isfile(projects_file):
    with open(projects_file) as f:
        pdata = json.load(f)
    projects = list(pdata.get('aliases', {}).keys())

total = len(sessions)
active = sum(1 for s in sessions.values() if s.get('status') == 'active')
lazy = sum(1 for s in sessions.values() if s.get('type') == 'lazy')

result = {
    'sessions_count': total,
    'active': active,
    'lazy': lazy,
    'projects': projects
}
print(json.dumps(result, indent=2))
"
}

# ---------------------------------------------------------------------------
# api_sessions([--json])
# Output sessions as JSON to stdout.
# ---------------------------------------------------------------------------
api_sessions() {
  local as_json=0
  [[ "${1:-}" == "--json" ]] && as_json=1

  python3 -c "
import json, sys, os

sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))

if not os.path.isfile(sessions_file):
    print(json.dumps([]))
    sys.exit(0)

with open(sessions_file) as f:
    data = json.load(f)

sessions = data.get('sessions', {})
result = []
for sid, s in sessions.items():
    entry = dict(s)
    entry['id'] = sid
    result.append(entry)

print(json.dumps(result, indent=2))
"
}

# ---------------------------------------------------------------------------
# api_projects([--json])
# Output projects as JSON to stdout.
# ---------------------------------------------------------------------------
api_projects() {
  local as_json=0
  [[ "${1:-}" == "--json" ]] && as_json=1

  python3 -c "
import json, sys, os

projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))

if not os.path.isfile(projects_file):
    print(json.dumps([]))
    sys.exit(0)

with open(projects_file) as f:
    data = json.load(f)

aliases = data.get('aliases', {})
result = []
for alias, cfg in aliases.items():
    entry = dict(cfg)
    entry['alias'] = alias
    result.append(entry)

print(json.dumps(result, indent=2))
"
}

# ---------------------------------------------------------------------------
# api_events([--follow] [--count N])
# Tail events.jsonl for real-time or historical event viewing.
# --follow: stream events in real-time (tail -f)
# --count N: show last N events (default 20)
# ---------------------------------------------------------------------------
api_events() {
  local follow=0
  local count=20
  local events_file="${WTM_LOGS}/events.jsonl"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --follow|-f) follow=1; shift ;;
      --count|-n)  count="${2:-20}"; shift 2 ;;
      *)           shift ;;
    esac
  done

  if [[ ! -f "${events_file}" ]]; then
    log_warn "No events log found: ${events_file}"
    echo "[]"
    return 0
  fi

  if [[ "${follow}" -eq 1 ]]; then
    tail -f "${events_file}"
  else
    tail -n "${count}" "${events_file}"
  fi
}

# ---------------------------------------------------------------------------
# api_session_detail(session_id)
# Output full session detail as JSON for a given session_id.
# ---------------------------------------------------------------------------
api_session_detail() {
  local session_id="$1"

  if [[ -z "${session_id}" ]]; then
    log_error "api_session_detail: session_id required"
    return 1
  fi

  python3 -c "
import json, sys, os

sessions_file = os.environ.get('WTM_SESSIONS', os.path.expanduser('~/.wtm/sessions.json'))
session_id = sys.argv[1]

if not os.path.isfile(sessions_file):
    print('{}')
    sys.exit(0)

with open(sessions_file) as f:
    data = json.load(f)

session = data.get('sessions', {}).get(session_id)
if session is None:
    print(json.dumps({'error': f'Session not found: {session_id}'}))
    sys.exit(1)

entry = dict(session)
entry['id'] = session_id
print(json.dumps(entry, indent=2))
" "${session_id}"
}
