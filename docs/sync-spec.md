# aigentry-devkit sync — Machine-to-Machine Settings Sync

## Overview

`aigentry-devkit sync` synchronizes aigentry ecosystem configuration, state, and memory across machines. Git-based approach — no external service dependency, works offline, auditable history.

## Sync Targets

| Priority | Path | Description | Conflict Strategy |
|----------|------|-------------|-------------------|
| P0 | `~/.aigentry/config/aterm.json` | aterm settings | Last-write-wins |
| P0 | `~/.claude/settings.json` | Claude Code settings | Last-write-wins |
| P0 | `~/.claude/CLAUDE.md` | Global AI instructions | Manual merge |
| P1 | `state/task-queue.json` | Orchestrator task board | Merge (union tasks) |
| P1 | `state/lessons.json` | Lessons learned | Merge (append-only) |
| P1 | `state/file-ownership.json` | File ownership map | Merge (union keys) |
| P1 | `~/.config/aigentry-devkit/aigentry.yml` | Runtime config | Last-write-wins |
| P2 | `~/.claude/projects/*/memory/` | Project memories | Last-write-wins per file |

## Architecture

### Why Git (not rsync, not brain MCP)

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Git repo** | History, merge, offline, SSH auth already exists, no new infra | Requires private repo | **Selected** |
| rsync | Simple, fast | No history, no merge, requires direct SSH, no conflict resolution | Rejected |
| brain MCP | Integrated, structured | Requires brain server running on both machines, network dependency, overkill for config files | Rejected |
| Tailscale + syncthing | P2P, automatic | Extra dependency, no merge semantics, binary sync | Rejected |

### Cross-Platform

- macOS/Linux: `$HOME` for all paths
- Windows: `$USERPROFILE` — devkit already handles this via `const HOME = process.env.HOME || process.env.USERPROFILE`
- Path separator: use `path.join()` in lib/sync.js, not hardcoded `/`
- Git: available on all platforms via Git for Windows / Xcode CLI tools

### Sync Repository

```
~/.aigentry/sync/                    # Local git repo
  ├── .git/
  ├── config/
  │   ├── aterm.json                 # ← ~/.aigentry/config/aterm.json
  │   └── claude-settings.json       # ← ~/.claude/settings.json
  ├── instructions/
  │   └── CLAUDE.md                  # ← ~/.claude/CLAUDE.md
  ├── state/
  │   ├── task-queue.json            # ← orchestrator state
  │   └── lessons.json               # ← orchestrator lessons
  ├── memory/                        # ← ~/.claude/projects/*/memory/
  │   ├── {project-slug}/            # slug = Claude's path encoding (e.g., -Users-foo-projects-bar)
  │   │   ├── MEMORY.md
  │   │   └── *.md
  │   └── ...
  └── manifest.json                  # Machine ID, last sync timestamp, version
```

### manifest.json

```json
{
  "version": 1,
  "machineId": "macbook-m4-home",
  "lastSync": "2026-04-10T09:30:00Z",
  "syncTargets": [
    { "src": "~/.aigentry/config/aterm.json", "dest": "config/aterm.json", "strategy": "last-write-wins" },
    { "src": "~/.claude/settings.json", "dest": "config/claude-settings.json", "strategy": "last-write-wins" },
    { "src": "~/.claude/CLAUDE.md", "dest": "instructions/CLAUDE.md", "strategy": "manual" },
    { "src": "~/projects/aigentry-orchestrator/state/task-queue.json", "dest": "state/task-queue.json", "strategy": "merge-union" },
    { "src": "~/projects/aigentry-orchestrator/state/lessons.json", "dest": "state/lessons.json", "strategy": "merge-append" },
    { "src": "~/projects/aigentry-orchestrator/state/file-ownership.json", "dest": "state/file-ownership.json", "strategy": "merge-union" },
    { "src": "~/.config/aigentry-devkit/aigentry.yml", "dest": "config/aigentry.yml", "strategy": "last-write-wins" },
    { "src": "~/.claude/projects/*/memory/", "dest": "memory/", "strategy": "last-write-wins",
      "note": "project-slug uses Claude's URL-encoded path format, e.g., -Users-foo-projects-bar" }
  ]
}
```

## CLI Interface

```bash
# First-time setup — create sync repo + link to remote
aigentry-devkit sync init
  --remote <git-url>              # e.g., git@github.com:user/aigentry-sync.git
  --machine-id <name>            # Human-readable machine name (default: hostname)

# Push local → sync repo → remote
aigentry-devkit sync push
  --force                        # Overwrite remote (skip pull-first)
  --dry-run                      # Show what would change

# Pull remote → sync repo → local
aigentry-devkit sync pull
  --force                        # Overwrite local (skip conflict check)
  --dry-run                      # Show what would change

# Two-way sync (pull + merge + push)
aigentry-devkit sync
  --dry-run                      # Show what would change

# Show sync status
aigentry-devkit sync status
  # Output: last sync time, pending changes, remote status

# Diff local vs synced
aigentry-devkit sync diff
```

