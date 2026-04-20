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

# ─── live path (T10-followup, mocked subprocesses) ──────────────────────────
#
# These tests exercise the real live-path wiring by pointing EXECMODE_STAGE1_CMD
# and EXECMODE_STAGE2_CMD at deterministic mock scripts. No real LLM calls are
# made. Fixtures are scaffolded into a temp dir so the harness reads a complete
# Fa-shaped directory without depending on a real fixture tree being present.

scaffold_live_fixture() {
  local root=$1 id=${2:-Fa}
  local d="$root/$id"
  mkdir -p "$d"
  printf 'Setup history: configure rapidfuzz and record alpha beta gamma.\n' > "$d/setup_history.md"
  printf 'Task: explain the plan.\n' > "$d/task_prompt.md"
  # Warmup with 3 user turns + interleaved agent turns (matches the turn
  # delimiter convention from Session D's update).
  cat > "$d/warmup_transcript.md" <<'EOF'
--- User (Turn 1) ---
remember alpha
--- Agent (Turn 1) ---
noted: alpha
--- User (Turn 2) ---
remember beta
--- Agent (Turn 2) ---
noted: beta
--- User (Turn 3) ---
remember gamma
--- Agent (Turn 3) ---
noted: gamma
EOF
  cat > "$d/post_probes.md" <<'EOF'
# Probes
narrator prelude line, not a question
Q1. first?
Q2. second?
Q3. third?
Q4. fourth?
Q5. fifth?
Q6. sixth?
Q7. seventh?
Q8. eighth?
Q9. ninth?
Q10. tenth?
EOF
  cat > "$d/planted_facts.json" <<'EOF'
[
  {"fact_idx":0,"keyword":"alpha","regex":"\\balpha\\b"},
  {"fact_idx":1,"keyword":"beta","regex":"\\bbeta\\b"},
  {"fact_idx":2,"keyword":"gamma","regex":"\\bgamma\\b"},
  {"fact_idx":3,"keyword":"delta","regex":"\\bdelta\\b"},
  {"fact_idx":4,"keyword":"epsilon","regex":"\\bepsilon\\b"},
  {"fact_idx":5,"keyword":"zeta","regex":"\\bzeta\\b"},
  {"fact_idx":6,"keyword":"omicron","regex":"\\bomicron\\b"},
  {"fact_idx":7,"keyword":"theta","regex":"\\btheta\\b"},
  {"fact_idx":8,"keyword":"iota","regex":"\\biota\\b"},
  {"fact_idx":9,"keyword":"kappa","regex":"\\bkappa\\b"}
]
EOF
  printf '{"task":"explain","expected_leak":false}\n' > "$d/ground_truth.json"
  cat > "$d/probe_answers.json" <<'EOF'
[
  {"q_idx":1,"answer":"one"},
  {"q_idx":2,"answer":"two"},
  {"q_idx":3,"answer":"three"},
  {"q_idx":4,"answer":"four"},
  {"q_idx":5,"answer":"five"},
  {"q_idx":6,"answer":"six"},
  {"q_idx":7,"answer":"seven"},
  {"q_idx":8,"answer":"eight"},
  {"q_idx":9,"answer":"nine"},
  {"q_idx":10,"answer":"ten"}
]
EOF
}

scaffold_mock_stage1_cmd() {
  # Args: <script_path> <log_path> <session_id>
  # The mock consumes stdin (one turn), logs argv + stdin, emits canned
  # stream-json matching what claude --print --output-format stream-json
  # produces: a system/init record, an assistant record, and a result record
  # with total_cost_usd and session_id.
  local path=$1 log=$2 sid=${3:-mock-session-abc}
  cat > "$path" <<MOCK
#!/usr/bin/env bash
set -eu
log="$log"
sid="$sid"
mkdir -p "\$(dirname "\$log")"
{
  printf '%s\n' "CALL argv=\$*"
  printf '%s\n' "BEGIN_STDIN"
  cat
  printf '%s\n' "END_STDIN"
} >> "\$log"
printf '%s\n' "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"\$sid\"}"
printf '%s\n' '{"type":"assistant","timestamp":"2026-04-20T00:00:00Z","message":{"role":"assistant","model":"mock","usage":{"input_tokens":12,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}},"content":[{"type":"text","text":"mock agent output"}]}}'
printf '%s\n' "{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"\$sid\",\"total_cost_usd\":0.0012}"
MOCK
  chmod +x "$path"
}

