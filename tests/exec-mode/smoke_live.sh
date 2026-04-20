#!/usr/bin/env bash
# smoke_live.sh — T10 live smoke for Fa fixture × 4 modes (build spec §7 T10).
#
# Runs one real claude --print trial per mode against the Fa fixture. Not a bats
# test — budgets for ~\$1-2 in live OAuth calls and must be invoked manually.
# Per-call framework overhead is a constant ~\$0.09 (built-in MCPs + skills);
# see docs/reports/2026-04-20-exec-mode-Fa-smoke.md.
#
# Pre-reqs (orchestrator plan):
#   $EXEC_MODE_HOME/.claude/.credentials.json   (extracted from macOS keychain)
#   $EXEC_MODE_HOME/.claude/settings.json = '{}' (empty → no user hooks)
#   .venv-exec-mode populated with rapidfuzz + jsonschema
#   aigentry-orchestrator/fixtures/exec-mode-experiment/Fa/* present
#
# Output per trial:
#   $STATE/1/<mode>/Fa/seed00[_pos1_sess1]/
#     ├── stage1.jsonl           (raw claude --print stream-json)
#     ├── stage1_output.md       (extracted assistant text)
#     ├── stage2_transcript.md   (briefing + stage1_output concat for probe)
#     ├── stage2_answers.json    (Stage 2 probe subprocess output)
#     └── metrics.json           (schema-validated, written atomically)

set -euo pipefail
export LC_ALL="${LC_ALL:-C}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=../../bin/lib/exec-mode-lib.sh
source "$REPO_ROOT/bin/lib/exec-mode-lib.sh"

# ─── config ────────────────────────────────────────────────────────────────
EXEC_MODE_HOME="${EXEC_MODE_HOME:-/tmp/exec-mode-test-home}"
FIXTURES_ROOT="${AIGENTRY_EXEC_FIXTURES:-$HOME/projects/aigentry-orchestrator/fixtures/exec-mode-experiment}"
STATE_ROOT="${EXEC_MODE_STATE:-$REPO_ROOT/state/exec-mode-smoke}"
VENV_PY="$REPO_ROOT/.venv-exec-mode/bin/python"
GRADER="$REPO_ROOT/bin/exec-mode-grader.py"
SCHEMA="$REPO_ROOT/state/schema/metrics.v1.json"

FIXTURE_ID="Fa"
FIX_DIR="$FIXTURES_ROOT/$FIXTURE_ID"
RUN_IDX=1
SEED_IDX=0

MODEL="${EXEC_MODE_MODEL:-claude-opus-4-7}"
# Run all 4 modes by default; override with `SMOKE_MODES="D"` etc.
SMOKE_MODES="${SMOKE_MODES:-D Pfresh Pacc S}"

# ─── preflight ─────────────────────────────────────────────────────────────
die() { echo "smoke_live: $*" >&2; exit 1; }

[ -x "$VENV_PY" ] || die "venv python missing: $VENV_PY"
[ -f "$GRADER"  ] || die "grader missing: $GRADER"
[ -f "$SCHEMA"  ] || die "schema missing: $SCHEMA"
[ -d "$FIX_DIR" ] || die "Fa fixture dir missing: $FIX_DIR"
for f in setup_history.md task_prompt.md post_probes.md ground_truth.json planted_facts.json probe_answers.json warmup_transcript.md; do
  [ -f "$FIX_DIR/$f" ] || die "Fa fixture file missing: $FIX_DIR/$f"
done
[ -f "$EXEC_MODE_HOME/.claude/.credentials.json" ] || die "isolated HOME credentials missing: $EXEC_MODE_HOME/.claude/.credentials.json"
[ -f "$EXEC_MODE_HOME/.claude/settings.json"     ] || die "isolated HOME settings missing"

command -v claude >/dev/null || die "claude CLI not on PATH"

mkdir -p "$STATE_ROOT"

# ─── capture CLI versions once ─────────────────────────────────────────────
VER_CLAUDE=$(claude --version 2>&1 | head -n1 | tr -d '\r')
VER_CODEX=$(command -v codex >/dev/null && codex --version 2>&1 | head -n1 | tr -d '\r' || echo "not-installed")
VER_GEMINI=$(command -v gemini >/dev/null && gemini --version 2>&1 | head -n1 | tr -d '\r' || echo "not-installed")
VER_TELEPTY=$(command -v telepty >/dev/null && telepty --version 2>&1 | head -n1 | tr -d '\r' || echo "not-installed")

