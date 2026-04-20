#!/usr/bin/env bash
# exec-mode-lib.sh — shared bash helpers for bin/exec-mode-experiment.sh.
# Scope (build spec §7 T2): retry_with_backoff, emit_metrics,
# stage1_capture_jsonl (window slicer), compact_detect (grader wrapper).
# Source this file; functions are under the execmode:: namespace.

[[ "${_EXECMODE_LIB_SOURCED:-}" == "1" ]] && return 0
_EXECMODE_LIB_SOURCED=1

# Repo root resolved relative to this file.
EXECMODE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECMODE_REPO_ROOT="$(cd "$EXECMODE_LIB_DIR/../.." && pwd)"

# ─── internal: run a command under a wallclock timeout (best-effort) ────────
execmode::__run_with_timeout() {
  local t=$1; shift
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout --kill-after=5 "$t" "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=5 "$t" "$@"
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift @ARGV; exec @ARGV' "$t" "$@"
  else
    "$@"
  fi
}

# ─── retry_with_backoff ─────────────────────────────────────────────────────
# Usage: execmode::retry_with_backoff <max> <timeout_sec> <cooloff_sec> -- cmd...
# Retries cmd until it exits 0 or `max` attempts are spent. If the command's
# stderr matches a rate-limit pattern, waits `cooloff_sec` before retry;
# otherwise waits 1s. Returns the exit code of the last attempt.
#
# Honors EXECMODE_RETRY_QUIET=1 to suppress retry chatter to stderr.
execmode::retry_with_backoff() {
  local max=$1 timeout_sec=$2 cooloff=$3
  shift 3
  [[ "${1:-}" == "--" ]] && shift

  if (( max < 1 )); then
    echo "retry_with_backoff: max must be >= 1" >&2
    return 2
  fi

  local attempt=0 ec=0 errfile run_ec=0
  while (( attempt < max )); do
    attempt=$((attempt + 1))
    errfile="$(mktemp -t execmode-retry.XXXXXX)"
    execmode::__run_with_timeout "$timeout_sec" "$@" 2>"$errfile"
    run_ec=$?
    if (( run_ec == 0 )); then
      cat "$errfile" >&2
      rm -f "$errfile"
      return 0
    fi
    ec=$run_ec
    cat "$errfile" >&2
    local is_rate=0
    if grep -qiE 'rate[_-]?limit|HTTP 429|too many requests' "$errfile"; then
      is_rate=1
    fi
    rm -f "$errfile"

    if (( attempt >= max )); then
      break
    fi

    if (( is_rate == 1 )); then
      [[ "${EXECMODE_RETRY_QUIET:-0}" == "1" ]] || \
        echo "[retry_with_backoff] rate limit detected; cool-off ${cooloff}s (attempt ${attempt}/${max}, ec=${ec})" >&2
      sleep "$cooloff"
    else
      [[ "${EXECMODE_RETRY_QUIET:-0}" == "1" ]] || \
        echo "[retry_with_backoff] exit=${ec}; retrying (attempt ${attempt}/${max})" >&2
      sleep 1
    fi
  done
  return "$ec"
}

# ─── emit_metrics ───────────────────────────────────────────────────────────
# Usage: ... | execmode::emit_metrics <path>
# Reads JSON from stdin, validates it parses, writes atomically via
# tmp-file + rename. Preserves existing file on invalid JSON.
execmode::emit_metrics() {
  local path="${1:-}"
  if [[ -z "$path" ]]; then
    echo "emit_metrics: path argument required" >&2
    return 2
  fi
  local dir
  dir="$(dirname "$path")"
  mkdir -p "$dir"

  local tmp
  tmp="$(mktemp "${path}.tmp.XXXXXX")"
  cat >"$tmp"

  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  if [[ -z "$py" ]]; then
    rm -f "$tmp"
    echo "emit_metrics: no python interpreter available for validation" >&2
    return 3
  fi

  if ! "$py" -c "import json,sys; json.load(open(sys.argv[1]))" "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    echo "emit_metrics: stdin was not valid JSON" >&2
    return 3
  fi
  mv -f "$tmp" "$path"
}

# ─── stage1_capture_jsonl ───────────────────────────────────────────────────
# Usage: execmode::stage1_capture_jsonl <src_jsonl> <start_iso> <end_iso> <out_jsonl>
# Copies lines of src_jsonl whose `timestamp` field lies within
# [start_iso, end_iso] inclusive. Malformed lines and lines without a
# parseable timestamp are silently skipped. Emits a one-line summary to
# stderr.
execmode::stage1_capture_jsonl() {
  local src="${1:-}" start="${2:-}" end="${3:-}" out="${4:-}"
  if [[ -z "$src" || -z "$start" || -z "$end" || -z "$out" ]]; then
    echo "stage1_capture_jsonl: usage: <src_jsonl> <start_iso> <end_iso> <out_jsonl>" >&2
    return 2
  fi
  if [[ ! -f "$src" ]]; then
    echo "stage1_capture_jsonl: source not found: $src" >&2
    return 2
  fi

  local out_dir
  out_dir="$(dirname "$out")"
  mkdir -p "$out_dir"

  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  if [[ -z "$py" ]]; then
    echo "stage1_capture_jsonl: no python interpreter available" >&2
    return 3
  fi

  "$py" - "$src" "$start" "$end" "$out" <<'PY'
import json, sys
from datetime import datetime

src, start, end, out_path = sys.argv[1:5]

def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))

