#!/usr/bin/env bats
# Tests for install.sh Phase 1 skill destinations (#1204): the same skill set lands in every
# agent CLI user skill dir in use (claude, codex, gemini, agy, grok). Hermetic: temp HOME,
# a stub PATH (node + no-op npm/tmux, no agent CLI unless a test adds one), devkit-core only.

setup() {
  umask 0077
  INSTALL_SH="$BATS_TEST_DIRNAME/../install.sh"
  SKILLS_SRC="$BATS_TEST_DIRNAME/../skills"
  export HOME="$BATS_TMPDIR/skill-dests-$$-$BATS_TEST_NUMBER"
  STUB_BIN="$HOME/stub-bin"
  mkdir -p "$STUB_BIN"
  mkdir -p "$HOME/tmp"
  ln -s "$(command -v node)" "$STUB_BIN/node"
  for stub in npm tmux; do
    printf '#!/bin/sh\nexit 0\n' > "$STUB_BIN/$stub"
    chmod +x "$STUB_BIN/$stub"
  done
}
teardown() { if [ "${AIGENTRY_TEST_KEEP:-}" != 1 ]; then rm -rf "$HOME"; fi; }

run_install() {
  run env -i PATH="$STUB_BIN" HOME="$HOME" XDG_CONFIG_HOME="$HOME/.config" TMPDIR="$HOME/tmp" \
    /bin/bash "$INSTALL_SH" --non-interactive --profile core --runtime defer --install-assets skills --dry-run "$@" < /dev/null
  [ "$status" -eq 0 ] || return 0
  local digest
  digest="$(printf '%s\n' "$output" | sed -n 's/^--accept-plan //p')"
  run env -i PATH="$STUB_BIN" HOME="$HOME" XDG_CONFIG_HOME="$HOME/.config" TMPDIR="$HOME/tmp" \
    /bin/bash "$INSTALL_SH" --non-interactive --profile core --runtime defer --install-assets skills --accept-plan "$digest" < /dev/null
}

add_cli_stub() {
  printf '#!/bin/sh\nexit 0\n' > "$STUB_BIN/$1"
  chmod +x "$STUB_BIN/$1"
}

# Same skill set as ~/.claude/skills, context-manage byte-identical to the source.
assert_skills_in() {
  [ -f "$1/context-manage/SKILL.md" ]
  cmp -s "$SKILLS_SRC/context-manage/SKILL.md" "$1/context-manage/SKILL.md"
  [ "$(ls "$1")" = "$(ls "$HOME/.claude/skills")" ]
  [ ! -e "$1/project-ops" ]
}

@test "existing config dirs: skills land in all five destinations" {
  mkdir -p "$HOME/.codex" "$HOME/.gemini/config" "$HOME/.grok"
  run_install
  [ "$status" -eq 0 ]
  for d in .claude/skills .codex/skills .gemini/skills .gemini/config/skills .grok/skills; do
    assert_skills_in "$HOME/$d"
  done
  [[ "$output" == *"partial"* ]]
}

@test "no agent CLI and no config dir: only ~/.claude/skills, nothing else created" {
  run_install
  [ "$status" -eq 0 ]
  assert_skills_in "$HOME/.claude/skills"
  [ ! -e "$HOME/.codex" ]
  [ ! -e "$HOME/.gemini" ]
  [ ! -e "$HOME/.grok" ]
  [[ "$output" == *"partial"* ]]
}

@test "CLI on PATH without its config dir: its skills dir is created" {
  add_cli_stub grok
  add_cli_stub agy
  run_install
  [ "$status" -eq 0 ]
  assert_skills_in "$HOME/.grok/skills"
  assert_skills_in "$HOME/.gemini/config/skills"
  [ ! -e "$HOME/.gemini/skills" ]
  [ ! -e "$HOME/.codex" ]
}

@test "re-run skips existing skills per destination; --force refuses" {
  mkdir -p "$HOME/.codex"
  run_install
  [ "$status" -eq 0 ]
  echo "local edit" > "$HOME/.codex/skills/context-manage/SKILL.md"

  run_install
  [ "$status" -eq 0 ]
  [[ "$output" == *"skip"* ]]
  [ "$(cat "$HOME/.codex/skills/context-manage/SKILL.md")" = "local edit" ]

  run_install --force
  [ "$status" -eq 1 ]
  [ "$(cat "$HOME/.codex/skills/context-manage/SKILL.md")" = "local edit" ]
}
