#!/usr/bin/env bash
# Verifies: bin/open-session.sh codex case appends `-c check_for_update_on_startup=false`
# to suppress codex TUI startup update popup (root cause: codex-rs/tui/src/updates.rs
# get_upgrade_version_for_popup() gated by config.check_for_update_on_startup).
#
# Spec: docs/superpowers/specs/2026-04-26-codex-update-prompt-fix.md §7.1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../bin/open-session.sh"

if [ ! -f "$TARGET" ]; then
  echo "FAIL: target script missing at $TARGET" >&2
  exit 2
fi

# Sentinel: the exact codex-case line from spec §5.1.
# Quoted with awk to avoid grep escaping nightmares around `$extra_flags`.
expected='codex)  [ -z "$extra_flags" ] && extra_flags="-c check_for_update_on_startup=false --dangerously-bypass-approvals-and-sandbox";;'

if awk -v needle="$expected" 'index($0, needle) { found=1; exit } END { exit !found }' "$TARGET"; then
  echo "PASS: codex update-prompt suppression flag wired in $TARGET"
else
  echo "FAIL: codex case does not contain expected suppression flag" >&2
  echo "      expected substring: $expected" >&2
  echo "      actual codex case:" >&2
  grep -n 'codex)' "$TARGET" >&2 || true
  exit 1
fi

# Regression sentinels: claude + gemini cases must still carry their original defaults.
grep -q 'claude) \[ -z "\$extra_flags" \] && extra_flags="--permission-mode bypassPermissions"' "$TARGET" \
  || { echo "FAIL: claude default flags regressed" >&2; exit 1; }

grep -q 'gemini) \[ -z "\$extra_flags" \] && extra_flags="--approval-mode yolo"' "$TARGET" \
  || { echo "FAIL: gemini default flags regressed" >&2; exit 1; }

echo "PASS: claude + gemini default flags unchanged"
