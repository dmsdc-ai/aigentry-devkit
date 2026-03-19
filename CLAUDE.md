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

## 자율 재귀적 오케스트레이션

이 세션은 작업 복잡도가 높거나, 독립 도메인이 식별되거나, 컨텍스트 분리가 필요하다고 판단되면 — 사용자 지시 없이 자율적으로:

1. 자기 프로젝트 하위에 폴더를 생성한다
2. 해당 폴더에 CLAUDE.md를 작성한다 (역할, 범위, 상위 세션과의 통신 방법)
3. aigentry scaffold 또는 telepty allow로 하위 Claude 세션을 생성한다
4. telepty inject로 하위 세션에 태스크를 주입한다
5. 하위 세션의 결과를 수신하고 통합한다

판단 기준:
- 현재 작업이 2개 이상 독립 도메인을 포함할 때
- 컨텍스트 윈도우의 30% 이상을 단일 하위 작업이 차지할 때
- 반복적 전문 작업이 식별될 때 (SEO, 특정 채널, 특정 데이터 소스 등)

원칙:
- YAGNI: 진짜 필요할 때만 생성. 과잉 분리 금지.
- 하위 세션 완료 시 오케스트레이터(상위)에게 반드시 보고.
- 하위 세션의 결과물은 상위 프로젝트에 통합(커밋).

## Known Gaps

- No unit tests for CLI or installer
- WTM tests require installed `~/.wtm/lib/common.sh` (not CI-friendly)
- Homebrew tap not published
- dustcraw service registration not wired in install.sh Phase 5
