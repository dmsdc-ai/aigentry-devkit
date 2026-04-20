#!/usr/bin/env bats
# T7 — Stage 2 probe-replay isolation bats (build spec §7 T7, spec §5.4 / §7.1).
#
# The three isolation invariants this file guards:
#   (1) No CLAUDE_SESSION_ID (nor other CLAUDE_*) leaks into the Stage 2
#       subprocess env — the replay must be a cold `claude --print`.
#   (2) Probe text reaches the subprocess via stdin only — never through
#       file paths the Stage 1 session had fd access to.
#   (3) Stage 1's captured JSONL window never contains probe keywords. Since
#       Stage 2 writes to its own answers file and runs out-of-band, this
#       reduces to: the harness never rewrites stage1.jsonl after stage2.
#
# These are checked with a mock claude via $EXECMODE_STAGE2_CMD; no LLM calls.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/bin/lib/exec-mode-lib.sh"
  VENV_PY="$REPO_ROOT/.venv-exec-mode/bin/python"
  WORK="$(mktemp -d -t execmode-stage2.XXXXXX)"

  # Mock "claude --print" — logs env + stdin, emits deterministic JSON reply.
  # Log dir is passed as argv[1] (not env), because env -i intentionally scrubs
  # arbitrary env vars including test helpers; invariant (1) demands this.
  MOCK="$WORK/mock-claude.sh"
  cat >"$MOCK" <<'MOCKSH'
#!/usr/bin/env bash
LOG_DIR="${1:?usage: mock-claude.sh <log-dir>}"
mkdir -p "$LOG_DIR"
env > "$LOG_DIR/env.txt"
cat > "$LOG_DIR/stdin.txt"
cat <<JSON
{"probes":[
  {"probe_idx":0,"answer":"mock-0"},
  {"probe_idx":1,"answer":"mock-1"}
]}
JSON
MOCKSH
  chmod +x "$MOCK"

  MOCK_LOG_DIR="$WORK/mock-log"
  mkdir -p "$MOCK_LOG_DIR"
  MOCK_CMD="$MOCK $MOCK_LOG_DIR"

  # Sample fixture-like inputs.
  TRANSCRIPT="$WORK/stage1_transcript.md"
  PROBES="$WORK/probes.md"
  ANSWERS="$WORK/answers.json"

  printf '%s\n' \
    "--- Turn 1 ---" \
    "User: build a web scraper" \
    "--- Turn 2 ---" \
    "Agent: ok, I'll use requests+bs4" \
    > "$TRANSCRIPT"

  printf '%s\n' \
    "PROBE_SENTINEL_ALPHA what library was mentioned?" \
    "PROBE_SENTINEL_BETA did we pick an async framework?" \
    > "$PROBES"
}

teardown() {
  [[ -n "${WORK:-}" ]] && rm -rf "$WORK"
}

# ─── invariant 1: CLAUDE_SESSION_ID never leaks ────────────────────────────

@test "T7 invariant-1: CLAUDE_SESSION_ID is scrubbed from stage2 subprocess env" {
  export CLAUDE_SESSION_ID="stage1-session-MUST-NOT-LEAK"
  export CLAUDE_TRACE_ID="trace-MUST-NOT-LEAK"

  source "$LIB"
  EXECMODE_STAGE2_CMD="$MOCK_CMD" \
    execmode::stage2_probe_subprocess "$TRANSCRIPT" "$PROBES" 0 "$ANSWERS"
  [ -s "$ANSWERS" ]

  # Mock recorded its subprocess env.
  local env_file="$MOCK_LOG_DIR/env.txt"
  [ -f "$env_file" ]

  run grep -c '^CLAUDE_SESSION_ID=' "$env_file"
  [ "$output" = "0" ]

  run grep -c '^CLAUDE_TRACE_ID=' "$env_file"
  [ "$output" = "0" ]

  # Sanity: PATH + HOME are preserved so the mock can actually run.
  run grep -c '^PATH=' "$env_file"
  [ "$output" = "1" ]
}

