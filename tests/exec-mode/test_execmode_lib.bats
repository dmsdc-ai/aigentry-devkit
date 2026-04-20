#!/usr/bin/env bats
# T2 — bats tests for bin/lib/exec-mode-lib.sh (build spec §7 T2).
# Scope: retry_with_backoff, emit_metrics, stage1_capture_jsonl, compact_detect.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  # shellcheck disable=SC1091
  source "$REPO_ROOT/bin/lib/exec-mode-lib.sh"

  TMPDIR_T="$(mktemp -d -t execmode-lib-bats.XXXXXX)"
  export EXECMODE_RETRY_QUIET=1   # silence progress chatter in tests
}

teardown() {
  [[ -n "${TMPDIR_T:-}" ]] && rm -rf "$TMPDIR_T"
}

# ─── retry_with_backoff ───────────────────────────────────────────────────

@test "retry_with_backoff: succeeds on first try" {
  run execmode::retry_with_backoff 3 5 1 -- true
  [ "$status" -eq 0 ]
}

@test "retry_with_backoff: retries and eventually succeeds" {
  # Script that fails 2 times then succeeds, via counter file.
  local counter="$TMPDIR_T/c"
  echo 0 > "$counter"
  cat >"$TMPDIR_T/flaky.sh" <<SH
#!/usr/bin/env bash
n=\$(cat "$counter"); n=\$((n+1)); echo \$n > "$counter"
if (( n < 3 )); then echo "fail \$n" >&2; exit 1; fi
echo ok; exit 0
SH
  chmod +x "$TMPDIR_T/flaky.sh"
  run execmode::retry_with_backoff 4 5 0 -- "$TMPDIR_T/flaky.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ok"* ]]
  [ "$(cat "$counter")" = "3" ]
}

@test "retry_with_backoff: gives up after max retries and returns last exit" {
  cat >"$TMPDIR_T/always_fail.sh" <<'SH'
#!/usr/bin/env bash
echo "boom" >&2
exit 7
SH
  chmod +x "$TMPDIR_T/always_fail.sh"
  run execmode::retry_with_backoff 2 5 0 -- "$TMPDIR_T/always_fail.sh"
  [ "$status" -eq 7 ]
}

@test "retry_with_backoff: rate-limit cool-off path fires on stderr match" {
  local marker="$TMPDIR_T/cooled"
  # 1st attempt emits rate_limit + fails. 2nd attempt succeeds.
  cat >"$TMPDIR_T/ratelim.sh" <<SH
#!/usr/bin/env bash
if [[ ! -f "$marker" ]]; then
  echo "HTTP 429 rate_limit: slow down" >&2
  touch "$marker"
  exit 1
fi
echo ok
exit 0
SH
  chmod +x "$TMPDIR_T/ratelim.sh"
  EXECMODE_RETRY_QUIET=0 run execmode::retry_with_backoff 3 5 0 -- "$TMPDIR_T/ratelim.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ok"* ]]
  [[ "$output" == *"rate limit"* || "$output" == *"rate_limit"* || "$output" == *"cool-off"* ]]
}

# ─── emit_metrics ─────────────────────────────────────────────────────────

@test "emit_metrics: atomic write of valid JSON from stdin" {
  local out="$TMPDIR_T/deep/nested/metrics.json"
  echo '{"a":1,"b":"x"}' | execmode::emit_metrics "$out"
  [ -f "$out" ]
  ! [ -e "${out}.tmp" ] && ! ls "${out}.tmp."* 2>/dev/null
  [ "$(cat "$out")" = '{"a":1,"b":"x"}' ]
}

@test "emit_metrics: rejects invalid JSON (no overwrite)" {
  local out="$TMPDIR_T/metrics.json"
  echo '{"a":1}' | execmode::emit_metrics "$out"
  [ -f "$out" ]
  local before; before="$(cat "$out")"
  set +e
  echo 'not json' | execmode::emit_metrics "$out"
  local ec=$?
  set -e
  [ "$ec" -ne 0 ]
  [ "$(cat "$out")" = "$before" ]   # original preserved
  # No leftover temp
  ! ls "${out}.tmp."* >/dev/null 2>&1
}

@test "emit_metrics: requires a path argument" {
  set +e
  echo '{}' | execmode::emit_metrics
  local ec=$?
  set -e
  [ "$ec" -ne 0 ]
}

# ─── stage1_capture_jsonl ─────────────────────────────────────────────────

