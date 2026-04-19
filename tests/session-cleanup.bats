#!/usr/bin/env bats
# Tests for bin/session-cleanup.sh.

setup() {
  SC_BIN="$BATS_TEST_DIRNAME/../bin/session-cleanup.sh"
  export HOME="$BATS_TMPDIR/sc-$$-$BATS_TEST_NUMBER"
  mkdir -p "$HOME/.wtm/bin" "$HOME/.telepty"
  # Stub telepty to simulate session info discovery.
  cat > "$HOME/.wtm/bin/telepty" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  session)
    case "$2" in
      info)
        if [[ "$3" == "test-exists" ]]; then
          echo "ID: test-exists"
          echo "PID: 999999"
          exit 0
        fi
        exit 1 ;;
    esac ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$HOME/.wtm/bin/telepty"
  export PATH="$HOME/.wtm/bin:$PATH"
}
teardown() { rm -rf "$HOME"; }

@test "missing session-id returns usage exit 1" {
  run "$SC_BIN"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "non-existent session returns warning and exit 0" {
  run "$SC_BIN" test-does-not-exist
  [ "$status" -eq 0 ]
  [[ "$output" == *"not found"* ]]
}

@test "existent session terminates (dead pid is idempotent)" {
  run "$SC_BIN" test-exists
  [ "$status" -eq 0 ]
  [[ "$output" == *"terminated"* ]]
}
