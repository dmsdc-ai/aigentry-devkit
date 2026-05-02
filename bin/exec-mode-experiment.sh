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
#     [--cut N]                  # Preuse-substitute-compact-revised cut_tokens
#                                # override (default 30; range 5..50000).
#                                # Phase 6 Q1 §3.1 binding: cut grid {5,10,15,20,30}.
#                                # NOTE: trial-path uniqueness across cuts is the
#                                # caller's concern — use distinct --state-root per
#                                # cut cell when running multiple cuts back-to-back.
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
# T10-followup scope: live-path wiring — D / Pfresh / Pacc / S stage1 executors
# backed by `claude --print` subprocess with isolated HOME (per smoke report
# docs/reports/2026-04-20-exec-mode-Fa-smoke.md). Pfresh replays warmup turns
# via `claude --resume` chaining so prior turns accumulate as genuine session
# history (Session D update 2026-04-20). Pacc uses the same --resume trick to
# reattach to prior positions' session_id stashed in `.chain_state.json`.
#
# Subprocess-mockable knobs (for bats integration; never set in production):
#   EXEC_MODE_HOME          isolated HOME dir containing .claude/settings.json={} +
#                           .claude/.credentials.json (0600). If unset, uses caller's HOME.
#   EXEC_MODE_MODEL         claude model flag (default: claude-opus-4-7).
#   EXECMODE_STAGE1_CMD     claude invocation for Stage 1 (mocks replace this
#                           with a script that consumes stdin + emits canned
#                           stream-json records).
#   EXECMODE_STAGE2_CMD     (consumed by execmode::stage2_probe_subprocess in lib).

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
cut_arg=""
cut_explicit=0
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
    --cut)               cut_arg="$2"; cut_explicit=1; shift 2;;
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

# Phase 4 mode set per spec §2.1: 4 Phase 3 modes preserved; 5 new modes added
# (Preuse-clear + Preuse-substitute-compact-C{1..4}). The cut suffix is parsed
# from the mode string to derive cut_tokens (spec §2.2 cut map; INV-5).
#
# Phase 6 Q1 §3.1 (post-tag harness extension, ref BLOCKER 2026-05-02):
# `--cut N` overrides cut_tokens for Preuse-substitute-compact-revised only.
# Default 30 reproduces sub-ADR 2026-05-01-substitute-compact-revised-cut.md
# behavior exactly when --cut is omitted. C1..C4 cut values stay locked
# (those are mode-encoded per Phase 4 spec §2.2).
preuse_cut_tokens=""
preuse_cut_id=""
case "$mode" in
  D|Pfresh|Pacc|S)
    ;;
  Preuse-clear)
    ;;
  Preuse-substitute-compact-C1) preuse_cut_id="C1"; preuse_cut_tokens=10000  ;;
  Preuse-substitute-compact-C2) preuse_cut_id="C2"; preuse_cut_tokens=50000  ;;
  Preuse-substitute-compact-C3) preuse_cut_id="C3"; preuse_cut_tokens=100000 ;;
  Preuse-substitute-compact-C4) preuse_cut_id="C4"; preuse_cut_tokens=150000 ;;
  Preuse-substitute-compact-revised) preuse_cut_id="revised"; preuse_cut_tokens=30 ;;
  *) die 5 "--mode must be one of D|S|Pfresh|Pacc|Preuse-clear|Preuse-substitute-compact-C{1,2,3,4}|Preuse-substitute-compact-revised (got: $mode)";;
esac

# `--cut N` validation + dispatch.
if [ "$cut_explicit" -eq 1 ]; then
  if [ "$mode" != "Preuse-substitute-compact-revised" ]; then
    die 5 "--cut only valid for --mode Preuse-substitute-compact-revised (got mode: $mode); C1..C4 cut values are locked"
  fi
  [[ "$cut_arg" =~ ^[1-9][0-9]*$ ]] \
    || die 5 "--cut must be a positive integer (got: $cut_arg)"
  if [ "$cut_arg" -lt 5 ] || [ "$cut_arg" -gt 50000 ]; then
    die 5 "--cut out of range [5..50000] (got: $cut_arg)"
  fi
  preuse_cut_tokens="$cut_arg"
fi

# Stderr echo so per-cell aggregation + smoke verification can split by cut.
# Cut value is also recorded in $trial_dir/.preuse_inputs/manifest.json for
# every trial that crosses the cut (lib::preuse_build_manifest, schema_version
# 1, field cut_tokens). Below-cut trials reuse Pacc semantics with no manifest.
if [ -n "$preuse_cut_tokens" ]; then
  echo "exec-mode-experiment: mode=$mode cut_id=$preuse_cut_id cut_tokens=$preuse_cut_tokens" >&2
fi