## Sync Flow

### Push

```
1. Copy sync targets → ~/.aigentry/sync/ (overwrite)
2. cd ~/.aigentry/sync/
3. git add -A
4. git diff --cached --stat (if nothing → "Already up to date")
5. git commit -m "sync: {machineId} @ {timestamp}"
6. git push origin main
```

### Pull

```
1. cd ~/.aigentry/sync/
2. git pull --rebase origin main
3. For each sync target:
   a. Compare sync repo file vs local file
   b. If identical → skip
   c. If local is newer (mtime) and remote changed → CONFLICT
   d. Apply conflict strategy:
      - last-write-wins: use remote (pulled) version
      - manual: show diff, ask user
      - merge-union: JSON array union (deduplicate by id field)
      - merge-append: JSON array concat (deduplicate by timestamp+content hash)
4. Copy resolved files → local paths
5. Update manifest.json lastSync
```

### Two-way (default)

```
1. Pull (resolve conflicts)
2. Push (commit local changes on top)
```

## Conflict Resolution Strategies

### last-write-wins
Simple overwrite. Remote version wins on pull, local wins on push. Suitable for atomic config files (aterm.json, claude-settings.json).

### manual
Show unified diff. User chooses: (a) keep local, (b) accept remote, (c) open editor. For CLAUDE.md where semantic meaning matters.

### merge-union (task-queue.json)
```javascript
// Both arrays keyed by task.id
// Remote tasks not in local → add
// Local tasks not in remote → keep
// Both have same id → use higher-status version (done > in_progress > pending)
function mergeUnion(local, remote) {
  const merged = new Map();
  for (const t of local) merged.set(t.id, t);
  for (const t of remote) {
    if (!merged.has(t.id) || statusRank(t.status) > statusRank(merged.get(t.id).status)) {
      merged.set(t.id, t);
    }
  }
  return [...merged.values()].sort((a, b) => a.id - b.id);
}
```

### merge-append (lessons.json)
```javascript
// Deduplicate by content hash, append new entries
function mergeAppend(local, remote) {
  const seen = new Set(local.map(l => hash(l)));
  const merged = [...local];
  for (const r of remote) {
    if (!seen.has(hash(r))) merged.push(r);
  }
  return merged;
}
```

## Security

- Sync repo MUST be **private** (contains settings, API paths, project memory)
- SSH key auth only (no HTTPS tokens in config)
- `.gitignore` in sync repo: no `.env`, no credentials, no API keys
- Pre-push hook: scan for secrets (grep for common patterns: `sk-`, `ANTHROPIC_API_KEY`, etc.)
- Memory files are synced as-is — user is responsible for not storing secrets in memory

## File Layout (devkit)

```
lib/sync.js              # Core sync logic
  - initSync(remote, machineId)
  - pushSync(opts)
  - pullSync(opts)
  - syncStatus()
  - syncDiff()
  - resolveConflict(strategy, local, remote)
```

CLI registration in bin/aigentry-devkit.js:
  - Add `sync` case to main switch (line ~1429)
  - Add sync subcommand help text to printHelp()
  - Parse subcommands: init, push, pull, status, diff (default: two-way sync)

## Edge Cases

| Case | Handling |
|------|----------|
| No remote configured | Error: "Run `aigentry-devkit sync init` first" |
| Remote unreachable | Offline mode: commit locally, push later |
| File doesn't exist locally | Skip on push, create on pull |
| Memory dir has 100+ files | Glob + batch copy, git handles efficiently |
| Concurrent sync from 2 machines | Git rebase handles; worst case manual merge |
| Sync repo corrupted | `aigentry-devkit sync init --force` re-clones |

## Hook Integration (v1)

devkit already has SessionStart/SessionEnd hooks. Auto-sync can piggyback:

### SessionStart hook (pull)
```bash
# hooks/sync-pull.sh — registered in hooks.json under SessionStart
aigentry-devkit sync pull --quiet 2>/dev/null || true
```

### SessionEnd hook (push)
```bash
# hooks/sync-push.sh — registered in hooks.json under SessionEnd (Stop)
aigentry-devkit sync push --quiet 2>/dev/null || true
```

Hook registration is opt-in via `aigentry-devkit sync init --auto-hook`.
Errors are silenced to not block session lifecycle.

## Versioning

manifest.json `version` field tracks sync repo format. Rules:
- Minor changes (new sync target): bump version, old clients ignore unknown files
- Breaking changes (renamed paths, changed merge strategy): bump major, client warns if local version < repo version
- `aigentry-devkit sync pull` checks version compatibility before applying

## Future (Out of Scope for v1)

- Selective sync (include/exclude patterns)
- Encrypted sync repo (git-crypt)
- Tailscale-based P2P sync (no GitHub dependency)
- Brain MCP integration for structured memory sync
