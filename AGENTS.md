# AGENTS.md — aigentry-devkit

## Overview

Cross-platform installer and tooling bundle for the aigentry ecosystem.
npm: `@dmsdc-ai/aigentry-devkit` | aigentry 에코시스템의 **프로비저닝 레이어**.

모든 aigentry 모듈을 설치, 설정, 오케스트레이션한다.

## Managed Modules

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
hooks/                    # Session lifecycle hooks
skills/                   # 11 skills (deliberation, env-manager, etc.)
templates/                # AGENTS.md + adapter templates
```

## Key Patterns

- **Module Adapter**: 각 모듈이 `config/modules/*.adapter.json`에 capabilities + healthcheck 선언
- **Install Profile**: `installer-manifest.json`에서 컴포넌트 그룹 정의. Profiles: core, autoresearch-public, curator-public, ecosystem-full
- **Session Provisioning**: `aigentry session create <name>` — kitty/tmux 탭에 telepty + CLI 세션 생성
- **Config**: `aigentry.yml` at `~/.config/aigentry-devkit/` or project root

## Commands

```bash
aigentry setup              # Interactive first-time setup
aigentry status             # Health check all modules
aigentry doctor             # Diagnose issues
aigentry up                 # Start all sessions from aigentry.yml
aigentry session create X   # Create new session
aigentry session kill X     # Kill session
aigentry session list       # List active sessions

# Development
npm test                    # Smoke test
node -c bin/aigentry-devkit.js  # Syntax check
bash -n install.sh          # Shell syntax check
```

## Important Code Paths

- `readAigentrYml()` (line ~612): Returns `{ raw, path }` — MUST call `parseWorkspace(raw)` to get `{ aiCli, sessions, ... }`
- `runStart()` / `runStop()`: Session lifecycle from aigentry.yml
- `runStatus()`: Iterates module adapters, runs healthchecks
- install.sh phases: 1=devkit-core, 2=telepty, 3=deliberation, 4=brain, 5=dustcraw, 6=registry-wiring, 7=config-fanout, 8=smoke-test

## Session Communication

```bash
# List active sessions
telepty list

# Send message to another session
telepty inject --from aigentry-devkit-{cli} <target-session> "message"

# Report to orchestrator
telepty inject --ref --from aigentry-devkit-{cli} aigentry-orchestrator-claude "report"
```

## Work Principles

- **Best-First**: 항상 최선의 해결책 선택. 차선책/우회 금지.
- **Configurable**: 설정으로 제어 가능한 구조. 하드코딩 금지.
- **Evidence-Based**: 추측 금지. 데이터/로그/테스트 결과 기반 판단.
- **Fail Fast**: 에러 즉시 보고. 숨기지 않음.
- **Constitution**: ~/projects/aigentry/docs/CONSTITUTION.md 준수.