# Spec §2.3 + §2.4: Preuse arms use chain semantics (session/position required),
# matching Pacc's CLI shape. Group all chain modes for arg-validator widening.
is_chain_mode=0
case "$mode" in
  Pacc|Preuse-clear|Preuse-substitute-compact-C1|Preuse-substitute-compact-C2|Preuse-substitute-compact-C3|Preuse-substitute-compact-C4|Preuse-substitute-compact-revised)
    is_chain_mode=1
    ;;
esac

[[ "$fixture"  =~ ^[FH][0-9a-zA-Z]+$ ]] || die 5 "--fixture must match ^[FH][0-9a-zA-Z]+$ (got: $fixture)"
[[ "$seed_idx" =~ ^[0-9]+$          ]] || die 5 "--seed-idx must be a non-negative integer"
[[ "$run_idx"  =~ ^[12]$            ]] || die 5 "--run-idx must be 1 or 2"

if [ "$is_chain_mode" -eq 1 ]; then
  [ -z "$session_idx" ]       && die 5 "--session-idx required for chain modes (Pacc/Preuse-*)"
  [ -z "$position_in_chain" ] && die 5 "--position-in-chain required for chain modes (Pacc/Preuse-*)"
  [[ "$session_idx"        =~ ^[0-9]+$ ]] || die 5 "--session-idx must be non-negative integer"
  [[ "$position_in_chain"  =~ ^([1-9]|10)$ ]] || die 5 "--position-in-chain must be 1..10"
else
  [ -n "$session_idx" ] && die 5 "--session-idx only valid for chain modes (Pacc/Preuse-*)"
  [ -n "$position_in_chain" ] && die 5 "--position-in-chain only valid for chain modes (Pacc/Preuse-*)"
fi

# fixtures_root is read by the live path (Pfresh/D/Pacc/S) to load the
# fixture's setup/task/probes. Dry-run does not touch it.
_EXECMODE_FIXTURES_ROOT="$fixtures_root"
fixture_dir="$_EXECMODE_FIXTURES_ROOT/$fixture"

# ─── trial layout ────────────────────────────────────────────────────────────
# Spec §2.1 + §2.2: chain modes (Pacc + Preuse-*) use the seedNN_posP_sessS
# stem; non-chain modes (D/S/Pfresh) use seedNN.
seed_stem=$(printf "seed%02d" "$seed_idx")
if [ "$is_chain_mode" -eq 1 ]; then
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

# ─── chain-state: discard session if crashed (R8) ───────────────────────────
# Spec §5.3: chain_state.json is per-arm (path includes mode); Phase 3 Pacc
# behavior preserved by chain_state_path's default mode=Pacc.
if [ "$is_chain_mode" -eq 1 ]; then
  chain_path="$(execmode::chain_state_path "$state_root" "$run_idx" "$session_idx" "$mode")"
  if execmode::chain_state_is_crashed "$chain_path"; then
    die 5 "$mode session $session_idx (fixture=$fixture, run=$run_idx) marked crashed in $chain_path — discarded per R8; re-queue at the session level, not this trial"
  fi
fi

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

# ─── live-path helpers ──────────────────────────────────────────────────────

stage1_warmup_jsonl_path="$trial_dir/stage1_warmup.jsonl"

# Validate that every fixture file the chosen mode reads is present.
# Missing fixture files are a genuine malformed-fixture case → exit 5.
execmode::harness_validate_fixture() {
  [ -d "$fixture_dir" ] || die 5 "fixture dir not found: $fixture_dir"
  local req=( task_prompt.md post_probes.md planted_facts.json ground_truth.json probe_answers.json )
  case "$mode" in
    D|S|Pacc) req+=( setup_history.md ) ;;
    Pfresh)   req+=( warmup_transcript.md ) ;;
    Preuse-clear|Preuse-substitute-compact-C1|Preuse-substitute-compact-C2|Preuse-substitute-compact-C3|Preuse-substitute-compact-C4|Preuse-substitute-compact-revised)
      # Spec §2.3 + §2.4: Preuse arms compose stdin from setup_history + task
      # (Preuse-clear) or impl A manifest output (Preuse-substitute-compact),
      # both require setup_history.md present in the fixture.
      req+=( setup_history.md )
      ;;
  esac
  local f
  for f in "${req[@]}"; do
    [ -f "$fixture_dir/$f" ] || die 5 "fixture file missing: $fixture_dir/$f"
  done
}

