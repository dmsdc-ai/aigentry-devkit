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
