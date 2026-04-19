#!/usr/bin/env bash
# context.sh - Activity journal and session handoff system
# Part of WTM (WorkTree Manager) cross-dimension library

# Source common utilities if not already loaded
[[ -n "${WTM_HOME}" ]] || WTM_HOME="${HOME}/.wtm"
[[ -n "${WTM_SESSIONS}" ]] || WTM_SESSIONS="${WTM_HOME}/sessions.json"

# ---------------------------------------------------------------------------
# get_context_dir(session_id)
# Returns ~/.wtm/contexts/{project}/{type-name}
# Session ID format: "project:type-name"
# ---------------------------------------------------------------------------
get_context_dir() {
  local session_id="$1"
  local project type_name

  # Parse "project:type-name" format
  if [[ "${session_id}" == *:* ]]; then
    project="${session_id%%:*}"
    type_name="${session_id#*:}"
  else
    project="${session_id}"
    type_name="${session_id}"
  fi

  echo "${WTM_HOME}/contexts/${project}/${type_name}"
}

# ---------------------------------------------------------------------------
# init_context(session_id)
# Create context directory, touch journal.jsonl, update session's
# context.journal_path in sessions.json.
# ---------------------------------------------------------------------------
init_context() {
  local session_id="$1"
  local ctx_dir
  ctx_dir=$(get_context_dir "${session_id}")

  # Create context directory and empty journal
  mkdir -p "${ctx_dir}"
  touch "${ctx_dir}/journal.jsonl"

  # Update session's context.journal_path under lock
  with_lock "sessions" python3 -c "
import json, sys

sessions_file = sys.argv[1]
session_id = sys.argv[2]
journal_path = sys.argv[3]

try:
    with open(sessions_file, 'r') as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {}

if session_id not in data:
    data[session_id] = {}

if 'context' not in data[session_id]:
    data[session_id]['context'] = {}

data[session_id]['context']['journal_path'] = journal_path

with open(sessions_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
" "${WTM_SESSIONS}" "${session_id}" "${ctx_dir}/journal.jsonl"

  log_ok "Context initialized for ${session_id}: ${ctx_dir}"
}

# ---------------------------------------------------------------------------
# journal_append(session_id, entry_type, content, [metadata_json])
# Append JSONL entry with timestamp, type, content, metadata.
# Types: file_edit, command_run, decision, note, error, milestone
# ---------------------------------------------------------------------------
journal_append() {
  local session_id="$1"
  local entry_type="$2"
  local content="$3"
  local metadata="${4-}"
  : "${metadata:="{}"}"
  local ctx_dir
  ctx_dir=$(get_context_dir "${session_id}")
  local journal="${ctx_dir}/journal.jsonl"

  [[ -d "${ctx_dir}" ]] || mkdir -p "${ctx_dir}"

  python3 -c "
import json, sys, datetime
entry = {
    'timestamp': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'type': sys.argv[1],
    'content': sys.argv[2],
    'metadata': json.loads(sys.argv[3])
}
with open(sys.argv[4], 'a') as f:
    f.write(json.dumps(entry, ensure_ascii=False) + '\n')
" "${entry_type}" "${content}" "${metadata}" "${journal}"
}

# ---------------------------------------------------------------------------
# journal_tail(session_id, [count=20])
# Read last N entries, print formatted: "  timestamp  [type]  content"
# ---------------------------------------------------------------------------
journal_tail() {
  local session_id="$1"
  local count="${2:-20}"
  local ctx_dir
  ctx_dir=$(get_context_dir "${session_id}")
  local journal="${ctx_dir}/journal.jsonl"

  if [[ ! -f "${journal}" ]]; then
    log_warn "No journal found for session: ${session_id}"
    return 0
  fi

  python3 -c "
import json, sys

journal_file = sys.argv[1]
count = int(sys.argv[2])

try:
    with open(journal_file, 'r') as f:
        lines = f.readlines()
except FileNotFoundError:
    sys.exit(0)

# Take last N entries
recent = lines[-count:] if len(lines) > count else lines

for line in recent:
    line = line.strip()
    if not line:
        continue
    try:
        entry = json.loads(line)
        ts = entry.get('timestamp', 'unknown')
        etype = entry.get('type', 'unknown')
        content = entry.get('content', '')
        print(f'  {ts}  [{etype}]  {content}')
    except json.JSONDecodeError:
        print(f'  [malformed entry]  {line}')
" "${journal}" "${count}"
}

# ---------------------------------------------------------------------------
# journal_rotate(session_id, [keep=500])
# If entries > keep, archive old entries to gzip, keep last N.
# ---------------------------------------------------------------------------
journal_rotate() {
  local session_id="$1"
  local keep="${2:-500}"
  local ctx_dir
  ctx_dir=$(get_context_dir "${session_id}")
  local journal="${ctx_dir}/journal.jsonl"

  if [[ ! -f "${journal}" ]]; then
    return 0
  fi

  local total_lines
  total_lines=$(wc -l < "${journal}" | tr -d ' ')

  if [[ "${total_lines}" -le "${keep}" ]]; then
    return 0
  fi

  # Calculate how many old entries to archive
  local archive_count=$(( total_lines - keep ))
  local archive_ts
  archive_ts=$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || date +%Y%m%dT%H%M%SZ)
  local archive_file="${ctx_dir}/journal-archive-${archive_ts}.jsonl.gz"

  # Archive old entries (lines 1 to archive_count)
  head -n "${archive_count}" "${journal}" | gzip > "${archive_file}"

  # Keep only recent entries
  local tmp_file="${journal}.tmp"
  tail -n "${keep}" "${journal}" > "${tmp_file}"
  mv "${tmp_file}" "${journal}"

  log_info "Journal rotated: archived ${archive_count} entries to ${archive_file}, kept ${keep}"
}

