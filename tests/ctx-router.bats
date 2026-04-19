#!/usr/bin/env bats
# Tests for ctx-router.sh

setup() {
  CTX_ROUTER="$BATS_TEST_DIRNAME/../bin/ctx-router.sh"
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

@test "classify precompact returns both" {
  run "$CTX_ROUTER" classify precompact '{}'
  [ "$status" -eq 0 ]
  [ "$output" = "both" ]
}

@test "classify git-commit returns long-term" {
  run "$CTX_ROUTER" classify git-commit '{}'
  [ "$status" -eq 0 ]
  [ "$output" = "long-term" ]
}

@test "classify tq-transition done returns both" {
  run "$CTX_ROUTER" classify tq-transition '{"new":"done"}'
  [ "$status" -eq 0 ]
  [ "$output" = "both" ]
}

@test "classify tq-transition in_progress returns ephemeral" {
  run "$CTX_ROUTER" classify tq-transition '{"new":"in_progress"}'
  [ "$status" -eq 0 ]
  [ "$output" = "ephemeral" ]
}

@test "classify unknown event exits 2" {
  run "$CTX_ROUTER" classify bogus '{}'
  [ "$status" -eq 2 ]
}

@test "on-precompact without wtm/brain: degraded ok" {
  # Isolate PATH so wtm-context/brain not found
  run env PATH="/usr/bin:/bin" HOME="$BATS_TMPDIR" "$CTX_ROUTER" on-precompact "test-sid"
  [ "$status" -eq 0 ]
}

@test "on-precompact requires session-id" {
  run "$CTX_ROUTER" on-precompact
  [ "$status" -eq 2 ]
}

@test "restore without state: emits template without error" {
  run env HOME="$BATS_TMPDIR" "$CTX_ROUTER" restore "empty-sid"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "Context Restore for empty-sid"
}

@test "restore requires session-id" {
  run "$CTX_ROUTER" restore
  [ "$status" -eq 2 ]
}

@test "on-session-start emits valid JSON" {
  run env HOME="$BATS_TMPDIR" "$CTX_ROUTER" on-session-start "test-sid"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext' >/dev/null
}

@test "on-session-start requires session-id" {
  run "$CTX_ROUTER" on-session-start
  [ "$status" -eq 2 ]
}

@test "on-git-commit without project/sha exits 2" {
  run "$CTX_ROUTER" on-git-commit
  [ "$status" -eq 2 ]
}

@test "on-git-commit missing sha exits 2" {
  run "$CTX_ROUTER" on-git-commit "myproj"
  [ "$status" -eq 2 ]
}

@test "on-git-commit without wtm/brain: degraded ok" {
  run env PATH="/usr/bin:/bin" HOME="$BATS_TMPDIR" "$CTX_ROUTER" on-git-commit "myproj" "abc123" "feat: test"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "git-commit handled"
}

@test "on-tq-transition without sid/tid exits 2" {
  run "$CTX_ROUTER" on-tq-transition
  [ "$status" -eq 2 ]
}

@test "on-tq-transition missing tid exits 2" {
  run "$CTX_ROUTER" on-tq-transition "sid"
  [ "$status" -eq 2 ]
}

@test "on-tq-transition without wtm/brain: degraded ok" {
  run env PATH="/usr/bin:/bin" HOME="$BATS_TMPDIR" "$CTX_ROUTER" on-tq-transition "sid-1" "42" "pending" "in_progress"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "tq-transition handled"
}

@test "on-tq-transition done without task-queue.json: degraded ok" {
  run env PATH="/usr/bin:/bin" HOME="$BATS_TMPDIR" "$CTX_ROUTER" on-tq-transition "sid-1" "42" "in_progress" "done"
  [ "$status" -eq 0 ]
}
