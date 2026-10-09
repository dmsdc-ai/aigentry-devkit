#!/usr/bin/env bash
# post-compact-restore.sh — user-level post-compaction hook (#1204): hand the session its own
# snapshot back after a compaction, in any project.
#
# Merged into ~/.claude/settings.json as SessionStart (matcher "compact") by
# lib/bootstrap.js mergeClaudeHooks. Same wording and bound as the orchestrator's project
# hook (.claude/hooks/session-start-compact.sh): at most 400 lines / 32 KiB. Silent when that
# project hook exists (it prints; no duplicate) or when there is no snapshot.
# Workspace: the first of CLAUDE_PROJECT_DIR, GROK_WORKSPACE_ROOT (grok), $PWD.
root="${CLAUDE_PROJECT_DIR:-${GROK_WORKSPACE_ROOT:-$PWD}}"
[ -f "$root/.claude/hooks/session-start-compact.sh" ] && exit 0
snap="$root/.context-snapshot.md"
[ -f "$snap" ] || exit 0
printf 'CONTEXT SNAPSHOT restored after compact — %s (written %s). Read it, then continue the work it describes.\n\n' \
  "$snap" "$(date -r "$snap" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || echo unknown)"
head -c 32768 "$snap" | head -n 400
