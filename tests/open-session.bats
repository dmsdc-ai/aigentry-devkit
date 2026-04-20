#!/usr/bin/env bats
# Regression tests for bin/open-session.sh SCRIPT_DIR symlink resolution.

setup() {
  OPEN_SESSION="$BATS_TEST_DIRNAME/../bin/open-session.sh"
}

@test "open-session.sh --help works via real path" {
  run bash "$OPEN_SESSION" --help
  [ "$status" -eq 0 ]
  [[ "$output" != *"No such file or directory"* ]]
}

@test "open-session.sh resolves SCRIPT_DIR correctly via symlink" {
  local tmp
  tmp="$(mktemp -d)"
  ln -s "$OPEN_SESSION" "$tmp/open-session.sh"
  run bash "$tmp/open-session.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" != *"No such file or directory"* ]]
  rm -rf "$tmp"
}

@test "open-session.sh resolves SCRIPT_DIR through symlink chain" {
  local tmp
  tmp="$(mktemp -d)"
  ln -s "$OPEN_SESSION" "$tmp/level1.sh"
  ln -s "$tmp/level1.sh" "$tmp/level2.sh"
  run bash "$tmp/level2.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" != *"No such file or directory"* ]]
  rm -rf "$tmp"
}
