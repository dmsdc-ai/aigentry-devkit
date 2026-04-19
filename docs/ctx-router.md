# ctx-router — Context Compact & Switching Glue

Spec: `aigentry-orchestrator/docs/superpowers/specs/2026-04-19-context-compact-switching-design.md`

Glue layer that routes session lifecycle events (precompact, session-start,
git-commit, tq-transition, session-end) between existing ephemeral state
(wtm-context journal + handoff) and long-term knowledge (brain). No new
storage, no polling daemons — pure bash + `jq` + existing wtm + brain.

## Install

```bash
bash aigentry-devkit/bin/ctx-install.sh
```

Installs `~/.claude/hooks/pre-compact.sh` and `~/.claude/hooks/session-start.sh`,
merges them into `~/.claude/settings.json` under `PreCompact` / `SessionStart`
(idempotent — re-running leaves settings byte-identical). Git `post-commit`
template is opt-in per project; the installer prints the `cp` recipe.

## Manual invocation

- `ctx-router.sh on-precompact <sid>` — write wtm handoff + brain summary.
- `ctx-router.sh restore <sid>` — merged markdown preview (wtm handoff +
  brain summary), stdout.
- `ctx-router.sh on-session-start <sid>` — JSON wrapper around `restore`
  for Claude Code `hookSpecificOutput.additionalContext` (16 KB cap).
- `ctx-router.sh on-git-commit <project> <sha> <msg>` — brain decision.
- `ctx-router.sh on-tq-transition <sid> <tid> <old> <new>` — journal
  milestone; on `new=done` also brain summary.
- `ctx-router.sh on-session-end <sid>` — final handoff + promotes
  `LEARNING:` markers from journal to brain `app:<cwd>/learning`.

## Orphan recovery

If a session dies before writing a handoff and the new one was started with a
fresh id:

```bash
wtm-context orphan-check [cwd]            # find most-recent matching sid
wtm-context rebind <cwd> <new-sid>        # alias orphan -> new sid
```

`rebind` is fail-loud — unknown cwd returns exit 1. No silent merges.

## Disable

Remove `hooks.PreCompact` and `hooks.SessionStart` entries from
`~/.claude/settings.json`, and `rm ~/.claude/hooks/{pre-compact,session-start}.sh`.
Hook scripts always `exit 0` on any backend failure, so disabling has no
effect on Claude Code behaviour beyond dropping the context handoff.

## Degraded modes

Every backend call is fail-soft:
- `wtm-context` missing → log to stderr, skip.
- `brain` CLI missing → log to stderr, skip.
- Both missing → ctx-router still exits 0 so hooks never block.