# Invoke claude --print once with stdin redirected and stream-json appended to
# the given jsonl path. Extra args (e.g. --resume <sid>) go on the tail.
# Tests override the command entirely via EXECMODE_STAGE1_CMD.
execmode::harness_invoke_claude_stage1() {
  local stdin_path=$1 jsonl_out=$2
  shift 2
  local default_cmd="claude --print --output-format stream-json --verbose --disable-slash-commands --model ${EXEC_MODE_MODEL:-claude-opus-4-7}"
  local cmd="${EXECMODE_STAGE1_CMD:-$default_cmd}"
  if [ $# -gt 0 ]; then
    local tail
    printf -v tail ' %q' "$@"
    cmd="$cmd$tail"
  fi
  if [ -n "${EXEC_MODE_HOME:-}" ]; then
    HOME="$EXEC_MODE_HOME" bash -c "$cmd" < "$stdin_path" >> "$jsonl_out"
  else
    bash -c "$cmd" < "$stdin_path" >> "$jsonl_out"
  fi
}

# Scan a claude stream-json jsonl for the first session_id field (emitted in
# the `system` init record and echoed on the `result` record). Echoes to
# stdout; exits 1 if not found.
execmode::harness_extract_session_id() {
  local jsonl=$1
  [ -s "$jsonl" ] || return 1
  "$venv_py" - "$jsonl" <<'PY'
import json, sys
for ln in open(sys.argv[1], encoding="utf-8"):
    try:
        rec = json.loads(ln)
    except json.JSONDecodeError:
        continue
    sid = rec.get("session_id") if isinstance(rec, dict) else None
    if isinstance(sid, str) and sid:
        print(sid)
        sys.exit(0)
sys.exit(1)
PY
}

# Concatenate all `type=assistant` text parts from a claude stream-json jsonl
# into a single markdown file (the Stage 1 agent output).
execmode::harness_extract_assistant_text() {
  local jsonl=$1 out=$2
  "$venv_py" - "$jsonl" "$out" <<'PY'
import json, sys
chunks = []
for ln in open(sys.argv[1], encoding="utf-8"):
    try:
        rec = json.loads(ln)
    except json.JSONDecodeError:
        continue
    if rec.get("type") != "assistant":
        continue
    msg = rec.get("message") or {}
    for part in msg.get("content") or []:
        if isinstance(part, dict) and part.get("type") == "text":
            chunks.append(part.get("text", ""))
open(sys.argv[2], "w", encoding="utf-8").write("\n\n".join(chunks))
PY
}

# Sum total_cost_usd across all `type=result` records in a jsonl. Missing
# file or no result records → 0.
execmode::harness_sum_result_cost() {
  local jsonl=$1
  if [ ! -s "$jsonl" ]; then
    echo "0"
    return 0
  fi
  "$venv_py" - "$jsonl" <<'PY'
import json, sys
total = 0.0
try:
    for ln in open(sys.argv[1], encoding="utf-8"):
        try:
            rec = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if rec.get("type") == "result" and isinstance(rec.get("total_cost_usd"), (int, float)):
            total += float(rec["total_cost_usd"])
except FileNotFoundError:
    pass
print(f"{total:.6f}")
PY
}

# D / S single-turn task invocation. stdin = setup_history + task_prompt.
execmode::harness_stage1_live_D() {
  local stdin_tmp; stdin_tmp="$(mktemp -t execmode-stage1-stdin.XXXXXX)"
  {
    cat "$fixture_dir/setup_history.md"
    printf '\n\n'
    cat "$fixture_dir/task_prompt.md"
  } > "$stdin_tmp"
  execmode::harness_invoke_claude_stage1 "$stdin_tmp" "$stage1_jsonl_path"
  rm -f "$stdin_tmp"
}

execmode::harness_stage1_live_S() {
  # For Fa-style fixtures the "briefing artifact" is setup_history.md; S mode
  # delegates the task to a fresh isolated claude subprocess with that briefing
  # as context (the "subagent" semantics). Same composition as D for now; the
  # differential is in mode-D vs mode-S cache/plan state during Phase 2.
  execmode::harness_stage1_live_D
}

# Pfresh: new claude session + warmup turn-by-turn replay via --resume + final
# task turn. stage1.jsonl captures only the final task call (for cost marginal,
# compact, extract_text). stage1_warmup.jsonl captures the warmup calls so
# warmup_cost_usd can be summed separately (schema §5.1).
execmode::harness_stage1_live_Pfresh() {
  local warmup="$fixture_dir/warmup_transcript.md"
  local turns_file; turns_file="$(mktemp -t execmode-warmup-turns.XXXXXX)"

  # Extract User turns from the warmup transcript. Agent turns are skipped —
  # claude will regenerate its own agent response to each user turn in the
  # fresh session, which is what "warmup replay" means semantically (we care
  # about ESTABLISHING session history, not reproducing exact agent text).
  "$venv_py" - "$warmup" "$turns_file" <<'PY'
import json, re, sys
src = open(sys.argv[1], encoding="utf-8").read()
# Split at "--- User (Turn N) ---" markers; keep the text up to the next
# "--- User (Turn M) ---" or "--- Agent (Turn M) ---" header or EOF.
pattern = re.compile(
    r'---\s*User\s*\(Turn\s*\d+\)\s*---\s*(.*?)(?=^---\s*(?:User|Agent)\s*\(Turn\s*\d+\)\s*---|\Z)',
    re.MULTILINE | re.DOTALL,
)
turns = [m.group(1).strip() for m in pattern.finditer(src)]
turns = [t for t in turns if t]
json.dump(turns, open(sys.argv[2], "w", encoding="utf-8"))
PY

  local n_turns
  n_turns=$("$venv_py" -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$turns_file")

  : > "$stage1_warmup_jsonl_path"

  local session_id=""
  local i=0
  while [ "$i" -lt "$n_turns" ]; do
    local turn_stdin; turn_stdin="$(mktemp -t execmode-warmup-stdin.XXXXXX)"
    "$venv_py" -c "import json,sys; sys.stdout.write(json.load(open(sys.argv[1]))[int(sys.argv[2])])" \
      "$turns_file" "$i" > "$turn_stdin"
    if [ -z "$session_id" ]; then
      execmode::harness_invoke_claude_stage1 "$turn_stdin" "$stage1_warmup_jsonl_path"
      session_id=$(execmode::harness_extract_session_id "$stage1_warmup_jsonl_path" || echo "")
    else
      execmode::harness_invoke_claude_stage1 "$turn_stdin" "$stage1_warmup_jsonl_path" --resume "$session_id"
    fi
    rm -f "$turn_stdin"
    i=$((i + 1))
  done
  rm -f "$turns_file"

  # Final task turn, resuming the warmed session if we have one.
  local task_stdin; task_stdin="$(mktemp -t execmode-stage1-task.XXXXXX)"
  cat "$fixture_dir/task_prompt.md" > "$task_stdin"
  if [ -n "$session_id" ]; then
    execmode::harness_invoke_claude_stage1 "$task_stdin" "$stage1_jsonl_path" --resume "$session_id"
  else
    execmode::harness_invoke_claude_stage1 "$task_stdin" "$stage1_jsonl_path"
  fi
  rm -f "$task_stdin"
}

# Pacc position k in a chain. Position 1: cold start with setup_history + task;
# position > 1: claude --resume <prior_session_id> with task_prompt only.
# Chain state tracks session_id after pos=1 writes so subsequent trials find it.
execmode::harness_stage1_live_Pacc() {
  if [ "$position_in_chain" = "1" ]; then
    local stdin_tmp; stdin_tmp="$(mktemp -t execmode-stage1-stdin.XXXXXX)"
    {
      cat "$fixture_dir/setup_history.md"
      printf '\n\n'
      cat "$fixture_dir/task_prompt.md"
    } > "$stdin_tmp"
    execmode::harness_invoke_claude_stage1 "$stdin_tmp" "$stage1_jsonl_path"
    rm -f "$stdin_tmp"
    local sid
    sid=$(execmode::harness_extract_session_id "$stage1_jsonl_path" || echo "")
    if [ -n "$sid" ]; then
      execmode::chain_state_set_session_id "$chain_path" "$run_idx" "$session_idx" "$sid"
    fi
  else
    local prior_sid
    prior_sid=$(execmode::chain_state_get_session_id "$chain_path" || echo "")
    [ -n "$prior_sid" ] || die 5 "Pacc pos=$position_in_chain requires session_id from pos=1 in $chain_path (run pos=1 trial first)"
    local stdin_tmp; stdin_tmp="$(mktemp -t execmode-stage1-stdin.XXXXXX)"
    cat "$fixture_dir/task_prompt.md" > "$stdin_tmp"
    execmode::harness_invoke_claude_stage1 "$stdin_tmp" "$stage1_jsonl_path" --resume "$prior_sid"
    rm -f "$stdin_tmp"
  fi
}

# Spec §2.3: Preuse-clear runs each chain position in a fresh claude --print.
# stdin composition is identical to D mode (setup_history + task_prompt). The
# chain identity lives in the run-order CSV + chain-state accounting only.
execmode::harness_stage1_live_Preuse_clear() {
  execmode::harness_stage1_live_D
}

# Spec §2.4: Preuse-substitute-compact-Cn extends Pacc with a per-segment cut:
# pos=1 → Pacc cold start; pos>1 → if cumulative segment input tokens cross
# cut_tokens, build manifest via preuse_build_manifest, invoke impl A
# (bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py),
# feed result to cold `claude --print` (no --resume), capture new session_id
# and advance segment_start_position AFTER the call (OQ-4 retry-safe order).
# Below the cut → standard Pacc --resume path.
# Args: $1=cut_tokens (int), $2=cut_id (C1..C4).
execmode::harness_stage1_live_Preuse_substitute_compact() {
  local cut_tokens=$1 cut_id=$2
  [[ -n "$cut_tokens" && -n "$cut_id" ]] || die 5 "preuse-substitute-compact helper: cut_tokens + cut_id required"

  if [ "$position_in_chain" = "1" ]; then
    # Cold start identical to Pacc pos=1 (setup + task), capture session_id,
    # initialize segment_start_position=1 AFTER the claude call (OQ-4).
    local stdin_tmp; stdin_tmp="$(mktemp -t execmode-stage1-stdin.XXXXXX)"
    {
      cat "$fixture_dir/setup_history.md"
      printf '\n\n'
      cat "$fixture_dir/task_prompt.md"
    } > "$stdin_tmp"
    execmode::harness_invoke_claude_stage1 "$stdin_tmp" "$stage1_jsonl_path"
    rm -f "$stdin_tmp"
    local sid
    sid=$(execmode::harness_extract_session_id "$stage1_jsonl_path" || echo "")
    if [ -n "$sid" ]; then
      execmode::chain_state_set_session_id "$chain_path" "$run_idx" "$session_idx" "$sid"
    fi
    execmode::chain_state_set_segment_start_position "$chain_path" 1
    return 0
  fi

  # pos > 1: cumulative-input check decides whether to substitute-compact.
  local seg_start; seg_start=$(execmode::chain_state_get_segment_start_position "$chain_path")
  local seg_in
  if ! seg_in=$(execmode::preuse_compute_segment_input_tokens \
                  "$state_root" "$run_idx" "$mode" "$session_idx" \
                  "$seg_start" "$position_in_chain" "$chain_path"); then
    die 5 "preuse: segment_input_tokens computation failed for $trial_id"
  fi

  if [ "$seg_in" -lt "$cut_tokens" ]; then
    # Below cut → standard Pacc --resume behavior (task only).
    local prior_sid
    prior_sid=$(execmode::chain_state_get_session_id "$chain_path" || echo "")
    [ -n "$prior_sid" ] || die 5 "preuse-substitute-compact pos=$position_in_chain requires session_id from pos=1 in $chain_path (run pos=1 trial first)"
    local stdin_tmp; stdin_tmp="$(mktemp -t execmode-stage1-stdin.XXXXXX)"
    cat "$fixture_dir/task_prompt.md" > "$stdin_tmp"
    execmode::harness_invoke_claude_stage1 "$stdin_tmp" "$stage1_jsonl_path" --resume "$prior_sid"
    rm -f "$stdin_tmp"
    return 0
  fi

  # Cut crossed → substitute-compact: stage symlinks, build manifest, invoke
  # impl A, feed bytes to cold claude (NO --resume), capture new session_id,
  # advance segment_start_position to current position (ADR §4.6.9 step 6).
  local stage_dir="$trial_dir/.preuse_inputs"
  # Walk chain entries in [seg_start..pos-1] to build prior_args for staging.
  local prior_args=()
  local p
  for p in $(seq "$seg_start" $((position_in_chain - 1))); do
    # Look up fixture_id + seed_idx + paths from chain_state.
    local lookup; lookup=$("$venv_py" - "$chain_path" "$p" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
target = int(sys.argv[2])
for e in state.get("fixtures_completed", []):
    if int(e.get("position_in_chain")) == target:
        print(f"{e.get('fixture_id')}\t{int(e.get('seed_idx'))}")
        break
PY
)
    if [ -z "$lookup" ]; then
      die 5 "preuse: chain_state missing entry for position $p"
    fi
    local p_fix p_seed
    p_fix=$(echo "$lookup" | cut -f1)
    p_seed=$(echo "$lookup" | cut -f2)
    local p_task="$_EXECMODE_FIXTURES_ROOT/$p_fix/task_prompt.md"
    local p_stem; p_stem=$(printf "seed%02d_pos%d_sess%d" "$p_seed" "$p" "$session_idx")
    local p_out="$state_root/$run_idx/$mode/$p_fix/$p_stem/stage1_output.md"
    prior_args+=( "$p" "$p_fix" "$p_task" "$p_out" )
  done

  local prior_count=$((position_in_chain - seg_start))
  execmode::preuse_stage_inputs "$stage_dir" \
    "$fixture_dir/setup_history.md" \
    "$fixture_dir/task_prompt.md" \
    "$prior_count" "${prior_args[@]}"

  local manifest_path="$stage_dir/manifest.json"
  execmode::preuse_build_manifest "$stage_dir" "$manifest_path" \
    "$cut_id" "$cut_tokens" "$run_idx" "$session_idx" \
    "$seg_start" "$position_in_chain" "$position_in_chain" \
    "$fixture" "$chain_path"

  local impl_a="$REPO_ROOT/bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py"
  [ -f "$impl_a" ] || die 5 "preuse: impl A not found at $impl_a (pre-reg tag pin violated)"

  local stdin_tmp; stdin_tmp="$(mktemp -t execmode-stage1-stdin.XXXXXX)"
  if ! LC_ALL=C "$venv_py" "$impl_a" "$manifest_path" > "$stdin_tmp"; then
    rm -f "$stdin_tmp"
    die 5 "preuse: impl A invocation failed for $trial_id"
  fi
  # Cold claude --print (NO --resume) per ADR §4.6.9 step 3.
  execmode::harness_invoke_claude_stage1 "$stdin_tmp" "$stage1_jsonl_path"
  rm -f "$stdin_tmp"

  # Step 5: extract new session_id + overwrite chain_state.session_id.
  local new_sid
  new_sid=$(execmode::harness_extract_session_id "$stage1_jsonl_path" || echo "")
  if [ -n "$new_sid" ]; then
    execmode::chain_state_set_session_id "$chain_path" "$run_idx" "$session_idx" "$new_sid"
  fi
  # Step 6 (OQ-4 ordering): advance segment marker AFTER claude call so a
  # claude failure leaves chain_state untouched and the trial is retry-safe.
  execmode::chain_state_set_segment_start_position "$chain_path" "$position_in_chain"
}

if [ "$dry_run" -eq 1 ]; then
  execmode::harness_stage1_dryrun
else
  execmode::harness_validate_fixture
  : > "$stage1_jsonl_path"
  case "$mode" in
    D)      execmode::harness_stage1_live_D;;
    S)      execmode::harness_stage1_live_S;;
    Pfresh) execmode::harness_stage1_live_Pfresh;;
    Pacc)   execmode::harness_stage1_live_Pacc;;
    Preuse-clear) execmode::harness_stage1_live_Preuse_clear;;
    Preuse-substitute-compact-C1|Preuse-substitute-compact-C2|Preuse-substitute-compact-C3|Preuse-substitute-compact-C4|Preuse-substitute-compact-revised)
      execmode::harness_stage1_live_Preuse_substitute_compact "$preuse_cut_tokens" "$preuse_cut_id"
      ;;
  esac
  [ -s "$stage1_jsonl_path" ] || die 5 "stage1 produced empty jsonl; claude invocation likely failed"
  execmode::harness_extract_assistant_text "$stage1_jsonl_path" "$stage1_out_path"