# ─── per-trial runner ──────────────────────────────────────────────────────
run_trial() {
  local mode=$1
  local trial_stem
  trial_stem="seed$(printf %02d "$SEED_IDX")"
  local trial_id_tail="$trial_stem"
  local session_idx_val="None"
  local position_val="None"
  if [ "$mode" = "Pacc" ]; then
    trial_stem="${trial_stem}_pos1_sess1"
    trial_id_tail="$trial_stem"
    session_idx_val="1"
    position_val="1"
  fi

  local trial_dir="$STATE_ROOT/$RUN_IDX/$mode/$FIXTURE_ID/$trial_stem"
  mkdir -p "$trial_dir"

  local trial_id="$RUN_IDX/$mode/$FIXTURE_ID/$trial_id_tail"
  local s1_jsonl="$trial_dir/stage1.jsonl"
  local s1_out="$trial_dir/stage1_output.md"
  local s2_tr="$trial_dir/stage2_transcript.md"
  local s2_ans="$trial_dir/stage2_answers.json"
  local metrics_path="$trial_dir/metrics.json"

  echo "── $trial_id ──"

  # Compose Stage 1 input per mode.
  local stdin_tmp; stdin_tmp="$(mktemp)"
  case "$mode" in
    D|S|Pacc)
      {
        cat "$FIX_DIR/setup_history.md"
        printf '\n\n'
        cat "$FIX_DIR/task_prompt.md"
      } > "$stdin_tmp"
      ;;
    Pfresh)
      {
        cat "$FIX_DIR/warmup_transcript.md"
        printf '\n\n=== END WARMUP ===\n\n'
        cat "$FIX_DIR/task_prompt.md"
      } > "$stdin_tmp"
      ;;
  esac

  local s1_start; s1_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Live Stage 1: run claude --print from isolated HOME.
  if ! HOME="$EXEC_MODE_HOME" claude --print \
        --output-format stream-json --verbose \
        --disable-slash-commands \
        --model "$MODEL" \
        < "$stdin_tmp" > "$s1_jsonl"; then
    echo "  STAGE1 FAILED ($mode)" >&2
    rm -f "$stdin_tmp"
    return 1
  fi
  rm -f "$stdin_tmp"

  local s1_end; s1_end=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Extract final assistant text from stream-json.
  "$VENV_PY" - "$s1_jsonl" "$s1_out" <<'PY'
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

  # Stage 2: transcript = briefing + agent output; probes = fixture post_probes
  # pre-filtered to the 10 real `Q<n>.` lines (post_probes.md also contains
  # non-question prose that the T7 parser would otherwise shuffle into slots).
  {
    printf '=== PRIOR CONVERSATION HISTORY ===\n'
    cat "$FIX_DIR/setup_history.md"
    printf '\n--- Turn N (agent response) ---\n'
    cat "$s1_out"
  } > "$s2_tr"

  local probes_filtered="$trial_dir/probes_qonly.md"
  grep -E '^Q[0-9]+\.' "$FIX_DIR/post_probes.md" > "$probes_filtered"

  local s2_start; s2_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # The stage2 helper env-scrubs everything, so the claude subprocess needs HOME
  # inside the command string (env -i preserves the literal in the -c script).
  EXECMODE_STAGE2_CMD="HOME='$EXEC_MODE_HOME' claude --print --disable-slash-commands --model $MODEL" \
    execmode::stage2_probe_subprocess "$s2_tr" "$probes_filtered" "$SEED_IDX" "$s2_ans" \
    || echo "  STAGE2 non-zero exit for $mode (continuing with partial data)"

  local s2_end; s2_end=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Grader subcommands.
  local cost_json compact_json poll_json qual_json
  cost_json=$("$VENV_PY" "$GRADER" parse-cost "$s1_jsonl" 2>/dev/null || echo '{}')
  compact_json=$("$VENV_PY" "$GRADER" detect-compact "$s1_jsonl" 2>/dev/null || echo '{"detected":false}')
  poll_json=$("$VENV_PY" "$GRADER" pollution-a --output "$s1_out" --facts "$FIX_DIR/planted_facts.json" 2>/dev/null || echo '{"leaks":[false,false,false,false,false,false,false,false,false,false]}')
  qual_json=$("$VENV_PY" "$GRADER" score-fixture --fixture Fa --output "$s1_out" --ground-truth "$FIX_DIR/ground_truth.json" 2>/dev/null || echo '{"score":0,"components":{}}')

  # Stage 2 isolation check: probe sentinels must NOT appear in stage1.jsonl.
  local iso_ok=1
  while IFS= read -r q; do
    [ -z "$q" ] && continue
    # first 30 chars as a crude stage1-match probe; skip trivial prefixes
    key="$(printf '%s' "$q" | sed -E 's/^(Q[0-9]+\.[[:space:]]*)//' | cut -c1-30)"
    [ -z "$key" ] && continue
    if grep -Fq "$key" "$s1_jsonl"; then
      iso_ok=0
      break
    fi
  done < "$FIX_DIR/post_probes.md"

  # Assemble metrics.json via python (schema validated).
  "$VENV_PY" - "$metrics_path" <<PY | execmode::emit_metrics "$metrics_path"
