#!/usr/bin/env bash
# WTM Atomic Operations - flock-based locking, journal, and rollback
# Provides safe concurrent access to shared WTM state files

WTM_LOCKS="${WTM_LOCKS:-${WTM_HOME}/locks}"
WTM_JOURNALS="${WTM_JOURNALS:-${WTM_HOME}/journals}"

# ---------------------------------------------------------------------------
# Locking
# ---------------------------------------------------------------------------

# Acquire an exclusive lock on a named resource.
# Tries flock binary (Linux), then Perl Fcntl::flock (macOS), then mkdir spinlock.
# Args: resource [timeout_seconds]
# Stdout: fd number (capture with fd=$(acquire_lock ...))
# Returns: 0 on success, 1 on timeout/failure
acquire_lock() {
  local resource="$1" timeout="${2:-30}"
  local lockfile="${WTM_LOCKS}/${resource}.lock"
  mkdir -p "${WTM_LOCKS}"

  # Open an fd pointing at the lock file
  local fd
  exec {fd}>"${lockfile}"

  # Try flock binary first (Linux, Homebrew coreutils on macOS)
  if command -v flock &>/dev/null; then
    if flock -w "${timeout}" "${fd}" 2>/dev/null; then
      echo "${fd}"
      return 0
    fi
  fi

  # macOS fallback: Perl Fcntl::flock with timeout loop
  local start
  start=$(date +%s)
  while true; do
    if perl -e "
      use Fcntl qw(:flock);
      open(my \$fh, '>&', ${fd}) or exit 1;
      exit(flock(\$fh, LOCK_EX | LOCK_NB) ? 0 : 1);
    " 2>/dev/null; then
      echo "${fd}"
      return 0
    fi
    local elapsed=$(( $(date +%s) - start ))
    if [[ ${elapsed} -ge ${timeout} ]]; then
      eval "exec ${fd}>&-"
      log_error "Lock timeout on ${resource} after ${timeout}s"
      return 1
    fi
    sleep 0.5
  done
}

# Release a lock by closing the file descriptor.
# Args: fd
release_lock() {
  local fd="$1"
  eval "exec ${fd}>&-"
}

# Convenience wrapper: acquire lock, run command, release lock.
# Args: resource command [args...]
# Returns: exit code of the command
with_lock() {
  local resource="$1"
  shift
  local fd
  fd=$(acquire_lock "${resource}" 30) || return 1
  "$@"
  local rc=$?
  release_lock "${fd}"
  return ${rc}
}

# Remove stale lock files that are not currently held.
# A lock file is stale if it can be exclusively locked immediately.
clean_stale_locks() {
  mkdir -p "${WTM_LOCKS}"
  local lockfile
  for lockfile in "${WTM_LOCKS}"/*.lock; do
    [[ -f "${lockfile}" ]] || continue
    local resource
    resource=$(basename "${lockfile}" .lock)
    local fd
    exec {fd}>"${lockfile}"
    # If we can acquire immediately, it was stale
    if flock -n "${fd}" 2>/dev/null || perl -e "
      use Fcntl qw(:flock);
      open(my \$fh, '>&', ${fd}) or exit 1;
      exit(flock(\$fh, LOCK_EX | LOCK_NB) ? 0 : 1);
    " 2>/dev/null; then
      eval "exec ${fd}>&-"
      rm -f "${lockfile}"
      log_info "Removed stale lock: ${resource}"
    else
      eval "exec ${fd}>&-"
    fi
  done
}

# ---------------------------------------------------------------------------
# Journal (rollback support)
# ---------------------------------------------------------------------------

# Begin a new journal for an operation.
# Args: op_name
# Stdout: journal file path (capture with journal_file=$(journal_begin ...))
journal_begin() {
  local op="$1"
  local timestamp
  timestamp=$(date +%s)
  local journal_id="${op}_${timestamp}_$$"
  local journal_file="${WTM_JOURNALS}/${journal_id}.json"
  mkdir -p "${WTM_JOURNALS}"

  python3 -c "
import json, sys
op = sys.argv[1]
jid = sys.argv[2]
path = sys.argv[3]
entry = {'id': jid, 'op': op, 'steps': [], 'status': 'in_progress'}
with open(path, 'w') as f:
    json.dump(entry, f, indent=2)
print(path)
" "${op}" "${journal_id}" "${journal_file}"
}

# Append a step to an existing journal.
# Reads from stdin: step_type, data, rollback_cmd, journal_file (one per line, key=value)
# Example:
#   printf 'step_type=create\ndata=sessions.json\nrollback_cmd=rm sessions.json\njournal_file=/path/journal.json\n' | journal_add_step
journal_add_step() {
  python3 -c "
import json, sys

lines = [l.strip() for l in sys.stdin if '=' in l.strip()]
params = {}
for line in lines:
    key, _, val = line.partition('=')
    params[key] = val

journal_file = params.get('journal_file', '')
if not journal_file:
    sys.exit(1)

step = {
    'step_type': params.get('step_type', 'unknown'),
    'data': params.get('data', ''),
    'rollback_cmd': params.get('rollback_cmd', '')
}

with open(journal_file, 'r') as f:
    journal = json.load(f)

journal['steps'].append(step)

with open(journal_file, 'w') as f:
    json.dump(journal, f, indent=2)
"
}

# Mark a journal as committed (operation succeeded).
# Args: journal_file
journal_commit() {
  local journal_file="$1"
  [[ -f "${journal_file}" ]] || return 1
  python3 -c "
import json, sys
path = sys.argv[1]
with open(path, 'r') as f:
    journal = json.load(f)
journal['status'] = 'committed'
with open(path, 'w') as f:
    json.dump(journal, f, indent=2)
" "${journal_file}"
}

# Roll back all steps in a journal in reverse order.
# Executes each step's rollback_cmd via shell.
# Args: journal_file
journal_rollback() {
  local journal_file="$1"
  [[ -f "${journal_file}" ]] || return 1
  log_warn "Rolling back journal: ${journal_file}"
  python3 -c "
import json, sys, subprocess

path = sys.argv[1]
with open(path, 'r') as f:
    journal = json.load(f)

steps = journal.get('steps', [])
for step in reversed(steps):
    cmd = step.get('rollback_cmd', '').strip()
    if cmd:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            print(f'Rollback step failed: {cmd}', file=sys.stderr)
            print(result.stderr, file=sys.stderr)

journal['status'] = 'rolled_back'
with open(path, 'w') as f:
    json.dump(journal, f, indent=2)
" "${journal_file}"
  log_info "Rollback complete for: ${journal_file}"
}

# ---------------------------------------------------------------------------
# Atomic JSON update
# ---------------------------------------------------------------------------

# Execute a python3 script under a lock named after the JSON file.
# Args: file python3_code [additional python3 args...]
# The python3 code receives the file path as sys.argv[1] by convention.
atomic_json_update() {
  local file="$1"
  shift
  with_lock "$(basename "${file}" .json)" python3 -c "$@"
}