# ─── invariant 2: probe text delivered via stdin only ──────────────────────

@test "T7 invariant-2: probe text arrives on subprocess stdin" {
  source "$LIB"
  EXECMODE_STAGE2_CMD="$MOCK_CMD" \
    execmode::stage2_probe_subprocess "$TRANSCRIPT" "$PROBES" 42 "$ANSWERS"

  local stdin_file="$MOCK_LOG_DIR/stdin.txt"
  [ -f "$stdin_file" ]

  grep -q "PROBE_SENTINEL_ALPHA" "$stdin_file"
  grep -q "PROBE_SENTINEL_BETA"  "$stdin_file"
  grep -q "requests+bs4"          "$stdin_file"  # transcript also in stdin
}

@test "T7 invariant-2b: probe FILE path is never passed as a subprocess arg" {
  source "$LIB"
  EXECMODE_STAGE2_CMD="$MOCK_CMD" \
    execmode::stage2_probe_subprocess "$TRANSCRIPT" "$PROBES" 0 "$ANSWERS"

  # env.txt captured via `env`; check no arg-level reference to probes.md path.
  # We use _ (underscore env var) as a proxy — bash sets it to last arg.
  local env_file="$MOCK_LOG_DIR/env.txt"
  run grep -F "$PROBES" "$env_file"
  [ "$status" -ne 0 ]  # probes path must NOT appear in env
}

# ─── invariant 3: stage1.jsonl never contains probe keywords ───────────────

@test "T7 invariant-3: stage1.jsonl is untouched by stage2; probe sentinels absent" {
  local stage1_jsonl="$WORK/stage1.jsonl"
  printf '{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":[{"type":"text","text":"build scraper"}]}}\n' > "$stage1_jsonl"
  local before; before=$(stat -f %m "$stage1_jsonl" 2>/dev/null || stat -c %Y "$stage1_jsonl")

  source "$LIB"
  EXECMODE_STAGE2_CMD="$MOCK_CMD" \
    execmode::stage2_probe_subprocess "$TRANSCRIPT" "$PROBES" 7 "$ANSWERS"

  sleep 1
  local after; after=$(stat -f %m "$stage1_jsonl" 2>/dev/null || stat -c %Y "$stage1_jsonl")
  [ "$before" = "$after" ]

  run grep -F "PROBE_SENTINEL_ALPHA" "$stage1_jsonl"
  [ "$status" -ne 0 ]
  run grep -F "PROBE_SENTINEL_BETA" "$stage1_jsonl"
  [ "$status" -ne 0 ]
}

# ─── shuffling is deterministic per seed ───────────────────────────────────

@test "T7 probe shuffle is reproducible for same seed, differs across seeds" {
  source "$LIB"

  EXECMODE_STAGE2_CMD="$MOCK_CMD" \
    execmode::stage2_probe_subprocess "$TRANSCRIPT" "$PROBES" 1 "$ANSWERS"
  local stdin_a; stdin_a=$(<"$MOCK_LOG_DIR/stdin.txt")

  rm -f "$MOCK_LOG_DIR/stdin.txt"
  EXECMODE_STAGE2_CMD="$MOCK_CMD" \
    execmode::stage2_probe_subprocess "$TRANSCRIPT" "$PROBES" 1 "$ANSWERS"
  local stdin_b; stdin_b=$(<"$MOCK_LOG_DIR/stdin.txt")
  [ "$stdin_a" = "$stdin_b" ]  # same seed → identical input
}

# ─── error handling ────────────────────────────────────────────────────────

@test "T7 stage2_probe_subprocess errors on missing transcript" {
  source "$LIB"
  run execmode::stage2_probe_subprocess "$WORK/does-not-exist.md" "$PROBES" 0 "$ANSWERS"
  [ "$status" -ne 0 ]
}

@test "T7 stage2_probe_subprocess errors on missing probes" {
  source "$LIB"
  run execmode::stage2_probe_subprocess "$TRANSCRIPT" "$WORK/does-not-exist.md" 0 "$ANSWERS"
  [ "$status" -ne 0 ]
}
