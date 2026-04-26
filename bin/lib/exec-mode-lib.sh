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
# Spec §4.4: one Pacc session visits all 10 fixtures in random order under a
# SINGLE claude session_id. Chain state therefore spans fixtures within a
# session — keying the path by fixture splits the chain so pos>1 cannot find
# pos=1's session_id (fix3, refs #329 full-pilot-fix2).
# Path convention: <state_root>/<run_idx>/Pacc/chain_sess<S>.json
# Schema (informal):
#   {"session_idx":N, "run_idx":1, "session_id":"claude-uuid",
#    "status":"active"|"completed"|"crashed",
#    "fixtures_completed":[{"position_in_chain":P,"seed_idx":N,
#                           "fixture_id":"Fa","trial_id":"...","at":"iso"} ...]}
# R8 (build spec §5): on Pacc session crash → discard session, rerun cheap.

execmode::chain_state_path() {
  # Usage: execmode::chain_state_path <state_root> <run_idx> <session_idx> [<mode>]
  # Phase 4 (spec §5.3): <mode> defaults to "Pacc" for Phase 3 back-compat.
  # Phase 4c Preuse arms pass their mode string so chain-state is isolated per arm.
  local sr=$1 run=$2 sess=$3 mode=${4:-Pacc}
  echo "$sr/$run/$mode/chain_sess${sess}.json"
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
        "fixture_id":        fix,
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

# ─── T10-followup: Pacc session_id persistence for --resume chains ─────────
# Pacc pos > 1 must resume the claude session opened at pos = 1. The claude
# CLI returns its session_id in stream-json `system`/`result` records; we
# stash it on the chain_state file so subsequent positions can look it up.

execmode::chain_state_set_session_id() {
  # Usage: execmode::chain_state_set_session_id <path> <run_idx> <session_idx> <session_id>
  # Creates the file if absent (status=active) and sets top-level session_id.
  local path=$1 run=$2 sess=$3 sid=$4
  [[ -n "$path" && -n "$sid" ]] || { echo "chain_state_set_session_id: path + session_id required" >&2; return 2; }
  local dir; dir="$(dirname "$path")"
  mkdir -p "$dir"
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || { echo "chain_state_set_session_id: no python interpreter" >&2; return 3; }

  "$py" - "$path" "$run" "$sess" "$sid" <<'PY'
import json, os, sys, tempfile
path, run, sess, sid = sys.argv[1:5]
state = None
if os.path.exists(path):
    try:
        state = json.load(open(path))
    except Exception:
        state = None
if not isinstance(state, dict):
    state = {
        "session_idx": int(sess),
        "run_idx": int(run),
        "status": "active",
        "fixtures_completed": [],
    }
state["session_id"] = sid
tmp = tempfile.NamedTemporaryFile(
    "w",
    dir=os.path.dirname(path) or ".",
    delete=False,
    prefix=os.path.basename(path) + ".tmp.",
)
json.dump(state, tmp, sort_keys=True)
tmp.flush(); tmp.close()
os.replace(tmp.name, path)
PY
}

execmode::chain_state_get_session_id() {
  # Usage: execmode::chain_state_get_session_id <path>
  # Echoes session_id to stdout; exits 1 if the field is missing/empty.
  local path=$1
  [[ -n "$path" && -f "$path" ]] || return 1
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || return 1
  "$py" - "$path" <<'PY'
import json, sys
try:
    state = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sid = state.get("session_id") if isinstance(state, dict) else None
if isinstance(sid, str) and sid:
    print(sid)
    sys.exit(0)
sys.exit(1)
PY
}

# ─── Phase 4c: substitute-compact chain-state additions ────────────────────
# Spec §5: additive `segment_start_position` field (default 1, back-compat for
# Phase 3 Pacc files); set AFTER cold-restart claude call per OQ-4.
# ADR §4.6.9 lines 343-347 (chain-state delta).

execmode::chain_state_set_segment_start_position() {
  # Usage: execmode::chain_state_set_segment_start_position <path> <new_position>
  # Atomic write parallel to chain_state_set_session_id; creates file if absent.
  local path=$1 new_pos=$2
  [[ -n "$path" && -n "$new_pos" ]] || { echo "chain_state_set_segment_start_position: path + new_position required" >&2; return 2; }
  local dir; dir="$(dirname "$path")"
  mkdir -p "$dir"
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || { echo "chain_state_set_segment_start_position: no python interpreter" >&2; return 3; }

  "$py" - "$path" "$new_pos" <<'PY'
import json, os, sys, tempfile
path, new_pos = sys.argv[1], int(sys.argv[2])
state = None
if os.path.exists(path):
    try:
        state = json.load(open(path))
    except Exception:
        state = None
if not isinstance(state, dict):
    state = {"status": "active", "fixtures_completed": []}
state["segment_start_position"] = new_pos
tmp = tempfile.NamedTemporaryFile(
    "w",
    dir=os.path.dirname(path) or ".",
    delete=False,
    prefix=os.path.basename(path) + ".tmp.",
)
json.dump(state, tmp, sort_keys=True)
tmp.flush(); tmp.close()
os.replace(tmp.name, path)
PY
}

execmode::chain_state_get_segment_start_position() {
  # Usage: execmode::chain_state_get_segment_start_position <path>
  # Echoes integer to stdout; defaults to 1 when file/field missing
  # (back-compat for Phase 3 chain_state.json; spec §5.2).
  local path=$1
  if [[ -z "$path" || ! -f "$path" ]]; then
    echo "1"
    return 0
  fi
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  if [[ -z "$py" ]]; then
    echo "1"
    return 0
  fi
  "$py" - "$path" <<'PY'
import json, sys
try:
    state = json.load(open(sys.argv[1]))
except Exception:
    print(1)
    sys.exit(0)
v = state.get("segment_start_position") if isinstance(state, dict) else None
try:
    print(int(v) if v is not None else 1)
except (TypeError, ValueError):
    print(1)
PY
}

execmode::preuse_compute_segment_input_tokens() {
  # Usage: execmode::preuse_compute_segment_input_tokens \
  #          <state_root> <run_idx> <mode> <session_idx> \
  #          <segment_start_position> <current_position> <chain_path>
  # Walks <state_root>/<run_idx>/<mode>/<fixture>/seed<NN>_pos<P>_sess<S>/metrics.json
  # for P in [segment_start_position .. current_position - 1]; sums
  # cost.usage_buckets.input_tokens; exits 5 (malformed) on missing prior
  # metrics per OQ-2 (chain corruption is fail-fast).
  # Echoes the integer sum to stdout on success.
  local sr=$1 run=$2 mode=$3 sess=$4 seg_start=$5 cur=$6 chain=$7
  [[ -n "$sr" && -n "$run" && -n "$mode" && -n "$sess" && -n "$seg_start" && -n "$cur" && -n "$chain" ]] \
    || { echo "preuse_compute_segment_input_tokens: 7 args required" >&2; return 2; }
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || { echo "preuse_compute_segment_input_tokens: no python interpreter" >&2; return 3; }

  "$py" - "$sr" "$run" "$mode" "$sess" "$seg_start" "$cur" "$chain" <<'PY'
import json, os, sys
sr, run, mode, sess, seg_start, cur, chain = sys.argv[1:8]
seg_start_i = int(seg_start); cur_i = int(cur); sess_i = int(sess)
try:
    state = json.load(open(chain))
except Exception as e:
    print(f"chain state unreadable: {chain}: {e}", file=sys.stderr); sys.exit(5)
entries = state.get("fixtures_completed") if isinstance(state, dict) else None
if not isinstance(entries, list):
    entries = []
by_pos = {}
for e in entries:
    if not isinstance(e, dict): continue
    try:
        p = int(e.get("position_in_chain"))
        s = int(e.get("seed_idx"))
        fix = str(e.get("fixture_id"))
    except (TypeError, ValueError):
        continue
    by_pos[p] = (s, fix)
total = 0
for p in range(seg_start_i, cur_i):
    if p not in by_pos:
        print(f"missing chain entry for position {p} in segment [{seg_start_i}..{cur_i-1}]", file=sys.stderr)
        sys.exit(5)
    seed, fix = by_pos[p]
    stem = "seed%02d_pos%d_sess%d" % (seed, p, sess_i)
    metrics_path = os.path.join(sr, run, mode, fix, stem, "metrics.json")
    if not os.path.exists(metrics_path):
        print(f"missing prior metrics: {metrics_path}", file=sys.stderr); sys.exit(5)
    try:
        m = json.load(open(metrics_path))
    except Exception as e:
        print(f"prior metrics unreadable {metrics_path}: {e}", file=sys.stderr); sys.exit(5)
    cost = m.get("cost") if isinstance(m, dict) else None
    buckets = cost.get("usage_buckets") if isinstance(cost, dict) else None
    if not isinstance(buckets, dict):
        print(f"prior metrics missing cost.usage_buckets: {metrics_path}", file=sys.stderr); sys.exit(5)
    try:
        total += int(buckets.get("input_tokens") or 0)
    except (TypeError, ValueError):
        pass
print(total)
PY
}

execmode::preuse_stage_inputs() {
  # Usage: execmode::preuse_stage_inputs <stage_dir> <setup_src> <task_src> \
  #          <prior_count> <prior_pos_1> <prior_fix_1> <prior_task_src_1> <prior_out_src_1> ...
  # Creates depth-1 symlinks under <stage_dir> for impl A's manifest-relative
  # path resolution. STRICT per OQ-3: fails fast if any source missing.
  # Spec §3.3.
  local stage=$1 setup_src=$2 task_src=$3 prior_count=$4
  shift 4
  [[ -n "$stage" && -n "$setup_src" && -n "$task_src" && -n "$prior_count" ]] \
    || { echo "preuse_stage_inputs: stage/setup/task/prior_count required" >&2; return 2; }
  [[ -f "$setup_src" ]] || { echo "preuse_stage_inputs: setup source missing: $setup_src" >&2; return 5; }
  [[ -f "$task_src"  ]] || { echo "preuse_stage_inputs: task source missing: $task_src"  >&2; return 5; }

  rm -rf "$stage"
  mkdir -p "$stage" "$stage/prior"
  ln -sf "$setup_src" "$stage/setup_history.md"
  ln -sf "$task_src"  "$stage/task_prompt.md"

  local i=0
  while [ "$i" -lt "$prior_count" ]; do
    local pos=$1 fix=$2 ptask=$3 pout=$4
    shift 4
    [[ -n "$pos" && -n "$fix" && -n "$ptask" ]] \
      || { echo "preuse_stage_inputs: prior turn $i missing pos/fix/ptask" >&2; return 2; }
    [[ -f "$ptask" ]] || { echo "preuse_stage_inputs: prior task source missing: $ptask" >&2; return 5; }
    # OQ-3 STRICT: stage1_output may legitimately be empty (impl A handles
    # missing per ADR §4.6.11 row 7) but the symlink target MUST exist if
    # specified. An empty path is treated as "no prior assistant".
    if [[ -n "$pout" ]]; then
      [[ -f "$pout" ]] || { echo "preuse_stage_inputs: prior output source missing: $pout" >&2; return 5; }
    fi
    ln -sf "$ptask" "$stage/prior/${pos}_${fix}.task"
    if [[ -n "$pout" ]]; then
      ln -sf "$pout" "$stage/prior/${pos}_${fix}.out"
    fi
    i=$((i + 1))
  done
}

execmode::preuse_build_manifest() {
  # Usage: execmode::preuse_build_manifest <stage_dir> <out_path> \
  #          <cut_id> <cut_tokens> <run_idx> <session_idx> \
  #          <segment_start_position> <compact_before_position> <current_position> \
  #          <current_fixture_id> <chain_path>
  # Constructs ADR §4.6.3 manifest as JSON with manifest-relative paths
  # (impl A's __main__ resolves against manifest parent dir per
  # bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py:236-245).
  # prior_turns derived from chain_state.fixtures_completed entries with
  # position_in_chain in [segment_start_position .. current_position - 1].
  local stage=$1 out=$2 cut_id=$3 cut_tokens=$4 run=$5 sess=$6
  local seg_start=$7 compact_before=$8 cur_pos=$9
  local cur_fix=${10} chain=${11}
  [[ -n "$stage" && -n "$out" && -n "$cut_id" && -n "$cut_tokens" && -n "$chain" ]] \
    || { echo "preuse_build_manifest: required args missing" >&2; return 2; }
  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || { echo "preuse_build_manifest: no python interpreter" >&2; return 3; }

  "$py" - "$out" "$cut_id" "$cut_tokens" "$run" "$sess" \
              "$seg_start" "$compact_before" "$cur_pos" "$cur_fix" "$chain" <<'PY'
import json, sys
out, cut_id, cut_tokens, run, sess, seg_start, compact_before, cur_pos, cur_fix, chain = sys.argv[1:11]
try:
    state = json.load(open(chain))
except Exception as e:
    print(f"chain unreadable: {e}", file=sys.stderr); sys.exit(5)
entries = state.get("fixtures_completed") if isinstance(state, dict) else []
seg_start_i = int(seg_start); cur_i = int(cur_pos)
prior = []
for e in entries or []:
    if not isinstance(e, dict): continue
    try:
        p = int(e.get("position_in_chain"))
    except (TypeError, ValueError):
        continue
    if not (seg_start_i <= p < cur_i):
        continue
    fix = str(e.get("fixture_id"))
    seed = int(e.get("seed_idx"))
    # Manifest-relative paths matching the symlink layout from preuse_stage_inputs.
    prior.append({
        "position_in_chain": p,
        "fixture_id":        fix,
        "seed_idx":          seed,
        "task_prompt_path":  f"prior/{p}_{fix}.task",
        "stage1_output_path": f"prior/{p}_{fix}.out",
    })
manifest = {
    "schema_version":            1,
    "cut_id":                    cut_id,
    "cut_tokens":                int(cut_tokens),
    "run_idx":                   int(run),
    "session_idx":               int(sess),
    "segment_start_position":    seg_start_i,
    "compact_before_position":   int(compact_before),
    "current_position":          cur_i,
    "current_fixture_id":        cur_fix,
    "current_task_prompt_path":  "task_prompt.md",
    "setup_history_path":        "setup_history.md",
    "prior_turns":               prior,
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, sort_keys=True)
PY
}

# ─── T7: Stage 2 probe-replay subprocess ───────────────────────────────────
# Isolation invariants (spec §5.4, §7.1; build spec §3.1):
#   (1) No CLAUDE_* env vars propagate into the subprocess (env -i scrub).
#   (2) Probe text delivered via stdin ONLY — no probes path in argv/env.
#   (3) Stage-1 jsonl is never touched by this function.
#
# Usage: execmode::stage2_probe_subprocess <transcript> <probes> <seed_idx> <out_answers>
# Override the subprocess command via EXECMODE_STAGE2_CMD (e.g. a mock for tests);
# default is "claude --print". Returns subprocess exit code.
execmode::stage2_probe_subprocess() {
  local transcript=$1 probes=$2 seed=$3 out=$4
  if [[ -z "$transcript" || -z "$probes" || -z "$seed" || -z "$out" ]]; then
    echo "stage2_probe_subprocess: usage: <transcript> <probes> <seed> <out_answers>" >&2
    return 2
  fi
  if [[ ! -f "$transcript" ]]; then
    echo "stage2_probe_subprocess: transcript not found: $transcript" >&2
    return 2
  fi
  if [[ ! -f "$probes" ]]; then
    echo "stage2_probe_subprocess: probes not found: $probes" >&2
    return 2
  fi

  local py="${EXECMODE_PY:-$EXECMODE_REPO_ROOT/.venv-exec-mode/bin/python}"
  if [[ ! -x "$py" ]]; then
    py="$(command -v python3 || true)"
  fi
  [[ -n "$py" ]] || { echo "stage2_probe_subprocess: no python interpreter available" >&2; return 3; }

  # Build the stdin payload (transcript + seed-shuffled probes) in a tempfile so
  # the subprocess only ever sees it on fd0 — never as an argv path.
  local stdin_tmp
  stdin_tmp="$(mktemp -t execmode-stage2-stdin.XXXXXX)"
  "$py" - "$transcript" "$probes" "$seed" >"$stdin_tmp" <<'PY'
import json, pathlib, random, sys
transcript = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()
probes_raw = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
seed = int(sys.argv[3])

probe_lines = [ln.strip() for ln in probes_raw.splitlines() if ln.strip()]
rng = random.Random(seed)
order = list(range(len(probe_lines)))
rng.shuffle(order)

parts = [
    "=== PRIOR CONVERSATION HISTORY ===",
    transcript,
    "=== PROBES (shuffled, seed=%d) ===" % seed,
]
for slot, i in enumerate(order):
    parts.append(f"Q{slot} (orig_idx={i}): {probe_lines[i]}")
parts.append("")
parts.append('Respond as a single JSON: {"probes":[{"probe_idx":<orig_idx>,"answer":"<text>"},...]}')
sys.stdout.write("\n".join(parts))
PY

  local out_dir; out_dir="$(dirname "$out")"
  mkdir -p "$out_dir"

  # env -i scrubs the entire env, then we re-inject the minimum needed for the
  # subprocess to actually run. CLAUDE_* (session id, trace id, etc.) are NOT
  # on the allow-list — that's the whole point of invariant (1).
  local cmd="${EXECMODE_STAGE2_CMD:-claude --print}"
  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    LANG="${LANG:-C}" \
    LC_ALL="${LC_ALL:-C}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    USER="${USER:-unknown}" \
    EXECMODE_STAGE2_SEED="$seed" \
    bash -c "$cmd" <"$stdin_tmp" >"$out"
  local ec=$?
  rm -f "$stdin_tmp"
  return "$ec"
}
