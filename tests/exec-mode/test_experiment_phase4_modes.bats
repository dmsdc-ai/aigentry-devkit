#!/usr/bin/env bats
# Phase 4 trial-driver wiring tests for `bin/exec-mode-experiment.sh`.
# Spec: docs/superpowers/specs/2026-04-26-phase4-trial-driver-wiring.md §6.2 + §6.3
#
# Scope:
#   - Validator accepts the 5 new mode strings (Preuse-clear,
#     Preuse-substitute-compact-C{1..4}); rejects malformed cut suffixes.
#   - Dry-run for each new mode produces a schema-valid metrics.json.
#   - Trial layout: chain modes get the seedNN_posP_sessS stem.
#   - Phase 3 modes (D/S/Pfresh/Pacc) remain accepted unchanged (regression).
#   - chain-state schema additive: segment_start_position helper round-trips
#     (default=1 when missing) without disturbing Phase 3 fields.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HARNESS="$REPO_ROOT/bin/exec-mode-experiment.sh"
  LIB="$REPO_ROOT/bin/lib/exec-mode-lib.sh"
  SCHEMA="$REPO_ROOT/state/schema/metrics.v1.json"
  VENV_PY="$REPO_ROOT/.venv-exec-mode/bin/python"
  STATE="$(mktemp -d -t execmode-phase4.XXXXXX)"
}

teardown() {
  [[ -n "${STATE:-}" ]] && rm -rf "$STATE"
}

assert_schema_valid() {
  local mj=$1
  "$VENV_PY" - <<PY
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open("$SCHEMA"))
inst = json.load(open("$mj"))
errs = sorted(Draft202012Validator(schema).iter_errors(inst), key=lambda e: list(e.absolute_path))
if errs:
    for e in errs:
        print(f"{list(e.absolute_path)}: {e.message}", file=sys.stderr)
    sys.exit(1)
PY
}

# ─── new-mode validator acceptance ─────────────────────────────────────────

@test "validator accepts Preuse-clear" {
  run "$HARNESS" --fixture Fa --mode Preuse-clear --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1/Preuse-clear/Fa/seed00_pos1_sess1 ok"* ]]
}

@test "validator accepts Preuse-substitute-compact-C1" {
  run "$HARNESS" --fixture Fa --mode Preuse-substitute-compact-C1 --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
}

@test "validator accepts Preuse-substitute-compact-C2" {
  run "$HARNESS" --fixture Fa --mode Preuse-substitute-compact-C2 --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
}

@test "validator accepts Preuse-substitute-compact-C3" {
  run "$HARNESS" --fixture Fa --mode Preuse-substitute-compact-C3 --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
}

@test "validator accepts Preuse-substitute-compact-C4" {
  run "$HARNESS" --fixture Fa --mode Preuse-substitute-compact-C4 --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
}

# ─── new-mode validator rejection ──────────────────────────────────────────

@test "validator rejects Preuse-substitute-compact-C5 (out-of-range cut)" {
  run "$HARNESS" --fixture Fa --mode Preuse-substitute-compact-C5 --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "validator rejects Preuse-substitute-compact (no cut suffix)" {
  run "$HARNESS" --fixture Fa --mode Preuse-substitute-compact --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "validator rejects preuse-clear (lowercase)" {
  run "$HARNESS" --fixture Fa --mode preuse-clear --seed-idx 0 --run-idx 1 \
    --session-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "validator requires session-idx for Preuse-clear" {
  run "$HARNESS" --fixture Fa --mode Preuse-clear --seed-idx 0 --run-idx 1 \
    --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
  [[ "$output" == *"--session-idx required for chain modes"* ]]
}

# ─── dry-run schema validity for new modes ─────────────────────────────────

@test "dry-run Preuse-clear: writes schema-valid metrics.json" {
  run "$HARNESS" --fixture Fa --mode Preuse-clear --seed-idx 5 --run-idx 1 \
    --session-idx 3 --position-in-chain 7 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
  local trial="$STATE/1/Preuse-clear/Fa/seed05_pos7_sess3"
  [ -f "$trial/metrics.json" ]
  assert_schema_valid "$trial/metrics.json"
  local mode; mode=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['mode'])")
  [ "$mode" = "Preuse-clear" ]
  local sess; sess=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['session_idx'])")
  [ "$sess" = "3" ]
}

@test "dry-run Preuse-substitute-compact-C2: writes schema-valid metrics.json with chain stem" {
  run "$HARNESS" --fixture F2 --mode Preuse-substitute-compact-C2 --seed-idx 9 --run-idx 1 \
    --session-idx 4 --position-in-chain 6 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
  local trial="$STATE/1/Preuse-substitute-compact-C2/F2/seed09_pos6_sess4"
  [ -f "$trial/metrics.json" ]
  assert_schema_valid "$trial/metrics.json"
  local tid; tid=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['trial_id'])")
  [ "$tid" = "1/Preuse-substitute-compact-C2/F2/seed09_pos6_sess4" ]
}

# ─── chain-state additive helper round-trip ────────────────────────────────

@test "chain_state_get_segment_start_position defaults to 1 when file missing" {
  source "$LIB"
  EXECMODE_REPO_ROOT="$REPO_ROOT" \
    run execmode::chain_state_get_segment_start_position "$STATE/nonexistent.json"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "chain_state_set_segment_start_position writes; get_segment_start_position reads" {
  source "$LIB"
  local cs="$STATE/chain.json"
  EXECMODE_REPO_ROOT="$REPO_ROOT" \
    execmode::chain_state_set_segment_start_position "$cs" 7
  [ -f "$cs" ]
  EXECMODE_REPO_ROOT="$REPO_ROOT" \
    run execmode::chain_state_get_segment_start_position "$cs"
  [ "$status" -eq 0 ]
  [ "$output" = "7" ]

  # Schema additive: existing fields tolerate missing field (default 1) when
  # the field has not been written yet — proven via a Phase-3-shaped chain.
  local legacy="$STATE/legacy.json"
  cat > "$legacy" <<JSON
{"session_idx": 1, "run_idx": 1, "status": "active", "fixtures_completed": []}
JSON
  EXECMODE_REPO_ROOT="$REPO_ROOT" \
    run execmode::chain_state_get_segment_start_position "$legacy"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

# ─── Phase 3 regression: existing modes unchanged ──────────────────────────

@test "Phase 3 D mode unchanged: dry-run still passes" {
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
  local trial="$STATE/1/D/Fa/seed00"
  [ -f "$trial/metrics.json" ]
  assert_schema_valid "$trial/metrics.json"
}

@test "Phase 3 Pacc mode unchanged: dry-run still produces chain stem" {
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 3 --run-idx 1 \
    --session-idx 7 --position-in-chain 4 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
  local trial="$STATE/1/Pacc/Fa/seed03_pos4_sess7"
  [ -f "$trial/metrics.json" ]
  assert_schema_valid "$trial/metrics.json"
  local tid; tid=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['trial_id'])")
  [ "$tid" = "1/Pacc/Fa/seed03_pos4_sess7" ]
}