scaffold_mock_stage2_cmd() {
  # Args: <script_path>
  # Emits a JSON blob keyed by probe_idx 0..9 with answers that all match the
  # scaffolded probe_answers (so loss.rate is 0.0).
  local path=$1
  cat > "$path" <<'MOCK'
#!/usr/bin/env bash
cat > /dev/null
cat <<JSON
{"probes":[
  {"probe_idx":0,"answer":"one"},
  {"probe_idx":1,"answer":"two"},
  {"probe_idx":2,"answer":"three"},
  {"probe_idx":3,"answer":"four"},
  {"probe_idx":4,"answer":"five"},
  {"probe_idx":5,"answer":"six"},
  {"probe_idx":6,"answer":"seven"},
  {"probe_idx":7,"answer":"eight"},
  {"probe_idx":8,"answer":"nine"},
  {"probe_idx":9,"answer":"ten"}
]}
JSON
MOCK
  chmod +x "$path"
}

setup_live_env() {
  # Call at the start of every live-path test. Scaffolds fixture + mocks,
  # exports env vars the harness reads, chooses a fixture name the grader
  # registry already accepts (Fa is in PRIMARY_GRADERS).
  LIVE_FIXTURES_ROOT="$STATE/fixtures"
  LIVE_MOCK_DIR="$STATE/mocks"
  mkdir -p "$LIVE_MOCK_DIR"
  scaffold_live_fixture "$LIVE_FIXTURES_ROOT" Fa

  LIVE_STAGE1_LOG="$LIVE_MOCK_DIR/stage1.log"
  LIVE_STAGE1_CMD="$LIVE_MOCK_DIR/stage1-mock.sh"
  LIVE_STAGE2_CMD="$LIVE_MOCK_DIR/stage2-mock.sh"
  scaffold_mock_stage1_cmd "$LIVE_STAGE1_CMD" "$LIVE_STAGE1_LOG" "mock-session-abc"
  scaffold_mock_stage2_cmd "$LIVE_STAGE2_CMD"

  export EXECMODE_STAGE1_CMD="$LIVE_STAGE1_CMD"
  export EXECMODE_STAGE2_CMD="$LIVE_STAGE2_CMD"
  # Explicitly unset so the harness does not try to re-HOME to an isolated
  # dir that doesn't exist in the bats sandbox.
  unset EXEC_MODE_HOME
}

@test "live D: mocked claude produces schema-valid metrics with task call logged" {
  setup_live_env
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 0 ]

  local trial="$STATE/1/D/Fa/seed00"
  [ -f "$trial/metrics.json" ]
  [ -f "$trial/stage1.jsonl" ]
  [ -f "$trial/stage1_output.md" ]
  [ -f "$trial/stage2_transcript.md" ]
  [ -f "$trial/stage2_answers.json" ]

  assert_schema_valid "$trial/metrics.json"

  # Extracted assistant text from the mock comes through verbatim.
  grep -q "mock agent output" "$trial/stage1_output.md"

  # The stage1 mock was invoked exactly once (D is single-call).
  run grep -c '^CALL ' "$LIVE_STAGE1_LOG"
  [ "$output" = "1" ]

  # total_cost_usd is picked up from the result record.
  local cost; cost=$("$VENV_PY" -c "import json; print(round(json.load(open('$trial/metrics.json'))['cost']['marginal_usd'], 4))")
  [ "$cost" = "0.0012" ]

  # dry_run=false on the live path.
  local dry; dry=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['dry_run'])")
  [ "$dry" = "False" ]
}

