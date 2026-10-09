#!/usr/bin/env bats
# Tests for install.sh Phase 1 skill destinations (#1204): the same skill set lands in every
# agent CLI user skill dir in use (claude, codex, gemini, agy, grok). Hermetic: temp HOME,
# a stub PATH (node + no-op npm/tmux, no agent CLI unless a test adds one), devkit-core only.

setup() {
  INSTALL_SH="$BATS_TEST_DIRNAME/../install.sh"
  SKILLS_SRC="$BATS_TEST_DIRNAME/../skills"
  export HOME="$BATS_TMPDIR/skill-dests-$$-$BATS_TEST_NUMBER"
  STUB_BIN="$HOME/stub-bin"
  mkdir -p "$STUB_BIN"
  ln -s "$(command -v node)" "$STUB_BIN/node"
  for stub in npm tmux; do
    printf '#!/bin/sh\nexit 0\n' > "$STUB_BIN/$stub"
    chmod +x "$STUB_BIN/$stub"
  done
}
teardown() { rm -rf "$HOME"; }

run_install() {
  run env -i PATH="$STUB_BIN:/usr/bin:/bin" HOME="$HOME" XDG_CONFIG_HOME="$HOME/.config" \
    AIGENTRY_INSTALL_COMPONENTS=devkit-core bash "$INSTALL_SH" "$@" < /dev/null
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
  [ "$(printf '%s\n' "$output" | grep -c 'skills in ')" -eq 5 ]
}

@test "no agent CLI and no config dir: only ~/.claude/skills, nothing else created" {
  run_install
  [ "$status" -eq 0 ]
  assert_skills_in "$HOME/.claude/skills"
  [ ! -e "$HOME/.codex" ]
  [ ! -e "$HOME/.gemini" ]
  [ ! -e "$HOME/.grok" ]
  [ "$(printf '%s\n' "$output" | grep -c 'skills in ')" -eq 1 ]
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

@test "re-run skips existing skills per destination; --force overwrites" {
  mkdir -p "$HOME/.codex"
  run_install
  [ "$status" -eq 0 ]
  echo "local edit" > "$HOME/.codex/skills/context-manage/SKILL.md"

  run_install
  [ "$status" -eq 0 ]
  [[ "$output" == *"context-manage already exists in $HOME/.codex/skills (skipping"* ]]
  [ "$(cat "$HOME/.codex/skills/context-manage/SKILL.md")" = "local edit" ]

  run_install --force
  [ "$status" -eq 0 ]
  cmp -s "$SKILLS_SRC/context-manage/SKILL.md" "$HOME/.codex/skills/context-manage/SKILL.md"
}
