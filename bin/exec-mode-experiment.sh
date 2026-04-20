#!/usr/bin/env bash
# exec-mode-experiment.sh — per-trial driver for the exec-mode experiment.
# Build spec §2, §3.1, §7.1. Spec §4–§8.
#
# CLI contract (locked by build spec §3.1):
#   exec-mode-experiment.sh \
#     --fixture FX \
#     --mode D|Pfresh|Pacc|S \
#     --seed-idx N \
#     [--session-idx S]          # Pacc only
#     [--position-in-chain P]    # Pacc only
#     --run-idx N                # replication 1|2
#     [--dry-run]                # skip all LLM calls; emit synthetic metrics
#     [--resume]                 # skip when metrics.json already exists
#     [--state-root PATH]        # override XDG_STATE_HOME-based default
#     [--fixtures-root PATH]     # override AIGENTRY_EXEC_FIXTURES env/default
#
# Output:
#   <state-root>/<run_idx>/<mode>/<fixture>/seed<NN>[_pos<P>_sess<S>]/metrics.json
#
# Exit codes (build spec §3.1):
#   0 = ok
#   2 = timeout
#   3 = rate-limit exhausted
#   4 = compact-blocked
#   5 = malformed-fixture / malformed-args
#
# T5 scope: D + S Stage 1 executors, --dry-run path complete.
# T6 adds Pfresh + Pacc; T7 adds Stage 2 probe replay. Until then, --dry-run
# emits schema-valid synthetic data and the live path is a stub that exits 5
# with an explanatory message.

set -euo pipefail
export LC_ALL="${LC_ALL:-C}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=./lib/exec-mode-lib.sh
source "$SCRIPT_DIR/lib/exec-mode-lib.sh"
# shellcheck source=./lib/platform.sh
source "$SCRIPT_DIR/lib/platform.sh"

# ─── arg parse ───────────────────────────────────────────────────────────────
fixture=""
mode=""
seed_idx=""
session_idx=""
position_in_chain=""
run_idx=""
dry_run=0
resume=0
state_root="${AIGENTRY_EXEC_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/aigentry/exec-mode-experiment}"
fixtures_root="${AIGENTRY_EXEC_FIXTURES:-$HOME/projects/aigentry-orchestrator/fixtures/exec-mode-experiment}"

usage() {
  sed -n '2,30p' "$0"
}

die() {
  local ec=$1; shift
  echo "exec-mode-experiment: $*" >&2
  exit "$ec"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --fixture)           fixture="$2"; shift 2;;
    --mode)              mode="$2"; shift 2;;
    --seed-idx)          seed_idx="$2"; shift 2;;
    --session-idx)       session_idx="$2"; shift 2;;
    --position-in-chain) position_in_chain="$2"; shift 2;;
    --run-idx)           run_idx="$2"; shift 2;;
    --dry-run)           dry_run=1; shift;;
    --resume)            resume=1; shift;;
    --state-root)        state_root="$2"; shift 2;;
    --fixtures-root)     fixtures_root="$2"; shift 2;;
    -h|--help)           usage; exit 0;;
    *) die 5 "unknown arg: $1";;
  esac
done

[ -z "$fixture"   ] && die 5 "--fixture required"
[ -z "$mode"      ] && die 5 "--mode required"
[ -z "$seed_idx"  ] && die 5 "--seed-idx required"
[ -z "$run_idx"   ] && die 5 "--run-idx required"

case "$mode" in
  D|Pfresh|Pacc|S) ;;
  *) die 5 "--mode must be one of D|Pfresh|Pacc|S (got: $mode)";;
esac
[[ "$fixture"  =~ ^F[0-9a-zA-Z]+$ ]]   || die 5 "--fixture must match ^F[0-9a-zA-Z]+$ (got: $fixture)"
[[ "$seed_idx" =~ ^[0-9]+$          ]] || die 5 "--seed-idx must be a non-negative integer"
[[ "$run_idx"  =~ ^[12]$            ]] || die 5 "--run-idx must be 1 or 2"

if [ "$mode" = "Pacc" ]; then
  [ -z "$session_idx" ]       && die 5 "--session-idx required for Pacc"
  [ -z "$position_in_chain" ] && die 5 "--position-in-chain required for Pacc"
  [[ "$session_idx"        =~ ^[0-9]+$ ]] || die 5 "--session-idx must be non-negative integer"
  [[ "$position_in_chain"  =~ ^([1-9]|10)$ ]] || die 5 "--position-in-chain must be 1..10"
else
  [ -n "$session_idx" ] && die 5 "--session-idx only valid for Pacc"
  [ -n "$position_in_chain" ] && die 5 "--position-in-chain only valid for Pacc"