@test "live Pfresh: warmup turns replay via --resume, stage1.jsonl is the task turn" {
  setup_live_env
  run "$HARNESS" --fixture Fa --mode Pfresh --seed-idx 1 --run-idx 1 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 0 ]

  local trial="$STATE/1/Pfresh/Fa/seed01"
  [ -f "$trial/metrics.json" ]
  [ -f "$trial/stage1_warmup.jsonl" ]
  assert_schema_valid "$trial/metrics.json"

  # 3 warmup user turns + 1 task call = 4 claude invocations total.
  run grep -c '^CALL ' "$LIVE_STAGE1_LOG"
  [ "$output" = "4" ]

  # First call starts a new session (no --resume), subsequent 3 use --resume.
  run grep -c -- '--resume' "$LIVE_STAGE1_LOG"
  [ "$output" = "3" ]

  # warmup_cost_usd reflects the 3 warmup calls (each mock charges 0.0012).
  local wcost; wcost=$("$VENV_PY" -c "import json; print(round(json.load(open('$trial/metrics.json'))['cost']['warmup_cost_usd'], 4))")
  [ "$wcost" = "0.0036" ]
}

@test "live S: single-call composition matches D pattern" {
  setup_live_env
  run "$HARNESS" --fixture Fa --mode S --seed-idx 2 --run-idx 1 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 0 ]

  local trial="$STATE/2/S/Fa/seed02"
  [ -f "$trial/metrics.json" ] || trial="$STATE/1/S/Fa/seed02"
  assert_schema_valid "$trial/metrics.json"

  run grep -c '^CALL ' "$LIVE_STAGE1_LOG"
  [ "$output" = "1" ]

  local m; m=$("$VENV_PY" -c "import json; print(json.load(open('$trial/metrics.json'))['mode'])")
  [ "$m" = "S" ]
}

@test "live Pacc pos=1: writes session_id into chain_sess<S>.json" {
  setup_live_env
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 5 --position-in-chain 1 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 0 ]

  local chain="$STATE/1/Pacc/Fa/chain_sess5.json"
  [ -f "$chain" ]

  local sid; sid=$("$VENV_PY" -c "import json; print(json.load(open('$chain')).get('session_id',''))")
  [ "$sid" = "mock-session-abc" ]

  # pos=1 is cold-start → no --resume in the stage1 call.
  run grep -c -- '--resume' "$LIVE_STAGE1_LOG"
  [ "$output" = "0" ]
}

@test "live Pacc pos=2: passes --resume <session_id> from chain state" {
  setup_live_env
  # Seed pos=1 first to populate chain_sess5.json with the mock session_id.
  "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 5 --position-in-chain 1 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT" >/dev/null
  : > "$LIVE_STAGE1_LOG"  # clear log so the next assertions only see pos=2

  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 1 --run-idx 1 \
    --session-idx 5 --position-in-chain 2 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 0 ]

  local trial="$STATE/1/Pacc/Fa/seed01_pos2_sess5"
  [ -f "$trial/metrics.json" ]
  assert_schema_valid "$trial/metrics.json"

  # Exactly one stage1 call for pos=2, and it carries --resume.
  run grep -c '^CALL ' "$LIVE_STAGE1_LOG"
  [ "$output" = "1" ]
  run grep -c -- '--resume mock-session-abc' "$LIVE_STAGE1_LOG"
  [ "$output" = "1" ]
}

@test "live Pacc pos=2 without prior pos=1 exits 5 (malformed-fixture guard)" {
  setup_live_env
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 9 --position-in-chain 2 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 5 ]
  [[ "$output" == *"requires session_id"* ]]
}

@test "live: missing fixture file exits 5 with malformed-fixture message" {
  setup_live_env
  rm "$LIVE_FIXTURES_ROOT/Fa/probe_answers.json"
  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 5 ]
  [[ "$output" == *"fixture file missing"* ]]
}

