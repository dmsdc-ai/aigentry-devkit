#!/usr/bin/env bats
# E2E: real wtm-context + stubbed brain — verify full compact/restore cycle.

setup() {
  DEVKIT_ROOT="$BATS_TEST_DIRNAME/.."
  CTX_ROUTER="$DEVKIT_ROOT/bin/ctx-router.sh"
  export CTX_ROUTER

  CTX_E2E_HOME="$BATS_TMPDIR/ctx-e2e-$$-$BATS_TEST_NUMBER"
  mkdir -p "$CTX_E2E_HOME/.wtm/contexts" "$CTX_E2E_HOME/.wtm/bin" "$CTX_E2E_HOME/.wtm/lib"
  export HOME="$CTX_E2E_HOME"
  export WTM_HOME="$CTX_E2E_HOME/.wtm"
  export WTM_SESSIONS="$WTM_HOME/sessions.json"
  echo '{"version":1,"sessions":{}}' > "$WTM_SESSIONS"

  # Link real wtm-context + libs so it finds HOME-scoped deps
  ln -sf "$DEVKIT_ROOT/tools/wtm/bin/wtm-context" "$WTM_HOME/bin/wtm-context"
  for f in "$DEVKIT_ROOT/tools/wtm/lib/"*.sh; do
    ln -sf "$f" "$WTM_HOME/lib/$(basename "$f")"
  done

  # Brain stub: log every invocation so assertions can grep
  BRAIN_STUB_LOG="$CTX_E2E_HOME/brain.log"
  export BRAIN_STUB_LOG
  cat > "$WTM_HOME/bin/brain" <<'EOF'
#!/usr/bin/env bash
echo "brain $*" >> "${BRAIN_STUB_LOG:-/dev/null}"
EOF
  chmod +x "$WTM_HOME/bin/brain"
  export PATH="$WTM_HOME/bin:$PATH"
}

teardown() {
  [[ -n "${CTX_E2E_HOME:-}" && -d "${CTX_E2E_HOME}" ]] && rm -rf "$CTX_E2E_HOME"
}

@test "full cycle: precompact then restore emits template" {
  local sid="demo:coder"
  run "$CTX_ROUTER" on-precompact "$sid"
  [ "$status" -eq 0 ]
  run "$CTX_ROUTER" restore "$sid"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "Context Restore for $sid"
  # brain should have received the precompact summary append
  [ -f "$BRAIN_STUB_LOG" ]
  grep -q "append" "$BRAIN_STUB_LOG"
}

@test "on-tq-transition done promotes to brain stub" {
  run "$CTX_ROUTER" on-tq-transition "demo:coder" 42 pending done
  [ "$status" -eq 0 ]
  [ -f "$BRAIN_STUB_LOG" ]
  grep -q "append" "$BRAIN_STUB_LOG"
  grep -q "app:orchestrator" "$BRAIN_STUB_LOG"
}

@test "on-tq-transition non-done does NOT promote to brain" {
  run "$CTX_ROUTER" on-tq-transition "demo:coder" 42 pending in_progress
  [ "$status" -eq 0 ]
  # Only journal milestone, no brain append
  [ ! -s "$BRAIN_STUB_LOG" ] || ! grep -q "app:orchestrator" "$BRAIN_STUB_LOG"
}

@test "on-git-commit promotes to brain stub" {
  run "$CTX_ROUTER" on-git-commit "myproj" "abc123" "feat: add feature"
  [ "$status" -eq 0 ]
  [ -f "$BRAIN_STUB_LOG" ]
  grep -q "append" "$BRAIN_STUB_LOG"
  grep -q "app:myproj" "$BRAIN_STUB_LOG"
  grep -q "abc123" "$BRAIN_STUB_LOG"
}

@test "on-session-end writes handoff and promotes LEARNING lines" {
  local sid="demo:ender"
  local ctx_dir="$WTM_HOME/contexts/demo/ender"
  mkdir -p "$ctx_dir"
  # journal_tail reads the 'content' key; include LEARNING: marker
  cat > "$ctx_dir/journal.jsonl" <<'JSONL'
{"timestamp":"2026-04-19T10:00:00Z","type":"note","content":"regular note no marker","metadata":{}}
{"timestamp":"2026-04-19T10:01:00Z","type":"milestone","content":"LEARNING: always fail soft on brain","metadata":{}}
{"timestamp":"2026-04-19T10:02:00Z","type":"note","content":"LEARNING: use process substitution","metadata":{}}
JSONL

  run "$CTX_ROUTER" on-session-end "$sid"
  [ "$status" -eq 0 ]

  # handoff should have been written via wtm-context handoff
  grep -q '"last_handoff"' "$WTM_SESSIONS"
  grep -q "session-end-auto" "$WTM_SESSIONS"

  # brain stub should have 2 learning entries
  [ -f "$BRAIN_STUB_LOG" ]
  learning_count=$(grep -c "category learning" "$BRAIN_STUB_LOG" || echo 0)
  [ "$learning_count" -ge 2 ]
}
