#!/usr/bin/env bats
# Tests for ctx-router.sh

setup() {
  CTX_ROUTER="$(pwd)/aigentry-devkit/bin/ctx-router.sh"
  # Support running from devkit root or parent projects dir
  if [[ ! -x "$CTX_ROUTER" ]]; then
    CTX_ROUTER="$(pwd)/bin/ctx-router.sh"
  fi
}

@test "version returns 0.1.0" {
  run "$CTX_ROUTER" version
  [ "$status" -eq 0 ]
  [ "$output" = "0.1.0" ]
}

@test "missing subcommand exits 1" {
  run "$CTX_ROUTER"
  [ "$status" -eq 1 ]
}

@test "unknown subcommand exits 1" {
  run "$CTX_ROUTER" bogus
  [ "$status" -eq 1 ]
}
