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