fi

# fixtures_root is parsed for T6/T7 (warmup replay, probe loading). T5's
# dry-run path doesn't read fixture files, so reference it here to document
# intent and silence shellcheck SC2034.
# shellcheck disable=SC2034
_EXECMODE_FIXTURES_ROOT="$fixtures_root"

# ─── trial layout ────────────────────────────────────────────────────────────
seed_stem=$(printf "seed%02d" "$seed_idx")
if [ "$mode" = "Pacc" ]; then
  trial_stem="${seed_stem}_pos${position_in_chain}_sess${session_idx}"
  trial_id_tail="${seed_stem}_pos${position_in_chain}_sess${session_idx}"
else
  trial_stem="$seed_stem"
  trial_id_tail="$seed_stem"
fi

trial_dir="$state_root/$run_idx/$mode/$fixture/$trial_stem"
metrics_path="$trial_dir/metrics.json"
trial_id="${run_idx}/${mode}/${fixture}/${trial_id_tail}"

venv_py="$REPO_ROOT/.venv-exec-mode/bin/python"
[ -x "$venv_py" ] || die 5 "venv python not found at $venv_py; run: python3.14 -m venv .venv-exec-mode && .venv-exec-mode/bin/pip install -r requirements-exec-mode.txt"

# ─── resume short-circuit ────────────────────────────────────────────────────
if [ "$resume" -eq 1 ] && [ -f "$metrics_path" ]; then
  if "$venv_py" -c 'import json,sys; json.load(open(sys.argv[1]))' "$metrics_path" 2>/dev/null; then
    echo "exec-mode-experiment: resume hit — skipping $trial_id" >&2
    exit 0
  fi
  echo "exec-mode-experiment: resume found invalid metrics.json; re-running $trial_id" >&2
fi

mkdir -p "$trial_dir"
stage1_out_path="$trial_dir/stage1_output.md"
stage1_jsonl_path="$trial_dir/stage1.jsonl"
stage2_transcript_path="$trial_dir/stage2_transcript.md"
stage2_answers_path="$trial_dir/stage2_answers.json"

# ─── CLI versions (best-effort) ──────────────────────────────────────────────
capture_cli_version() {
  local bin=$1
  if command -v "$bin" >/dev/null 2>&1; then
    "$bin" --version 2>&1 | head -n1 | tr -d '\r'
  else
    echo "not-installed"
  fi
}

ver_claude=$(capture_cli_version claude)
ver_codex=$(capture_cli_version  codex)
ver_gemini=$(capture_cli_version gemini)
ver_telepty=$(capture_cli_version telepty)
if [ "$dry_run" -eq 1 ]; then
  # Deterministic strings for test byte-equality.
  ver_claude="dry-run"
  ver_codex="dry-run"
  ver_gemini="dry-run"
  ver_telepty="dry-run"
fi

# ─── Stage 1 execution ───────────────────────────────────────────────────────
stage1_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

execmode::harness_stage1_dryrun() {
  # Synthesize deterministic stage1 artifacts for schema-level harness tests.
  # Output body embeds fixture+mode+seed so grader tests (in Session B) can
  # later reuse this skeleton without code changes.
  cat >"$stage1_out_path" <<EOF
# [DRY-RUN] Stage 1 output — mode=$mode fixture=$fixture seed=$seed_idx run=$run_idx

Synthetic agent output for harness dry-run path. Contains no planted facts.
No real LLM was invoked. See bin/exec-mode-experiment.sh for context.
EOF
  # Minimal valid Claude-style JSONL so the grader's jsonl parser (T3) stays happy.
  cat >"$stage1_jsonl_path" <<EOF
{"type":"user","timestamp":"$stage1_start","message":{"role":"user","content":[{"type":"text","text":"dry-run task"}]}}
{"type":"assistant","timestamp":"$stage1_start","message":{"role":"assistant","model":"dry-run","usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}},"content":[{"type":"text","text":"dry-run response"}]}}
EOF
}

execmode::harness_stage1_live_D() {
  die 5 "mode D live execution is T5 Phase-2 scope; current harness only supports --dry-run. See docs/superpowers/plans/2026-04-20-exec-mode-harness-buildplan.md T5/T6/T7."
}

execmode::harness_stage1_live_S() {
  die 5 "mode S live execution is T5 Phase-2 scope; current harness only supports --dry-run."
}

execmode::harness_stage1_live_Pfresh() {
  die 5 "mode Pfresh is implemented in T6; current harness only supports --dry-run."
}

execmode::harness_stage1_live_Pacc() {
  die 5 "mode Pacc is implemented in T6; current harness only supports --dry-run."
}

if [ "$dry_run" -eq 1 ]; then
  execmode::harness_stage1_dryrun
else
  case "$mode" in
    D)      execmode::harness_stage1_live_D;;
    S)      execmode::harness_stage1_live_S;;
    Pfresh) execmode::harness_stage1_live_Pfresh;;
    Pacc)   execmode::harness_stage1_live_Pacc;;
  esac
