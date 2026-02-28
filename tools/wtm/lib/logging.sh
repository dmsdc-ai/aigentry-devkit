#!/usr/bin/env bash
# WTM Structured Logging - JSON event log with rotation
# Appends structured JSONL entries for audit trail and debugging

WTM_EVENT_LOG="${WTM_HOME}/logs/events.jsonl"
WTM_LOG_MAX_ENTRIES=50000
WTM_LOG_KEEP_ENTRIES=10000

# Append structured JSON log entry
# Args: level event message [key=value pairs...]
# All user values passed via argv/stdin (no shell injection)
log_json() {
  local level="$1" event="$2" message="$3"
  shift 3
  local kv_args=()
  while [[ $# -gt 0 ]]; do
    kv_args+=("$1")
    shift
  done
  printf '%s\n' "${kv_args[@]}" | python3 -c "
import json, sys, datetime
kv_lines = [line.strip() for line in sys.stdin if '=' in line.strip()]
data = {}
for kv in kv_lines:
    key, _, val = kv.partition('=')
    data[key] = val
entry = {
    'ts': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'level': sys.argv[1],
    'event': sys.argv[2],
    'message': sys.argv[3],
    'data': data
}
print(json.dumps(entry, ensure_ascii=False))
" "${level}" "${event}" "${message}" >> "${WTM_EVENT_LOG}"
}

# Rotate log when exceeding max entries
# Keeps the most recent WTM_LOG_KEEP_ENTRIES lines
log_rotate() {
  [[ -f "${WTM_EVENT_LOG}" ]] || return 0
  local line_count
  line_count=$(wc -l < "${WTM_EVENT_LOG}" | tr -d ' ')
  if [[ ${line_count} -gt ${WTM_LOG_MAX_ENTRIES} ]]; then
    local tmp="${WTM_EVENT_LOG}.tmp"
    tail -n "${WTM_LOG_KEEP_ENTRIES}" "${WTM_EVENT_LOG}" > "${tmp}"
    mv "${tmp}" "${WTM_EVENT_LOG}"
    log_info "Log rotated: kept last ${WTM_LOG_KEEP_ENTRIES} of ${line_count} entries"
  fi
}