fi

stage1_end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ─── Stage 2 probe ──────────────────────────────────────────────────────────
stage2_start="$stage1_end"
stage2_end="$stage1_end"
probes_qonly_path="$trial_dir/probes_qonly.md"

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
else
  stage2_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    printf '=== PRIOR CONVERSATION HISTORY ===\n'
    cat "$fixture_dir/setup_history.md"
    printf '\n--- Turn N (agent response) ---\n'
    cat "$stage1_out_path"
  } > "$stage2_transcript_path"

  # Pre-filter probes to the Q<n>. question lines so the stage2 helper's
  # one-probe-per-line parser doesn't accidentally shuffle prose headers
  # into answer slots (smoke report §5 follow-up 4).
  grep -E '^Q[0-9]+\.' "$fixture_dir/post_probes.md" > "$probes_qonly_path" || true

  if [ ! -s "$probes_qonly_path" ]; then
    # Fall back to the raw probes file if no Q<n>. lines were matched.
    cp "$fixture_dir/post_probes.md" "$probes_qonly_path"
  fi

  if ! execmode::stage2_probe_subprocess \
        "$stage2_transcript_path" "$probes_qonly_path" \
        "$seed_idx" "$stage2_answers_path"; then
    echo "stage2 probe subprocess returned non-zero; answers file may be partial" >&2
  fi
  stage2_end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