import json, sys, pathlib
from jsonschema import Draft202012Validator

metrics_path = sys.argv[1]
schema = json.loads(pathlib.Path("$SCHEMA").read_text())
validator = Draft202012Validator(schema)

cost    = json.loads(r'''$cost_json''')
compact = json.loads(r'''$compact_json''')
poll    = json.loads(r'''$poll_json''')
qual    = json.loads(r'''$qual_json''')

# Grader's parse-cost CLI emits snake_case keys with `_tokens` suffix on the
# cache fields; fall back to the bare form in case the grader changes shape.
def _b(key_suffixed, key_short=None):
    v = cost.get(key_suffixed)
    if v is None and key_short is not None:
        v = cost.get(key_short)
    return int(v or 0)

buckets = {
    "input_tokens":          _b("input_tokens"),
    "output_tokens":         _b("output_tokens"),
    "cache_write_5m_tokens": _b("cache_write_5m_tokens", "cache_write_5m"),
    "cache_write_1h_tokens": _b("cache_write_1h_tokens", "cache_write_1h"),
    "cache_read_tokens":     _b("cache_read_tokens",     "cache_read"),
}

# Prefer claude's result record total_cost_usd (canonical billed amount) over
# a re-derivation from usage buckets. The grader's parse_cost sometimes
# double-counts stream-json assistant records, so we read the result record
# directly when present and fall back to grader only if missing.
def _read_stage1_total_cost(jsonl_path):
    import pathlib
    try:
        for ln in pathlib.Path(jsonl_path).read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(ln)
            except json.JSONDecodeError:
                continue
            if rec.get("type") == "result" and isinstance(rec.get("total_cost_usd"), (int, float)):
                return float(rec["total_cost_usd"])
    except FileNotFoundError:
        pass
    return None

_result_cost = _read_stage1_total_cost("$s1_jsonl")
if isinstance(cost.get("marginal_usd"), (int, float)) and _result_cost is None:
    price = float(cost["marginal_usd"])
elif _result_cost is not None:
    price = _result_cost
else:
    # Last-resort re-derivation from buckets (opus public list prices).
    price = (
        buckets["input_tokens"]          * 15.00 / 1_000_000 +
        buckets["output_tokens"]         * 75.00 / 1_000_000 +
        buckets["cache_write_5m_tokens"] * 18.75 / 1_000_000 +
        buckets["cache_write_1h_tokens"] * 30.00 / 1_000_000 +
        buckets["cache_read_tokens"]     *  1.50 / 1_000_000
    )

# Layer A pollution: 10 booleans per spec.
leaks = poll.get("leaks") if isinstance(poll, dict) else poll
if not (isinstance(leaks, list) and len(leaks) == 10):
    leaks = [False] * 10
leaks = [bool(x) for x in leaks]

# Quality: fixture graders emit different shapes; coalesce to 0..1 scalar.
def _pick_quality(q):
    if isinstance(q, (int, float)): return float(q)
    for k in ("primary_score", "primary", "score", "false_prior_correctness"):
        if isinstance(q, dict) and k in q:
            v = q[k]
            if isinstance(v, (int, float)):
                return float(v)
    return 0.0
qual_primary = max(0.0, min(1.0, _pick_quality(qual)))
qual_components = qual if isinstance(qual, dict) else None

# Stage 2 loss — parse claude's probe answers JSON; compare to expected.
def _load_stage2(path):
    try:
        raw = open(path, encoding="utf-8").read().strip()
        # First try strict JSON.
        try:
            return json.loads(raw)
        except Exception:
            pass
        # Fallback: find the first {...} block.
        import re
        m = re.search(r'\{.*\}', raw, re.S)
        if m:
            try: return json.loads(m.group(0))
            except: pass
    except FileNotFoundError:
        pass
    return {}

s2_data = _load_stage2("$s2_ans")
probe_gt = json.load(open("$FIX_DIR/probe_answers.json"))
s2_by_idx = {}
for e in (s2_data.get("probes") or []):
    try:
        s2_by_idx[int(e.get("probe_idx"))] = str(e.get("answer") or "")
    except Exception:
        continue