try:
    s = parse(start)
    e = parse(end)
except ValueError as exc:
    print(f"stage1_capture_jsonl: bad bound: {exc}", file=sys.stderr)
    sys.exit(2)

kept = total = 0
with open(src, "r", encoding="utf-8") as fin, open(out_path, "w", encoding="utf-8") as fout:
    for line in fin:
        total += 1
        line = line.rstrip("\n")
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = obj.get("timestamp")
        if not isinstance(ts, str):
            continue
        try:
            t = parse(ts)
        except ValueError:
            continue
        if s <= t <= e:
            fout.write(line + "\n")
            kept += 1
print(f"[stage1_capture_jsonl] kept {kept}/{total} records", file=sys.stderr)
PY
}

# ─── compact_detect ─────────────────────────────────────────────────────────
# Usage: execmode::compact_detect <trial_jsonl>
# Emits a JSON object to stdout with fields:
#   {"detected": bool, "reason": str|null,
#    "cache_read_drop_ratio": num|null, "next_input_spike_ratio": num|null}
# Delegates to bin/exec-mode-grader.py --detect-compact (landed in T3).
# Tests and early-integration callers can override the backend by setting
# EXECMODE_COMPACT_CMD=/path/to/script — will be invoked as
# `$EXECMODE_COMPACT_CMD <trial_jsonl>`.
execmode::compact_detect() {
  local jsonl="${1:-}"
  if [[ -z "$jsonl" ]]; then
    echo "compact_detect: jsonl path required" >&2
    return 2
  fi
  if [[ ! -f "$jsonl" ]]; then
    echo "compact_detect: file not found: $jsonl" >&2
    return 2
  fi

  if [[ -n "${EXECMODE_COMPACT_CMD:-}" ]]; then
    "$EXECMODE_COMPACT_CMD" "$jsonl"
    return $?
  fi

  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  local grader="${EXECMODE_GRADER:-$EXECMODE_REPO_ROOT/bin/exec-mode-grader.py}"
  if [[ ! -x "$py" ]]; then
    echo "compact_detect: venv python not found at $py" >&2
    return 3
  fi
  if [[ ! -f "$grader" ]]; then
    echo "compact_detect: grader not found at $grader (expected to land in T3)" >&2
    return 3
  fi
  "$py" "$grader" --detect-compact "$jsonl"
}

# ─── T6: Pacc chain state (.chain_state.json) ──────────────────────────────
# Path convention: <state_root>/<run_idx>/Pacc/<fixture>/chain_sess<S>.json
# Schema (informal):
#   {"session_idx":N, "fixture_id":"Fa", "run_idx":1,
#    "status":"active"|"completed"|"crashed",
#    "fixtures_completed":[{"position_in_chain":P,"seed_idx":N,"trial_id":"...","at":"iso"} ...]}
# R8 (build spec §5): on Pacc session crash → discard session, rerun cheap.

execmode::chain_state_path() {
  # Usage: execmode::chain_state_path <state_root> <run_idx> <fixture> <session_idx>
  local sr=$1 run=$2 fix=$3 sess=$4
  echo "$sr/$run/Pacc/$fix/chain_sess${sess}.json"
}

# Exit 0 if path exists AND parses AND status=="crashed". Nonzero otherwise.
execmode::chain_state_is_crashed() {
  local path="${1:-}"
  [[ -n "$path" && -f "$path" ]] || return 1
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || return 1
  "$py" - "$path" <<'PY'
import json, sys
try:
    c = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sys.exit(0 if c.get("status") == "crashed" else 1)
PY
}

# Usage: execmode::chain_state_append <path> <run_idx> <fixture> <session_idx> <position> <seed_idx> <trial_id> <at_iso>
# Creates file with status=active if missing; appends entry (dedup on (position,seed)); atomic via tempfile.
execmode::chain_state_append() {
  local path=$1 run=$2 fix=$3 sess=$4 pos=$5 seed=$6 tid=$7 at=$8
  local dir; dir="$(dirname "$path")"
  mkdir -p "$dir"
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || { echo "chain_state_append: no python interpreter available" >&2; return 3; }

  "$py" - "$path" "$run" "$fix" "$sess" "$pos" "$seed" "$tid" "$at" <<'PY'
import json, os, sys, tempfile
path, run, fix, sess, pos, seed, tid, at = sys.argv[1:9]
state = None
if os.path.exists(path):
    try:
        state = json.load(open(path))
    except Exception:
        state = None
if not isinstance(state, dict):
    state = {
        "session_idx": int(sess),
        "fixture_id": fix,
        "run_idx": int(run),
        "status": "active",
        "fixtures_completed": [],
    }
entries = state.setdefault("fixtures_completed", [])
key = (int(pos), int(seed))
if not any((e.get("position_in_chain"), e.get("seed_idx")) == key for e in entries):
    entries.append({
        "position_in_chain": int(pos),
        "seed_idx":          int(seed),
        "trial_id":          tid,
        "at":                at,
    })
tmp = tempfile.NamedTemporaryFile(
    "w",
    dir=os.path.dirname(path) or ".",
    delete=False,
    prefix=os.path.basename(path) + ".tmp.",
)
json.dump(state, tmp, sort_keys=True)
tmp.flush()
tmp.close()
os.replace(tmp.name, path)
PY
}
