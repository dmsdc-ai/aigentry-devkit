<!-- aterm:initial — This is an auto-generated template. Customize for your project or run /init to auto-analyze. -->

# Session Communication

## Internal (same aterm)

| Action | Command |
|--------|---------|
| List sessions | `aterm list` |
| Send to session | `aterm inject <workspace> 'message'` |
| Task list | `aterm tasks` |
| Add task | `aterm tasks add 'description'` |
| Complete task | `aterm tasks done <id>` |
| Breakdown task | `aterm tasks breakdown <id>` |
| Lessons | `aterm lessons` |
| Help | `aterm help` |

## External (other terminals/machines)

| Action | Command |
|--------|---------|
| List sessions | `telepty list` |
| Send to session | `telepty inject <session> 'message'` |

## Rules

- $ATERM_IPC_SOCKET exists -> use aterm commands
- $ATERM_IPC_SOCKET absent -> use telepty commands
- Detect ALL AI CLIs: claude, codex, gemini, ollama, aider

## Principles

- Critical: point out weaknesses
- Constructive: provide alternatives
- Objective: balanced analysis

## Reporting

- On task completion: aterm inject orchestrator 'REPORT: summary'