@test "live: stage1 mock producing empty jsonl exits 5" {
  setup_live_env
  # Replace stage1 mock with one that writes nothing to stdout.
  cat > "$EXECMODE_STAGE1_CMD" <<'EOF'
#!/usr/bin/env bash
cat > /dev/null
EOF
  chmod +x "$EXECMODE_STAGE1_CMD"

  run "$HARNESS" --fixture Fa --mode D --seed-idx 0 --run-idx 1 \
    --state-root "$STATE" --fixtures-root "$LIVE_FIXTURES_ROOT"
  [ "$status" -eq 5 ]
  [[ "$output" == *"stage1 produced empty jsonl"* ]]
}

# ─── T6: Pacc chain state + crash-discard ───────────────────────────────────

@test "T6 Pacc dry-run writes chain_sessN.json with position tracked" {
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 7 --position-in-chain 1 --dry-run --state-root "$STATE"
  [ "$status" -eq 0 ]

  local chain="$STATE/1/Pacc/Fa/chain_sess7.json"
  [ -f "$chain" ]

  "$VENV_PY" - <<PY
import json, sys
c = json.load(open("$chain"))
assert c["session_idx"] == 7, c
assert c["fixture_id"] == "Fa", c
assert c["run_idx"] == 1, c
assert c["status"] == "active", c
entries = c["fixtures_completed"]
assert len(entries) == 1, entries
e = entries[0]
assert e["position_in_chain"] == 1, e
assert e["seed_idx"] == 0, e
assert e["trial_id"] == "1/Pacc/Fa/seed00_pos1_sess7", e
PY
}

@test "T6 Pacc dry-run appends positions across trials" {
  "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 7 --position-in-chain 1 --dry-run --state-root "$STATE" >/dev/null
  "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 7 --position-in-chain 2 --dry-run --state-root "$STATE" >/dev/null

  local chain="$STATE/1/Pacc/Fa/chain_sess7.json"
  local n; n=$("$VENV_PY" -c "import json; print(len(json.load(open('$chain'))['fixtures_completed']))")
  [ "$n" = "2" ]
}

@test "T6 Pacc refuses new trials when chain marked crashed (R8)" {
  local chain_dir="$STATE/1/Pacc/Fa"
  mkdir -p "$chain_dir"
  cat >"$chain_dir/chain_sess7.json" <<JSON
{"session_idx":7,"fixture_id":"Fa","run_idx":1,"status":"crashed","fixtures_completed":[]}
JSON

  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 7 --position-in-chain 3 --dry-run --state-root "$STATE"
  [ "$status" -eq 5 ]
  [[ "$output" == *"crashed"* ]]
}

@test "T6 Pacc --resume short-circuits when position already completed" {
  "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 7 --position-in-chain 1 --dry-run --state-root "$STATE" >/dev/null

  local trial="$STATE/1/Pacc/Fa/seed00_pos1_sess7"
  local before; before=$(stat -f %m "$trial/metrics.json" 2>/dev/null || stat -c %Y "$trial/metrics.json")

  sleep 1
  run "$HARNESS" --fixture Fa --mode Pacc --seed-idx 0 --run-idx 1 \
    --session-idx 7 --position-in-chain 1 --dry-run --resume --state-root "$STATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"resume hit"* ]]

  local after; after=$(stat -f %m "$trial/metrics.json" 2>/dev/null || stat -c %Y "$trial/metrics.json")
  [ "$before" = "$after" ]
}

@test "T6 non-Pacc modes never write chain_sess*.json" {
  "$HARNESS" --fixture Fa --mode D      --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE" >/dev/null
  "$HARNESS" --fixture Fa --mode Pfresh --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE" >/dev/null
  "$HARNESS" --fixture Fa --mode S      --seed-idx 0 --run-idx 1 --dry-run --state-root "$STATE" >/dev/null

  run find "$STATE" -name 'chain_sess*.json'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
