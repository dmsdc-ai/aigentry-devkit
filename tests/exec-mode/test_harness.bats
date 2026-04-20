#!/usr/bin/env bats
# T5 — harness dry-run bats (build spec §7 T5).
# Scope: CLI arg validation, trial layout, schema-valid dry-run metrics for
# D and S modes, Pacc conditional args, resume short-circuit, malformed-args
# exit codes.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HARNESS="$REPO_ROOT/bin/exec-mode-experiment.sh"
  SCHEMA="$REPO_ROOT/state/schema/metrics.v1.json"
  VENV_PY="$REPO_ROOT/.venv-exec-mode/bin/python"
  STATE="$(mktemp -d -t execmode-harness.XXXXXX)"
}

teardown() {
  [[ -n "${STATE:-}" ]] && rm -rf "$STATE"
}

# Validates $1 (path to metrics.json) against the repo JSON Schema.
# Exports PY_STDERR for debugging in the caller.
assert_schema_valid() {
  local mj=$1
  PY_STDERR=$("$VENV_PY" - <<PY 2>&1
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
  )
  local ec=$?
  if [[ $ec -ne 0 ]]; then
    echo "schema validation failed:" >&2
    echo "$PY_STDERR" >&2
  fi
  return $ec
}

# ─── basic dry-run for D and S ───────────────────────────────────────────────

@test "dry-run D: writes schema-valid metrics.json + sidecar artifacts" {
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1/D/Fa/seed00 ok"* ]]

  local trial="$STATE/1/D/Fa/seed00"
  [ -f "$trial/metrics.json" ]
  [ -f "$trial/stage1_output.md" ]
  [ -f "$trial/stage1.jsonl" ]
  [ -f "$trial/stage2_transcript.md" ]
  [ -f "$trial/stage2_answers.json" ]

  assert_schema_valid "$trial/metrics.json"
}

@test "dry-run S: writes schema-valid metrics.json with correct trial_id" {
  run "$HARNESS" --fixture F2 --mode S --seed-idx 29 --run-idx 2 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]

  local trial="$STATE/2/S/F2/seed29"
  [ -f "$trial/metrics.json" ]

  local tid; tid=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['trial_id'])")
  [ "$tid" = "2/S/F2/seed29" ]

  local dry; dry=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['dry_run'])")
  [ "$dry" = "True" ]

  local mode; mode=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['mode'])")
  [ "$mode" = "S" ]

  assert_schema_valid "$trial/metrics.json"
}

@test "dry-run Pacc: populates session_idx + position_in_chain" {
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 3 --run-idx 1 \
    --session-idx 7 --position-in-chain 4 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]

  local trial="$STATE/1/Pacc/Fa/seed03_pos4_sess7"
  [ -f "$trial/metrics.json" ]

  local tid; tid=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['trial_id'])")
  [ "$tid" = "1/Pacc/Fa/seed03_pos4_sess7" ]

  local sess; sess=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['session_idx'])")
  [ "$sess" = "7" ]

  local pos;  pos=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['position_in_chain'])")
  [ "$pos" = "4" ]

  assert_schema_valid "$trial/metrics.json"
}

# ─── argument validation ────────────────────────────────────────────────────

@test "rejects missing --fixture" {
  run "$HARNESS" --mode D --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
  [[ "$output" == *"--fixture required"* ]]
}

@test "rejects invalid mode" {
  run "$HARNESS" --fixture Fa --mode bogus --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "rejects non-integer seed" {
  run "$HARNESS" --fixture Fa --mode D --seed-idx three --run-idx 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "rejects run-idx outside {1,2}" {
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 3 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "rejects Pacc without --session-idx" {
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
  [[ "$output" == *"--session-idx required for Pacc"* ]]
}

@test "rejects Pacc without --position-in-chain" {
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 --session-idx 0 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "rejects Pacc with position > 10" {
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 --session-idx 0 --position-in-chain 11 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
}

@test "rejects --session-idx on non-Pacc modes" {
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --session-idx 0 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
  [[ "$output" == *"only valid for Pacc"* ]]
}

# ─── resume short-circuit ───────────────────────────────────────────────────

@test "resume: skips when metrics.json already valid" {
  "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE" >/dev/null
  local trial="$STATE/1/D/Fa/seed00"
  local before; before=$(stat -f %m "$trial/metrics.json" 2>/dev/null || stat -c %Y "$trial/metrics.json")

  sleep 1
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --dry-run --resume --state-root "$STATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"resume hit"* ]]

  local after; after=$(stat -f %m "$trial/metrics.json" 2>/dev/null || stat -c %Y "$trial/metrics.json")
  [ "$before" = "$after" ]  # file not rewritten
}

@test "resume: re-runs when existing metrics.json is malformed" {
  local trial="$STATE/1/D/Fa/seed00"
  mkdir -p "$trial"
  echo "not-json" > "$trial/metrics.json"

  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --dry-run --resume --state-root "$STATE"
  [ "$status" -eq 0 ]
  assert_schema_valid "$trial/metrics.json"
}

@test "resume short-circuit works regardless of caller cwd" {
  "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE" >/dev/null
  local trial="$STATE/1/D/Fa/seed00"
  local before; before=$(stat -f %m "$trial/metrics.json" 2>/dev/null || stat -c %Y "$trial/metrics.json")

  sleep 1
  # Run from /tmp so a relative .venv-exec-mode path can't accidentally resolve.
  run bash -c "cd /tmp && '$HARNESS' --fixture Fa --mode D --seed-idx 0 --run-idx 1 --dry-run --resume --state-root '$STATE'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"resume hit"* ]]

  local after; after=$(stat -f %m "$trial/metrics.json" 2>/dev/null || stat -c %Y "$trial/metrics.json")
  [ "$before" = "$after" ]
}

# ─── live path still stubbed ────────────────────────────────────────────────

@test "live D (no --dry-run) exits 5 with explanation until T5 Phase 2" {
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 --state-root "$STATE"
  [ "$status" -eq 5 ]
  [[ "$output" == *"only supports --dry-run"* ]]
}
