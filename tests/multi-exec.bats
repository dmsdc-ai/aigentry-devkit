#!/usr/bin/env bats
# Tests for multi-exec.sh + multi-exec-lib.sh

setup() {
  ME_BIN="$BATS_TEST_DIRNAME/../bin/multi-exec.sh"
  ME_LIB="$BATS_TEST_DIRNAME/../bin/multi-exec-lib.sh"
  # shellcheck source=../bin/multi-exec-lib.sh
  source "$ME_LIB"
  FIXTURES="$BATS_TEST_DIRNAME/fixtures/multi-exec"
  # Sandbox HOME so lock/pidfile tests can't clobber real orchestrator state
  export HOME="$BATS_TMPDIR/multi-exec-$$"
  mkdir -p "$HOME/.telepty/shared" "$HOME/.wtm/contexts/orchestrator"
}
teardown() {
  rm -rf "$HOME"
}

@test "version returns 0.1.0" {
  source "$ME_LIB"
  [ "$MULTI_EXEC_VERSION" = "0.1.0" ]
}

@test "missing plan arg → usage exit 1" {
  run "$ME_BIN"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "no frontmatter + default → no-op exit 0" {
  local tmp
  tmp=$(mktemp)
  echo "# plain plan" > "$tmp"
  run "$ME_BIN" "$tmp"
  [ "$status" -eq 0 ]
  rm "$tmp"
}

@test "no frontmatter + --strict → exit 3" {
  local tmp
  tmp=$(mktemp)
  echo "# plain plan" > "$tmp"
  run "$ME_BIN" "$tmp" --strict
  [ "$status" -eq 3 ]
  rm "$tmp"
}

@test "parse_report strict → JSON with task=4" {
  run bash -c "source '$ME_LIB' && parse_report < '$FIXTURES/report-strict.txt'"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.task == 4 and .commit == "3325b5b" and .tests == "14/14"'
}

@test "parse_report legacy → JSON with task=4" {
  run bash -c "source '$ME_LIB' && parse_report < '$FIXTURES/report-legacy.txt'"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.task == 4 and .commit == "3325b5b" and .tests == "14/14"'
}

@test "parse_report missing task number → error JSON" {
  run bash -c "source '$ME_LIB' && echo 'no task here' | parse_report"
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.error'
}

@test "acquire_lock creates lockfile and releases on exit" {
  local tmp_plan
  tmp_plan=$(mktemp "$HOME/plan.XXXX")
  echo "# plan" > "$tmp_plan"
  run bash -c "source '$ME_LIB' && acquire_lock '$tmp_plan' && release_lock"
  [ "$status" -eq 0 ]
  rm "$tmp_plan"
}

@test "acquire_pid_mutex refuses when pid file has live process" {
  mkdir -p "$HOME/.wtm/contexts/orchestrator"
  echo $$ > "$HOME/.wtm/contexts/orchestrator/multi-exec.pid"
  run bash -c "source '$ME_LIB' && acquire_pid_mutex"
  [ "$status" -ne 0 ]
  rm -f "$HOME/.wtm/contexts/orchestrator/multi-exec.pid"
}

@test "emit_event does not error when wtm-context absent" {
  run env PATH=/usr/bin:/bin HOME="$HOME" bash -c "source '$ME_LIB' && emit_event dispatch '{\"task\":1}'"
  [ "$status" -eq 0 ]
}