fi

stage1_end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ─── Stage 2 probe (stubbed in T5; real impl in T7) ──────────────────────────
stage2_start="$stage1_end"
stage2_end="$stage1_end"

if [ "$dry_run" -eq 1 ]; then
  cat >"$stage2_transcript_path" <<EOF
[DRY-RUN] Stage 2 frozen transcript for $trial_id
EOF
  {
    printf '{"probes":['
    for i in 0 1 2 3 4 5 6 7 8 9; do
      [ "$i" -gt 0 ] && printf ','
      printf '{"probe_idx":%d,"answer":"dry-run"}' "$i"
    done
    printf ']}\n'
  } >"$stage2_answers_path"
fi

# ─── metrics.json assembly ───────────────────────────────────────────────────
# Python is our single JSON construction tool — cleaner than shell quoting, and
# it validates the payload against state/schema/metrics.v1.json before the
# atomic write. Failure to validate exits 5 (malformed).

"$venv_py" - <<PY | execmode::emit_metrics "$metrics_path"
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

repo = Path("$REPO_ROOT")
schema = json.loads((repo / "state/schema/metrics.v1.json").read_text())
validator = Draft202012Validator(schema)

mode = "$mode"
dry_run = bool(int("$dry_run"))
pacc = mode == "Pacc"

def maybe_int(s):
    s = s.strip()
    return int(s) if s else None

sess_idx = maybe_int("${session_idx:-}")
pos_idx  = maybe_int("${position_in_chain:-}")

metrics = {
    "schema_version": "1",
    "trial_id": "$trial_id",
    "fixture_id": "$fixture",
    "mode": mode,
    "seed_idx": int("$seed_idx"),
    "run_idx": int("$run_idx"),
    "session_idx": sess_idx if pacc else None,
    "position_in_chain": pos_idx if pacc else None,
    "status": "ok",
    "dry_run": dry_run,
    "timestamps": {
        "stage1_start": "$stage1_start",
        "stage1_end":   "$stage1_end",
        "stage2_start": "$stage2_start" or None,
        "stage2_end":   "$stage2_end" or None,
    },
    "cli_versions": {
        "claude":  "$ver_claude",
        "codex":   "$ver_codex",
        "gemini":  "$ver_gemini",
        "telepty": "$ver_telepty",
    },
    "cost": {
        "marginal_usd": 0.0,
        "amort_usd": {"n_1": 0.0, "n_10": 0.0, "n_30": 0.0},
        "warmup_cost_usd": 0.0,
        "subagent_cost_usd": 0.0,
        "usage_buckets": {
            "input_tokens": 0,
            "cache_write_5m_tokens": 0,
            "cache_write_1h_tokens": 0,
            "cache_read_tokens": 0,
            "output_tokens": 0,
        },
    },
    "compact": {
        "detected": False,
        "reason": None,
        "cache_read_drop_ratio": None,
        "next_input_spike_ratio": None,
    },
    "quality": {
        "primary": 0.0 if dry_run else None,
        "length_capped": False,
        "human_review_queued": False,
    },
    "pollution": {
        "self_rate": 0.0 if dry_run else None,
        "self_leaks_layer_a": [False] * 10,
        "self_layer_b_pending": [],
        "chain_rate":          None,
        "chain_leaks_layer_a": None,
    },
    "loss": {
        "rate": 0.0 if dry_run else None,
        "probe_order_seed": int("$seed_idx"),
        "probes": [
            {
                "probe_idx": i,
                "layer_a_hit": True,
                "layer_b_hit": False,
                "layer_b_ratio": None,
                "layer_c_pending": False,
                "recall": True,
            }
            for i in range(10)
        ],
    },
    "paths": {
        "stage1_output":     "stage1_output.md",
        "stage1_jsonl":      "stage1.jsonl",
        "stage2_transcript": "stage2_transcript.md" if dry_run else None,
        "stage2_answers":    "stage2_answers.json"  if dry_run else None,
    },
    "incidents": [],
}

errs = sorted(validator.iter_errors(metrics), key=lambda e: list(e.absolute_path))
if errs:
    for e in errs:
        print(f"schema violation at {list(e.absolute_path)}: {e.message}", file=sys.stderr)
    sys.exit(5)

json.dump(metrics, sys.stdout, sort_keys=True)
PY

echo "$trial_id ok metrics=$metrics_path"
exit 0
