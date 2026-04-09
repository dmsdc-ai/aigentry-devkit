<!-- aterm:initial — Codex session rules (brief) -->

# Session Commands

| Action | Command |
|--------|---------|
| List sessions | `aterm list` |
| Send message | `aterm inject <workspace> 'message'` |
| Tasks | `aterm tasks` |

# Rules

- If `$ATERM_IPC_SOCKET` exists → use `aterm`. Otherwise → use `telepty`.
- Execute delegated tasks. Stay in your project folder.
- NEVER ask questions. Decide autonomously.
