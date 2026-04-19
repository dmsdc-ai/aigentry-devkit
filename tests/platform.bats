#!/usr/bin/env bats
# Tests for bin/lib/platform.sh (dispatcher + backends).

setup() {
  PLATFORM_LIB="$BATS_TEST_DIRNAME/../bin/lib/platform.sh"
  export HOME="$BATS_TMPDIR/platform-$$-$BATS_TEST_NUMBER"
  mkdir -p "$HOME"
}
teardown() { rm -rf "$HOME"; }

@test "os_type returns macos under PLATFORM_OVERRIDE=macos" {
  run bash -c "PLATFORM_OVERRIDE=macos; source '$PLATFORM_LIB' 2>/dev/null; platform::os_type"
  [ "$status" -eq 0 ]
  [ "$output" = "macos" ]
}

@test "os_type honors PLATFORM_OVERRIDE for test injection" {
  run bash -c "PLATFORM_OVERRIDE=windows; source '$PLATFORM_LIB' 2>/dev/null; platform::os_type"
  [ "$output" = "windows" ]
}

@test "os_type defaults to uname mapping when OVERRIDE unset" {
  run bash -c "unset PLATFORM_OVERRIDE; source '$PLATFORM_LIB' 2>/dev/null; platform::os_type"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^(macos|linux)$ ]]
}

@test "source loads unix backend on macos" {
  run bash -c "PLATFORM_OVERRIDE=macos; source '$PLATFORM_LIB' 2>/dev/null; declare -f platform::kill_pid >/dev/null && echo yes"
  [ "$output" = "yes" ]
}

@test "is_alive on current process returns 0" {
  run bash -c "source '$PLATFORM_LIB' 2>/dev/null; platform::is_alive $$"
  [ "$status" -eq 0 ]
}

@test "is_alive on impossible pid returns non-zero" {
  run bash -c "source '$PLATFORM_LIB' 2>/dev/null; platform::is_alive 999999"
  [ "$status" -ne 0 ]
}

@test "kill_pid on dead pid returns 0 (idempotent)" {
  run bash -c "source '$PLATFORM_LIB' 2>/dev/null; platform::kill_pid 999999"
  [ "$status" -eq 0 ]
}

@test "file_lock runs fn and releases" {
  local lf="$HOME/testlock"
  run bash -c "source '$PLATFORM_LIB' 2>/dev/null; platform::file_lock '$lf' echo locked"
  [ "$status" -eq 0 ]
  [[ "$output" == *"locked"* ]]
}

@test "event_wait times out on idle dir" {
  mkdir -p "$HOME/evt"
  run bash -c "source '$PLATFORM_LIB' 2>/dev/null; platform::event_wait '$HOME/evt' 2"
  [ "$status" -ne 0 ]
}

@test "event_wait detects file creation" {
  mkdir -p "$HOME/evt"
  ( sleep 0.5 && touch "$HOME/evt/new" ) &
  local bg_pid=$!
  run bash -c "source '$PLATFORM_LIB' 2>/dev/null; platform::event_wait '$HOME/evt' 5"
  wait "$bg_pid" 2>/dev/null || true
  [ "$status" -eq 0 ]
}
