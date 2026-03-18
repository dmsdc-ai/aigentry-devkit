# aigentry-devkit

Cross-platform installer and tooling bundle for the aigentry ecosystem.
npm: `@dmsdc-ai/aigentry-devkit` | v0.0.5

## Role in Ecosystem

devkit is the **provisioning layer** — it installs, configures, and orchestrates all aigentry modules:

| Module | Package | Role |
|--------|---------|------|
| telepty | @dmsdc-ai/aigentry-telepty | Session transport + inter-session communication |
| deliberation | @dmsdc-ai/aigentry-deliberation | Multi-AI structured discussion (MCP server) |
| brain | @dmsdc-ai/aigentry-brain | Memory persistence + pattern learning |
| dustcraw | @dmsdc-ai/aigentry-dustcraw | Signal crawling + autonomous experiments |
| amplify | @dmsdc-ai/aigentry-amplify | Content generation + distribution |
| registry | API service | Experiment tracking + leaderboard |
| bridge | @aigentry/bridge (placeholder) | CLI bridge to registry backend |

## Architecture

```
bin/aigentry-devkit.js    # Main CLI (1,400 lines) — setup, status, doctor, up, session
install.sh                # Bash installer — 8 phases, manifest-driven
config/
  installer-manifest.json # Install profiles (core, autoresearch, curator, ecosystem-full)
  aigentry.yml.template   # Unified runtime config schema
  mcp-registry.json       # MCP server bundle definitions
  modules/*.adapter.json  # Module health/capability declarations
hooks/
  hooks.json              # Claude Code hook definitions (SessionStart, SessionEnd)
  session-start           # Loads skills index into conversation context
  brain-session-*.sh      # Brain memory save/restore on session lifecycle
skills/                   # 11 Claude Code skills (deliberation, env-manager, etc.)
tools/wtm/                # WTM experiment runner (init, run, status, report)
templates/                # AGENTS.md + adapter templates
```

## Key Patterns

- **Module Adapter**: Each module declares capabilities + healthcheck in `config/modules/*.adapter.json`
- **Install Profile**: `installer-manifest.json` defines component groups. Profiles: core, autoresearch-public, curator-public, ecosystem-full
- **Session Provisioning**: `aigentry session create <name>` opens kitty/tmux tab with telepty + Claude
- **Config**: `aigentry.yml` at `~/.config/aigentry-devkit/` or project root. Parsed by `readAigentrYml()` → `parseWorkspace()`

## Commands

```bash
# CLI
aigentry setup              # Interactive first-time setup
aigentry status             # Health check all modules
aigentry doctor             # Diagnose issues
aigentry up                 # Start all sessions from aigentry.yml
aigentry session create X   # Create new session for project X
aigentry session kill X     # Kill session
aigentry session list       # List active sessions

# Development
npm test                    # Smoke test (--help only, no real tests yet)
node -c bin/aigentry-devkit.js  # Syntax check
bash -n install.sh          # Shell syntax check
```

## MCP Tools

Deliberation MCP server (`@dmsdc-ai/aigentry-deliberation`) provides:
- `deliberation_start`, `deliberation_respond`, `deliberation_synthesize` — structured multi-AI discussions
- `decision_start`, `decision_respond` — decision tracking
- Full tool list in `config/mcp-registry.json`

## Important Code Paths

- `readAigentrYml()` (line ~612): Returns `{ raw, path }` — MUST call `parseWorkspace(raw)` to get `{ aiCli, sessions, ... }`
- `runStart()` / `runStop()`: Session lifecycle from aigentry.yml
- `runStatus()`: Iterates module adapters, runs healthchecks
- install.sh phases: 1=devkit-core, 2=telepty, 3=deliberation, 4=brain, 5=dustcraw, 6=registry-wiring, 7=config-fanout, 8=smoke-test

## Recent Changes (2026-03)

- fix: 5 bugs (brain CLI command, registry healthcheck, awk portability, session aiCli hardcoding, parseWorkspace usage)
- feat: amplify in ecosystem-full profile, bridge placeholder, telepty semver check, brain hooks auto-wiring

## Known Gaps

- No unit tests for CLI or installer
- WTM tests require installed `~/.wtm/lib/common.sh` (not CI-friendly)
- Homebrew tap not published
- dustcraw service registration not wired in install.sh Phase 5
