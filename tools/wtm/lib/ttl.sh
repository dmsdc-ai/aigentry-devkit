#!/usr/bin/env bash
# WTM TTL - Time-to-live based session cleanup

# Check if a session has exceeded its TTL
# Output: "EXPIRED|Xd overdue" or "ACTIVE|Xd Xh remaining" or "UNKNOWN"
check_session_ttl() {
  local session_id="$1"
  python3 -c "
import json, sys, datetime

sessions_path = sys.argv[1]
sid = sys.argv[2]

with open(sessions_path) as f:
    data = json.load(f)

s = data.get('sessions', {}).get(sid)
if not s:
    print('UNKNOWN')
    sys.exit(0)

created_str = s.get('created_at') or s.get('created')
if not created_str:
    print('UNKNOWN')
    sys.exit(0)

# Parse created timestamp (handle Z suffix)
created_str = created_str.replace('Z', '+00:00')
try:
    created = datetime.datetime.fromisoformat(created_str)
except ValueError:
    print('UNKNOWN')
    sys.exit(0)

# Ensure timezone-aware
if created.tzinfo is None:
    created = created.replace(tzinfo=datetime.timezone.utc)

ttl_hours = s.get('ttl_hours', 168)
now = datetime.datetime.now(datetime.timezone.utc)
age = now - created
ttl_delta = datetime.timedelta(hours=ttl_hours)
remaining = ttl_delta - age

if remaining.total_seconds() <= 0:
    overdue = -remaining
    days = overdue.days
    hours = overdue.seconds // 3600
    if days > 0:
        print(f'EXPIRED|{days}d overdue')
    else:
        print(f'EXPIRED|{hours}h overdue')
else:
    days = remaining.days
    hours = remaining.seconds // 3600
    print(f'ACTIVE|{days}d {hours}h remaining')
" "${WTM_SESSIONS}" "${session_id}"
}

# List all expired session IDs (one per line)
list_expired_sessions() {
  python3 -c "
import json, sys, datetime

sessions_path = sys.argv[1]

with open(sessions_path) as f:
    data = json.load(f)

sessions = data.get('sessions', {})
now = datetime.datetime.now(datetime.timezone.utc)

for sid, s in sessions.items():
    created_str = s.get('created_at') or s.get('created')
    if not created_str:
        continue
    created_str = created_str.replace('Z', '+00:00')
    try:
        created = datetime.datetime.fromisoformat(created_str)
    except ValueError:
        continue
    if created.tzinfo is None:
        created = created.replace(tzinfo=datetime.timezone.utc)
    ttl_hours = s.get('ttl_hours', 168)
    age = now - created
    ttl_delta = datetime.timedelta(hours=ttl_hours)
    if age > ttl_delta:
        print(sid)
" "${WTM_SESSIONS}"
}

# Remove all expired sessions (with backup)
# Pass --dry-run to only list what would be removed
cleanup_expired_sessions() {
  local dry_run=false
  [[ "${1:-}" == "--dry-run" ]] && dry_run=true

  local expired
  expired=$(list_expired_sessions)

  if [[ -z "${expired}" ]]; then
    log_info "No expired sessions found."
    return 0
  fi

  while IFS= read -r sid; do
    [[ -z "${sid}" ]] && continue
    if $dry_run; then
      log_info "[dry-run] Would remove expired session: ${sid}"
    else
      log_warn "Removing expired session: ${sid}"
      # Backup session data before removal
      local backup_dir="${WTM_BACKUPS}/ttl-cleanup"
      mkdir -p "${backup_dir}"
      local ts
      ts=$(date -u +"%Y%m%dT%H%M%SZ")
      python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
s = data.get('sessions', {}).get(sys.argv[2], {})
out_path = sys.argv[3]
with open(out_path, 'w') as f:
    json.dump(s, f, indent=2)
" "${WTM_SESSIONS}" "${sid}" "${backup_dir}/${sid//[:\/]/_}_${ts}.json"
      remove_session "${sid}"
    fi
  done <<< "${expired}"

  if ! $dry_run; then
    log_ok "Expired session cleanup complete."
  fi
}