# rapidfuzz for Layer B; grader exposes loss_layer_a/b as CLI too.
from rapidfuzz import fuzz
def _la(exp, act):
    return bool(exp) and bool(act) and exp.lower() in act.lower()
def _lb(exp, act, thr=0.8):
    if not exp or not act: return False
    return (fuzz.partial_token_set_ratio(exp, act) / 100.0) > thr

probes = []
hits = 0
for i, gt in enumerate(probe_gt):  # probe_gt is list of 10 entries, 1-indexed q_idx
    expected = str(gt.get("answer", ""))
    actual   = s2_by_idx.get(i, "") or s2_by_idx.get(gt.get("q_idx", i+1) - 1, "")
    la = _la(expected, actual)
    lb = _lb(expected, actual)
    recall = la or lb
    if recall: hits += 1
    probes.append({
        "probe_idx": i,
        "layer_a_hit": la,
        "layer_b_hit": lb,
        "layer_b_ratio": round(fuzz.partial_token_set_ratio(expected, actual) / 100.0, 3) if expected and actual else None,
        "layer_c_pending": False,
        "recall": recall,
    })
loss_rate = 1.0 - (hits / 10.0)

mode = "$mode"
sess_idx = $session_idx_val
pos_idx  = $position_val
dry_run  = False

metrics = {
    "schema_version": "1",
    "trial_id": "$trial_id",
    "fixture_id": "$FIXTURE_ID",
    "mode": mode,
    "seed_idx": int("$SEED_IDX"),
    "run_idx": int("$RUN_IDX"),
    "session_idx":       sess_idx,
    "position_in_chain": pos_idx,
    "status": "ok",
    "dry_run": dry_run,
    "timestamps": {
        "stage1_start": "$s1_start",
        "stage1_end":   "$s1_end",
        "stage2_start": "$s2_start",
        "stage2_end":   "$s2_end",
    },
    "cli_versions": {
        "claude":  "$VER_CLAUDE",
        "codex":   "$VER_CODEX",
        "gemini":  "$VER_GEMINI",
        "telepty": "$VER_TELEPTY",
    },
    "cost": {
        "marginal_usd":      round(price, 6),
        "amort_usd":         {"n_1": round(price, 6), "n_10": round(price / 10.0, 6), "n_30": round(price / 30.0, 6)},
        "warmup_cost_usd":   0.0,
        "subagent_cost_usd": 0.0,
        "usage_buckets":     buckets,
    },
    "compact": {
        "detected":               bool(compact.get("detected", False)),
        "reason":                 compact.get("reason"),
        "cache_read_drop_ratio":  compact.get("cache_read_drop_ratio"),
        "next_input_spike_ratio": compact.get("next_input_spike_ratio"),
    },
    "quality": {
        "primary":             qual_primary,
        "primary_components":  qual_components,
        "length_capped":       False,
        "human_review_queued": False,
    },
    "pollution": {
        "self_rate":              round(sum(leaks) / 10.0, 4),
        "self_leaks_layer_a":     leaks,
        "self_layer_b_pending":   [],
        "chain_rate":             None,
        "chain_leaks_layer_a":    None,
    },
    "loss": {
        "rate":             round(loss_rate, 4),
        "probe_order_seed": int("$SEED_IDX"),
        "probes":           probes,
    },
    "paths": {
        "stage1_output":     "stage1_output.md",
        "stage1_jsonl":      "stage1.jsonl",
        "stage2_transcript": "stage2_transcript.md",
        "stage2_answers":    "stage2_answers.json",
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

  echo "  ok: $metrics_path"
  echo "  iso_ok=$iso_ok  cost=$(jq -r '.cost.marginal_usd' "$metrics_path")  quality=$(jq -r '.quality.primary' "$metrics_path")  pollution=$(jq -r '.pollution.self_rate' "$metrics_path")  loss=$(jq -r '.loss.rate' "$metrics_path")  compact=$(jq -r '.compact.detected' "$metrics_path")"
}

# ─── main ──────────────────────────────────────────────────────────────────
echo "=== T10 Fa live smoke ==="
echo "  EXEC_MODE_HOME: $EXEC_MODE_HOME"
echo "  STATE_ROOT:     $STATE_ROOT"
echo "  MODEL:          $MODEL"
echo "  MODES:          $SMOKE_MODES"
echo

for mode in $SMOKE_MODES; do
  if run_trial "$mode"; then
    :
  else
    echo "  trial $mode failed, continuing" >&2
  fi
  echo
done

echo "=== smoke done ==="