# ─── metrics.json assembly ───────────────────────────────────────────────────
# Python is our single JSON construction tool — cleaner than shell quoting, and
# it validates the payload against state/schema/metrics.v1.json before the
# atomic write. Failure to validate exits 5 (malformed).
#
# Live path gathers cost/compact/pollution/quality via grader subprocesses
# first, then hands the resulting JSON blobs to the assembly heredoc.

cost_json='{}'
compact_json='{"detected":false}'
poll_json='{"leaks":[false,false,false,false,false,false,false,false,false,false]}'
qual_json='{"primary_score":0}'
warmup_cost_usd="0"

if [ "$dry_run" -eq 0 ]; then
  grader_py="$REPO_ROOT/bin/exec-mode-grader.py"
  if [ -x "$grader_py" ] || [ -f "$grader_py" ]; then
    cost_json=$("$venv_py" "$grader_py" parse-cost "$stage1_jsonl_path" 2>/dev/null || echo '{}')
    compact_json=$("$venv_py" "$grader_py" detect-compact "$stage1_jsonl_path" 2>/dev/null || echo '{"detected":false}')
    poll_json=$("$venv_py" "$grader_py" pollution-a \
                --output "$stage1_out_path" \
                --facts  "$fixture_dir/planted_facts.json" 2>/dev/null \
                || echo '{"leaks":[false,false,false,false,false,false,false,false,false,false]}')
    qual_json=$("$venv_py" "$grader_py" score-fixture \
                --fixture "$fixture" \
                --output  "$stage1_out_path" \
                --ground-truth "$fixture_dir/ground_truth.json" 2>/dev/null \
                || echo '{"primary_score":0}')
  fi

  # Pfresh accumulates warmup-turn cost in a sibling jsonl; sum the result
  # records (if any) and report it as cost.warmup_cost_usd (schema §5.1).
  if [ -s "$stage1_warmup_jsonl_path" ]; then
    warmup_cost_usd=$(execmode::harness_sum_result_cost "$stage1_warmup_jsonl_path")
  fi
