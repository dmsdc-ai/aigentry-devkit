# My aigentry Project

aigentry-powered AI development workspace.

## Quick Start

```bash
aigentry setup              # Install ecosystem
aigentry status             # Check all modules
aigentry tier               # View your plan (Free/Pro/Team)
aigentry start              # Launch all sessions
```

## Ecosystem

| Module | What it does |
|--------|-------------|
| telepty | Session transport — inter-AI communication |
| deliberation | Multi-AI structured discussions |
| brain | Memory persistence — AI remembers across sessions |
| dustcraw | Signal crawling — autonomous data collection |
| amplify | Content generation — auto-publish to platforms |
| registry | Experiment tracking — leaderboards and metrics |
| devkit | Installation and orchestration |

## Session Communication

```bash
# Send a task to another session
telepty inject --from my-session target-session "do something"

# List active sessions
telepty list
```

## Recursive Orchestration

This session can autonomously create sub-sessions when needed:
1. Create a subfolder with CLAUDE.md
2. Launch a Claude session via telepty
3. Inject tasks and collect results
4. Integrate results back into this project

Use this when a task has 2+ independent domains or would consume >30% of context.