# ---------------------------------------------------------------------------
# save_handoff(session_id, summary, open_files_json, pending_tasks_json)
# Write handoff to session's context.last_handoff field in sessions.json.
# ---------------------------------------------------------------------------
save_handoff() {
  local session_id="$1"
  local summary="$2"
  local open_files_json="${3:-[]}"
  local pending_tasks_json="${4:-[]}"

  with_lock "sessions" python3 -c "
import json, sys, datetime

sessions_file = sys.argv[1]
session_id = sys.argv[2]
summary = sys.argv[3]
open_files_raw = sys.argv[4]
pending_tasks_raw = sys.argv[5]

try:
    open_files = json.loads(open_files_raw)
except json.JSONDecodeError:
    open_files = []

try:
    pending_tasks = json.loads(pending_tasks_raw)
except json.JSONDecodeError:
    pending_tasks = []

try:
    with open(sessions_file, 'r') as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {}

if session_id not in data:
    data[session_id] = {}

if 'context' not in data[session_id]:
    data[session_id]['context'] = {}

data[session_id]['context']['last_handoff'] = {
    'timestamp': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'summary': summary,
    'open_files': open_files,
    'pending_tasks': pending_tasks
}

with open(sessions_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print('Handoff saved.')
" "${WTM_SESSIONS}" "${session_id}" "${summary}" "${open_files_json}" "${pending_tasks_json}"

  log_ok "Handoff saved for session: ${session_id}"
}

# ---------------------------------------------------------------------------
# restore_handoff(session_id)
# Read and display last_handoff from session.
# ---------------------------------------------------------------------------
restore_handoff() {
  local session_id="$1"

  python3 -c "
import json, sys

sessions_file = sys.argv[1]
session_id = sys.argv[2]

try:
    with open(sessions_file, 'r') as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    print('No sessions file found.')
    sys.exit(1)

# Schema-aware lookup: prefer nested {version, sessions:{sid:...}}; fall back
# to flat top-level {sid:...} for legacy v1 stores. (#300)
bucket = data.get('sessions') if isinstance(data.get('sessions'), dict) else data
session = bucket.get(session_id)
if not session:
    print(f'Session not found: {session_id}')
    sys.exit(1)

context = session.get('context', {})
handoff = context.get('last_handoff')

if not handoff:
    print(f'No handoff found for session: {session_id}')
    sys.exit(0)

print(f'=== Handoff for {session_id} ===')
print(f'Timestamp : {handoff.get(\"timestamp\", \"unknown\")}')
print(f'Summary   : {handoff.get(\"summary\", \"\")}')
print()
open_files = handoff.get('open_files', [])
if open_files:
    print('Open Files:')
    for f in open_files:
        print(f'  - {f}')
    print()
pending = handoff.get('pending_tasks', [])
if pending:
    print('Pending Tasks:')
    for t in pending:
        print(f'  - {t}')
" "${WTM_SESSIONS}" "${session_id}"
}

# ---------------------------------------------------------------------------
# orphan_check(cwd)
# Thin wrapper: find most recent session whose stored cwd matches (or is a
# prefix of) the given cwd, then emit last handoff + recent journal. No new
# storage — reads sessions.json + existing journal.jsonl.
# Schema: {"version":N,"sessions":{"sid":{"cwd":"/path","last_active":"...",...}}}
# ---------------------------------------------------------------------------
orphan_check() {
  local target_cwd="${1:-$(pwd)}"
  local sessions_file="${WTM_SESSIONS}"
  [[ -f "$sessions_file" ]] || { echo "no sessions file"; return 1; }
  local sid
  sid=$(jq -r --arg cwd "$target_cwd" '
    (.sessions // {})
    | to_entries
    | map(
        (.value.cwd // "") as $scwd
        | select(
            ($scwd == $cwd)
            or ($scwd != "" and ($scwd | startswith($cwd)))
            or ($scwd != "" and ($cwd | startswith($scwd)))
          )
      )
    | sort_by(.value.last_active // "")
    | reverse
    | (.[0].key // empty)
  ' "$sessions_file")
  [[ -z "$sid" ]] && { echo "no orphaned session for $target_cwd"; return 1; }
  echo "## Orphan session candidate: $sid"
  echo "### Last handoff"
  restore_handoff "$sid" 2>/dev/null || echo "(no handoff)"
  echo ""
  echo "### Recent journal (last 10)"
  journal_tail "$sid" 10 2>/dev/null || echo "(empty journal)"
}

# ---------------------------------------------------------------------------
# rebind_session(cwd, new_sid)
# Alias the most-recent orphan session matching cwd to new_sid. Copies the old
# entry under new_sid and records rebound_from + rebound_at. Uses with_lock.
# Schema-aware: operates on data["sessions"][sid] if present, else top-level.
# ---------------------------------------------------------------------------
rebind_session() {
  local target_cwd="${1:-}" new_sid="${2:-}"
  [[ -z "$target_cwd" || -z "$new_sid" ]] && { echo "rebind: cwd and new-sid required" >&2; return 2; }
  [[ -f "$WTM_SESSIONS" ]] || { echo "rebind: no sessions file at $WTM_SESSIONS" >&2; return 1; }
  local old_sid
  old_sid=$(jq -r --arg cwd "$target_cwd" '
    (.sessions // {})
    | to_entries
    | map(select((.value.cwd // "") == $cwd))
    | sort_by(.value.last_active // "")
    | reverse
    | (.[0].key // empty)
  ' "$WTM_SESSIONS")
  [[ -z "$old_sid" ]] && { echo "rebind: no orphan found for $target_cwd" >&2; return 1; }
  echo "Rebinding $old_sid -> $new_sid (cwd=$target_cwd)"
  with_lock "sessions" python3 -c "
import json, sys, datetime
f, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(f) as fh:
    data = json.load(fh)
bucket = data['sessions'] if 'sessions' in data and isinstance(data['sessions'], dict) else data
if old not in bucket:
    print(f'rebind: old sid {old} missing post-lock; aborting', file=sys.stderr)
    sys.exit(1)
bucket[new] = dict(bucket[old])
bucket[new]['rebound_from'] = old
bucket[new]['rebound_at'] = now
with open(f, 'w') as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
" "$WTM_SESSIONS" "$old_sid" "$new_sid"
}

# ---------------------------------------------------------------------------
# add_conversation_ref(session_id, ref)
# Append to context.conversation_refs[] without duplicates.
# ---------------------------------------------------------------------------
add_conversation_ref() {
  local session_id="$1"
  local ref="$2"

  with_lock "sessions" python3 -c "
import json, sys

sessions_file = sys.argv[1]
session_id = sys.argv[2]
ref = sys.argv[3]

try:
    with open(sessions_file, 'r') as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {'version': 3, 'sessions': {}}

sessions = data.setdefault('sessions', {})
if session_id not in sessions:
    sessions[session_id] = {}

s = sessions[session_id]
if 'context' not in s:
    s['context'] = {}

refs = s['context'].get('conversation_refs', [])

# Add without duplicates
if ref not in refs:
    refs.append(ref)
    s['context']['conversation_refs'] = refs
    print(f'Added ref: {ref}')
else:
    print(f'Ref already exists: {ref}')

with open(sessions_file, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
" "${WTM_SESSIONS}" "${session_id}" "${ref}"
}