@test "stage1_capture_jsonl: slices by ISO window inclusive" {
  local src="$TMPDIR_T/session.jsonl"
  cat >"$src" <<'JSONL'
{"timestamp":"2026-04-20T09:59:59Z","msg":"before"}
{"timestamp":"2026-04-20T10:00:00Z","msg":"start"}
{"timestamp":"2026-04-20T10:00:30Z","msg":"mid"}
{"timestamp":"2026-04-20T10:01:00Z","msg":"end"}
{"timestamp":"2026-04-20T10:01:01Z","msg":"after"}
{"not":"a timestamp"}
malformed line
JSONL
  local out="$TMPDIR_T/slice.jsonl"
  execmode::stage1_capture_jsonl "$src" "2026-04-20T10:00:00Z" "2026-04-20T10:01:00Z" "$out"
  [ -f "$out" ]
  [ "$(wc -l <"$out" | tr -d ' ')" = "3" ]
  grep -q 'start' "$out"
  grep -q 'mid'   "$out"
  grep -q 'end'   "$out"
  ! grep -q 'before' "$out"
  ! grep -q 'after'  "$out"
  ! grep -q 'malformed' "$out"
}

@test "stage1_capture_jsonl: missing source errors out" {
  run execmode::stage1_capture_jsonl "$TMPDIR_T/nope.jsonl" "2026-04-20T00:00:00Z" "2026-04-20T23:59:59Z" "$TMPDIR_T/out.jsonl"
  [ "$status" -ne 0 ]
}

# ─── compact_detect ───────────────────────────────────────────────────────

@test "compact_detect: shells out to grader via EXECMODE_COMPACT_CMD stub" {
  local stub="$TMPDIR_T/stub-grader.sh"
  cat >"$stub" <<'SH'
#!/usr/bin/env bash
# Echo a canned detection JSON; assert the input file is passed through.
[[ -f "$1" ]] || { echo "stub: missing input" >&2; exit 2; }
printf '{"detected":true,"reason":"stub","cache_read_drop_ratio":0.7,"next_input_spike_ratio":2.4}\n'
SH
  chmod +x "$stub"
  echo '{"timestamp":"2026-04-20T10:00:00Z"}' > "$TMPDIR_T/trial.jsonl"

  EXECMODE_COMPACT_CMD="$stub" run execmode::compact_detect "$TMPDIR_T/trial.jsonl"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"detected":true'* ]]
  [[ "$output" == *'"reason":"stub"'* ]]
}

@test "compact_detect: missing jsonl errors out" {
  run execmode::compact_detect "$TMPDIR_T/nope.jsonl"
  [ "$status" -ne 0 ]
}

# ─── fix3: chain_state path + schema (spec §4.4, refs #329) ───────────────

@test "chain_state_path: is session-scoped, not fixture-scoped" {
  local p; p=$(execmode::chain_state_path "$TMPDIR_T" 1 5)
  [ "$p" = "$TMPDIR_T/1/Pacc/chain_sess5.json" ]
}

@test "chain_state_append: records fixture_id per entry (schema supports multi-fixture chain)" {
  local path="$TMPDIR_T/1/Pacc/chain_sess1.json"
  execmode::chain_state_append "$path" 1 F8  1 1 1 "1/Pacc/F8/seed01_pos1_sess1"  "2026-04-20T10:00:00Z"
  execmode::chain_state_append "$path" 1 F10 1 2 1 "1/Pacc/F10/seed01_pos2_sess1" "2026-04-20T10:05:00Z"
  python3 - <<PY
import json
c = json.load(open("$path"))
assert c["session_idx"] == 1, c
assert "fixture_id" not in c, "fixture_id must be per-entry, not top-level"
entries = {(e["position_in_chain"], e["fixture_id"]) for e in c["fixtures_completed"]}
assert entries == {(1, "F8"), (2, "F10")}, entries
PY
}

@test "chain_state_set_session_id + get_session_id: session-scoped round-trip across fixtures" {
  local path="$TMPDIR_T/1/Pacc/chain_sess7.json"
  execmode::chain_state_set_session_id "$path" 1 7 "sid-xyz-42"
  run execmode::chain_state_get_session_id "$path"
  [ "$status" -eq 0 ]
  [ "$output" = "sid-xyz-42" ]

  # Append entries for two different fixtures — session_id must persist.
  execmode::chain_state_append "$path" 1 F8  7 1 7 "tid-a" "2026-04-20T10:00:00Z"
  execmode::chain_state_append "$path" 1 F10 7 2 7 "tid-b" "2026-04-20T10:05:00Z"
  run execmode::chain_state_get_session_id "$path"
  [ "$status" -eq 0 ]
  [ "$output" = "sid-xyz-42" ]
}