fi

"$venv_py" - <<PY | execmode::emit_metrics "$metrics_path"
import json, pathlib, sys
from jsonschema import Draft202012Validator

repo = pathlib.Path("$REPO_ROOT")
schema = json.loads((repo / "state/schema/metrics.v1.json").read_text())
validator = Draft202012Validator(schema)

mode = "$mode"
dry_run = bool(int("$dry_run"))
# Spec §2.1: chain modes (session_idx + position_in_chain populated).
# Pacc + Preuse-clear + 4 Preuse-substitute-compact-Cn cuts.
is_chain = mode in (
    "Pacc",
    "Preuse-clear",
    "Preuse-substitute-compact-C1",
    "Preuse-substitute-compact-C2",
    "Preuse-substitute-compact-C3",
    "Preuse-substitute-compact-C4",
    "Preuse-substitute-compact-revised",
)

def maybe_int(s):
    s = s.strip()
    return int(s) if s else None

sess_idx = maybe_int("${session_idx:-}")
pos_idx  = maybe_int("${position_in_chain:-}")

if dry_run:
    cost = {
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
    }
    compact = {"detected": False, "reason": None, "cache_read_drop_ratio": None, "next_input_spike_ratio": None}
    quality_primary = 0.0
    quality_components = None
    pollution_self_rate = 0.0
    pollution_leaks = [False] * 10
    loss_rate = 0.0
    loss_probes = [
        {"probe_idx": i, "layer_a_hit": True, "layer_b_hit": False,
         "layer_b_ratio": None, "layer_c_pending": False, "recall": True}
        for i in range(10)
    ]
    stage2_tr_path = "stage2_transcript.md"
    stage2_ans_path = "stage2_answers.json"
