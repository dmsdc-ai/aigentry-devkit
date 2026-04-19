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
  # Stub curl so DELETE /api/sessions/<id> returns 200 for test-exists.
  cat > "$HOME/.wtm/bin/curl" <<'CURL'
#!/usr/bin/env bash
# args arrive like: -sX DELETE http://host:port/api/sessions/<id> -w '\n%{http_code}'
for a in "$@"; do
  case "$a" in
    */api/sessions/test-exists)
      echo '{"ok":true}'; echo '200'; exit 0 ;;
    */api/sessions/*)
      echo '{"error":"Session not found"}'; echo '404'; exit 0 ;;
  esac
done
exit 0
CURL
  chmod +x "$HOME/.wtm/bin/curl"
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