else:
    cost_raw    = json.loads(r'''$cost_json''')
    compact_raw = json.loads(r'''$compact_json''')
    poll_raw    = json.loads(r'''$poll_json''')
    qual_raw    = json.loads(r'''$qual_json''')

    def _bucket(k_suff, k_short=None):
        v = cost_raw.get(k_suff)
        if v is None and k_short is not None:
            v = cost_raw.get(k_short)
        try:
            return int(v or 0)
        except (TypeError, ValueError):
            return 0

    buckets = {
        "input_tokens":          _bucket("input_tokens"),
        "output_tokens":         _bucket("output_tokens"),
        "cache_write_5m_tokens": _bucket("cache_write_5m_tokens", "cache_write_5m"),
        "cache_write_1h_tokens": _bucket("cache_write_1h_tokens", "cache_write_1h"),
        "cache_read_tokens":     _bucket("cache_read_tokens",     "cache_read"),
    }

    # Prefer claude's canonical result.total_cost_usd; fall back to the
    # grader's parse_cost marginal and finally to a bucket re-derivation.
    # (Smoke report §5 follow-up 1 flags grader parse_cost double-counting;
    # Session B will fix it in parallel.)
    def _read_result_cost(path):
        try:
            for ln in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
                try:
                    rec = json.loads(ln)
                except json.JSONDecodeError:
                    continue
                if rec.get("type") == "result" and isinstance(rec.get("total_cost_usd"), (int, float)):
                    return float(rec["total_cost_usd"])
        except FileNotFoundError:
            pass
        return None

    result_cost = _read_result_cost("$stage1_jsonl_path")
    if result_cost is not None:
        price = result_cost
    elif isinstance(cost_raw.get("marginal_usd"), (int, float)):
        price = float(cost_raw["marginal_usd"])
    else:
        price = (
            buckets["input_tokens"]          * 15.00 / 1_000_000 +
            buckets["output_tokens"]         * 75.00 / 1_000_000 +
            buckets["cache_write_5m_tokens"] * 18.75 / 1_000_000 +
            buckets["cache_write_1h_tokens"] * 30.00 / 1_000_000 +
            buckets["cache_read_tokens"]     *  1.50 / 1_000_000
        )
    price = max(0.0, float(price))

    try:
        warmup = max(0.0, float("$warmup_cost_usd"))
    except ValueError:
        warmup = 0.0

    cost = {
        "marginal_usd":      round(price, 6),
        "amort_usd":         {
            "n_1":  round(price + warmup,        6),
            "n_10": round(price + warmup / 10.0, 6),
            "n_30": round(price + warmup / 30.0, 6),
        },
        "warmup_cost_usd":   round(warmup, 6),
        "subagent_cost_usd": 0.0,
        "usage_buckets":     buckets,
    }

    compact = {
        "detected":               bool(compact_raw.get("detected", False)),
        "reason":                 compact_raw.get("reason"),
        "cache_read_drop_ratio":  compact_raw.get("cache_read_drop_ratio"),
        "next_input_spike_ratio": compact_raw.get("next_input_spike_ratio"),
    }

    def _coerce_quality(q):
        if isinstance(q, (int, float)):
            return float(q)
        if isinstance(q, dict):
            for k in ("primary_score", "primary", "score", "false_prior_correctness"):
                v = q.get(k)
                if isinstance(v, (int, float)):
                    return float(v)
        return 0.0
    quality_primary = max(0.0, min(1.0, _coerce_quality(qual_raw)))
    quality_components = qual_raw if isinstance(qual_raw, dict) else None

    leaks = poll_raw.get("leaks") if isinstance(poll_raw, dict) else poll_raw
    if not (isinstance(leaks, list) and len(leaks) == 10):
        leaks = [False] * 10
    pollution_leaks = [bool(x) for x in leaks]
    pollution_self_rate = round(sum(1 for x in pollution_leaks if x) / 10.0, 4)

    # Loss: parse stage2 answers vs fixture probe_answers.json via rapidfuzz.
    def _load_json_loose(path):
        try:
            raw = open(path, encoding="utf-8").read().strip()
        except FileNotFoundError:
            return {}
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            import re
            m = re.search(r'\{.*\}', raw, re.S)
            if m:
                try:
                    return json.loads(m.group(0))
                except Exception:
                    return {}
        return {}

    try:
        from rapidfuzz import fuzz as _rf_fuzz
    except Exception:
        _rf_fuzz = None

    s2_data = _load_json_loose("$stage2_answers_path")
    try:
        probe_gt = json.load(open("$fixture_dir/probe_answers.json", encoding="utf-8"))
        if not isinstance(probe_gt, list):
            probe_gt = []
    except Exception:
        probe_gt = []

    s2_by_idx = {}
    for e in (s2_data.get("probes") or []):
        try:
            s2_by_idx[int(e.get("probe_idx"))] = str(e.get("answer") or "")
        except (TypeError, ValueError):
            continue

    def _la(exp, act):
        return bool(exp) and bool(act) and exp.lower() in act.lower()
    def _lb(exp, act, thr=0.8):
        if not exp or not act or _rf_fuzz is None:
            return False, None
        ratio = _rf_fuzz.partial_token_set_ratio(exp, act) / 100.0
        return ratio > thr, round(ratio, 3)

    loss_probes = []
    hits = 0
    for i in range(10):
        gt = probe_gt[i] if i < len(probe_gt) else {}
        expected = str(gt.get("answer", "")) if isinstance(gt, dict) else ""
        actual   = s2_by_idx.get(i, "")
        if not actual and isinstance(gt, dict):
            actual = s2_by_idx.get(int(gt.get("q_idx", i + 1)) - 1, "")
        la = _la(expected, actual)
        lb, lb_ratio = _lb(expected, actual)
        recall = la or lb
        if recall:
            hits += 1
        loss_probes.append({
            "probe_idx":       i,
            "layer_a_hit":     la,
            "layer_b_hit":     lb,
            "layer_b_ratio":   lb_ratio,
            "layer_c_pending": False,
            "recall":          recall,
        })
    loss_rate = round(1.0 - (hits / 10.0), 4)
    stage2_tr_path = "stage2_transcript.md"
    stage2_ans_path = "stage2_answers.json"

metrics = {
    "schema_version": "1",
    "trial_id": "$trial_id",
    "fixture_id": "$fixture",
    "mode": mode,
    "seed_idx": int("$seed_idx"),
    "run_idx": int("$run_idx"),
    "session_idx": sess_idx if is_chain else None,
    "position_in_chain": pos_idx if is_chain else None,
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
    "cost": cost,
    "compact": compact,
    "quality": {
        "primary":             quality_primary,
        "primary_components":  quality_components if not dry_run else None,
        "length_capped":       False,
        "human_review_queued": False,
    },
    "pollution": {
        "self_rate":            pollution_self_rate,
        "self_leaks_layer_a":   pollution_leaks,
        "self_layer_b_pending": [],
        "chain_rate":           None,
        "chain_leaks_layer_a":  None,
    },
    "loss": {
        "rate":             loss_rate,
        "probe_order_seed": int("$seed_idx"),
        "probes":           loss_probes,
    },
    "paths": {
        "stage1_output":     "stage1_output.md",
        "stage1_jsonl":      "stage1.jsonl",
        "stage2_transcript": stage2_tr_path,
        "stage2_answers":    stage2_ans_path,
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

# ─── chain-state entry: Pacc (T6) + Preuse arms (spec §2.3 + §5.3) ─────────
# Spec §5.3: chain-state participation is uniform across chain modes; Phase 3
# Pacc behavior preserved (the only field that differs across arms is whether
# segment_start_position is updated at the trial — handled in the live path).
if [ "$is_chain_mode" -eq 1 ]; then
  execmode::chain_state_append \
    "$chain_path" "$run_idx" "$fixture" "$session_idx" \
    "$position_in_chain" "$seed_idx" "$trial_id" "$stage1_end"
fi

echo "$trial_id ok metrics=$metrics_path"
exit 0
