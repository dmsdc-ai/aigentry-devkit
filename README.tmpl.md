# aigentry-devkit

**One installer for your AI dev environment** — bundles skills, hooks, MCP servers, HUD/statusline, and config templates for Claude Code, Codex CLI, and other MCP-compatible CLIs. Install once, use everywhere.

Part of the [aigentry platform](https://github.com/dmsdc-ai).

## Quickstart

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install
```

Then restart your CLI so new MCP/skill settings load. List available profiles with `npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit profiles`; full walkthrough in [`docs/quickstart.md`](docs/quickstart.md).

## Features

### Skills (Reusable AI Capabilities)

Bundled skills that extend Claude Code, Codex CLI, and other MCP-compatible CLIs:

- **AI Deliberation** - Multi-session parallel debates across arbitrary CLI participants with structured turn-taking and synthesis
- **Deliberation Executor** - Convert deliberation synthesis into concrete implementation tasks and execute them
- **Deliberation Gate** - Route a design doc, code review, or dead-ended debug session into a multi-AI verification pass
- **Diagnose** - Reproduce-first diagnosis loop for hard bugs and performance regressions
- **Grill with ADR** - Adversarial spec interview that captures crystallised decisions into ADRs and the project glossary
- **SAWE** - Session Autonomous Workflow Engine: spec to implement, build, test, verify without babysitting
- **Session Create** - Bootstrap a new project and its terminal-agnostic session, with grid layout
- **Work Breakdown** - Decompose a spec into parallelisable tasks and assign them to available sessions
- **Workspace Lifecycle** - Foreground open, inject, wait, read, close automation for cmux/aterm workspaces
- **Context Manage** - Context-window pressure detection with snapshot and compact staging
- **Caveman** - Ultra-compressed reply mode (~75% fewer output tokens) for multi-session fan-out
- **Environment Manager** - direnv-based hierarchical environment variable management with global and project-scoped variables
- **Telepty Deliberate** - Start bidirectional multi-session deliberation across active telepty sessions with session mapping and fallback routing

#### Un-bundled skills (written fallback)

`clipboard-image`, `youtube-analyzer`, and `project-ops` live in this repository but are **not** shipped in
the npm tarball and are **not** installed by `install.sh` / `install.ps1`. Each depends on host tooling the
devkit does not own (`pbpaste`/`xclip`, `yt-dlp` + Python, an authenticated `gh` CLI with org-wide secret
scope), so bundling them would push an external dependency onto every installer run — Constitution Article 17
(zero external dependency) requires a written fallback instead of a hard dependency.

Fallback — do the same work without the skill:

| Skill | Fallback |
| --- | --- |
| `clipboard-image` | macOS `pbpaste`, Linux `xclip -selection clipboard -t image/png -o > /tmp/clip.png`, then point your CLI at the file. Or copy `skills/clipboard-image/` from this repo into `~/.claude/skills/` yourself. |
| `youtube-analyzer` | `pip install yt-dlp`, then `yt-dlp --skip-download --write-auto-sub --sub-lang en <url>` and feed the `.vtt` to your CLI. Or copy `skills/youtube-analyzer/` into `~/.claude/skills/`. |
| `project-ops` | `gh secret set NPM_TOKEN --repo <org>/<repo>` per repository, and copy `.github/workflows/release.yml` from an already-configured repo. Or copy `skills/project-ops/` into `~/.claude/skills/`. |

Installing a fallback copy by hand is supported: `cp -R skills/<name> ~/.claude/skills/`.

### MCP Deliberation Server

A dedicated MCP (Model Context Protocol) server enabling multi-session AI debates with:

- Parallel deliberation sessions with independent state management
- Structured response formats (evaluation, core position, reasoning, risks, synthesis)
- Automatic session monitoring with optional tmux integration
- State persistence and session history archiving

### HUD/Statusline

Custom statusline display for Claude Code that shows real-time context from stdin, with support for extended context windows (up to 1M tokens on Claude Opus).

### Hooks

Session-start bootstrap hooks that automatically load skill indices and prepare your environment when Claude Code starts.

### Configuration Templates

Pre-configured settings with template substitution:

- `settings.json.template` - Claude Code settings with `{{HOME}}` substitution
- `global.envrc` - direnv configuration for hierarchical environment management
- `CLAUDE.md` - AI agent instructions (oh-my-claudecode compatible)

## Installation

### Prerequisites

- Node.js 18+ (Node.js 20+ when the `telepty` component is selected, which every built-in profile does)
- npm (included with Node.js)
- Optional: Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Optional: tmux (for deliberation monitoring)
- Optional: direnv (for environment management)

### Quick Start

Recommended path:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install
```

List profiles first:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit profiles
```

Install a specific profile:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install --profile autoresearch-public
```

Use `curator-public` for `dustcraw + brain + registry wiring`, or `ecosystem-full` for the whole stack.

Force reinstall:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install --force
```

Manual install (local clone) is still available:

macOS / Linux:

```bash
git clone https://github.com/dmsdc-ai/aigentry-devkit.git
cd aigentry-devkit
bash install.sh
```

Windows (PowerShell):

```powershell
git clone https://github.com/dmsdc-ai/aigentry-devkit.git
cd aigentry-devkit
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer will:

1. Verify Node.js and optional dependencies (Claude Code CLI, tmux, direnv)
2. Install devkit assets, skills, HUD, and templates
3. Install and health-check local `telepty`
4. Install canonical `deliberation` MCP runtime
5. Optionally install `brain`
6. Optionally install and bootstrap `dustcraw`
7. Optionally wire registry credentials (`AIGENTRY_API_URL`, `AIGENTRY_API_KEY`)
8. Write local install state and env fan-out

Detailed walkthrough: [`docs/quickstart.md`](docs/quickstart.md)

### telepty version compatibility

`install.sh` and `install.ps1` share one decision (`lib/telepty-version-policy.js`), driven by
`config/installer-manifest.json`: the tested pin `components.telepty.install.version` (`0.8.5`) and the
supported range `compatibility.telepty.minimum` / `maximum_exclusive` (`>=0.8.5 <0.9.0`), plus
`compatibility.telepty.node_minimum` (`20.0.0`). These are the tested bounds, not a claim about the latest
telepty release. The installer reads the installed `telepty --version` (stable `X.Y.Z`, optional `v`)
before any npm call, allowing it 5 seconds to answer and at most 1024 bytes of output. A probe that misses
that deadline is stopped (on Windows, stopping the probe's own process tree may take up to 5 more seconds, so
one probe takes at most 10 seconds):

| Installed telepty | Installer action |
|---|---|
| none | `npm install -g @dmsdc-ai/aigentry-telepty@<pin>` |
| below `minimum` | upgrade to exactly `<pin>` |
| within the range, including newer than the pin | kept as is, no npm call (works offline) |
| at or above `maximum_exclusive` | left unchanged, never downgraded; the install stops with a non-zero exit and instructions |
| unidentifiable (prerelease/build/free text, or `telepty --version` fails, does not answer within 5 seconds, or prints more than 1024 bytes) | left unchanged; the install stops with a non-zero exit |

The install also stops before any npm or daemon step when Node.js is below `node_minimum`, or when the
manifest pin or bounds are missing, malformed, or inconsistent (pin outside the range). There is no
fallback to `latest`, and a failed npm install is not retried with another version. After an install or
upgrade, the new `telepty --version` must fall inside the range; only that observed version is recorded in
`install-state.json`. The final install summary shows that recorded version without running telepty again,
or `not checked` when the telepty phase did not run.

## Offline / Firewalled Install

Component installs have no fallback chain, no alternative-source retry and no `latest` fallback. Each
component is installed by exactly one attempt of the one method `config/installer-manifest.json`
declares for it, and what happens when that attempt fails is the component's `failure_policy`:

| `failure_policy` | Components | On failure |
|---|---|---|
| `hard` | `devkit-core`, `telepty`, `deliberation`, `wtm-experiment` | the install stops with a non-zero exit; no later phase runs |
| `soft` | `brain`, `dustcraw`, `registry-wiring`, `amplify`, `bridge`, `orchestrator-role` | a warning is printed, the component is left uninstalled, and the remaining phases continue |

What that means on a firewalled or offline host:

- An already-installed, in-range `telepty` is **kept with no npm call**, so a fully offline rerun of
  a previously completed install does not need the registry for that phase (see
  [telepty version compatibility](#telepty-version-compatibility)).
- A missing or too-old `telepty` needs the registry: its npm install is one exact-pin attempt, and a
  failure stops the install (`hard`) rather than falling back to another version or source.
- Optional components that cannot be fetched only cost you those components. `brain` unavailable
  means brain features are unavailable — there is no local stub server standing in for it.
- Nothing bypasses npm's own proxy configuration: if your network needs `HTTPS_PROXY` or
  `NODE_EXTRA_CA_CERTS`, set them before running the installer, and prefer `npm` settings you
  already trust. Credential and permission errors are passed through as npm reported them.

### Narrowing what a run touches

```bash
# Install only the components you can actually reach (comma-separated; default: devkit-core,telepty,deliberation)
AIGENTRY_INSTALL_COMPONENTS=devkit-core bash install.sh

# Resume at a phase number or component name after fixing connectivity
AIGENTRY_INSTALL_RESUME=telepty bash install.sh

# Point at a different manifest (e.g. an internally pinned copy)
AIGENTRY_INSTALL_MANIFEST=/path/to/installer-manifest.json bash install.sh
```

`bash install.sh` itself takes one flag, `--force` (`-f`), to overwrite existing devkit assets. The
CLI entry point (`aigentry-devkit setup`) additionally accepts `--profile`, `--manifest`, `--resume`
and `--dry-run`; `aigentry-devkit setup --dry-run` prints the resolved plan without installing
anything.

### What the installer records

The durable record is a single file, written in the last phase of a run:

```
${XDG_CONFIG_HOME:-$HOME/.config}/aigentry-devkit/install-state.json
```

It holds the selected profile and components, the observed `telepty` version, and the settings each
component phase resolved. There is no per-attempt log file. To see what a phase did, run the
installer with its output visible, or re-run `aigentry-devkit doctor` / `aigentry-devkit status`
afterwards — `status` reports the version each module's own healthcheck prints, and `unknown` when a
module cannot be identified.

### Post-Installation

After installation, restart Claude/Codex/Gemini so MCP changes are picked up:

```bash
# Restart your CLI process to load new MCP settings
```

To verify installation:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit doctor
telepty --version
curl -sf http://localhost:3848/api/meta
npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-doctor
aigentry-brain health
dustcraw demo --non-interactive
```

If Gemini local MCP registration drifts:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit repair-gemini-mcp
```

## Usage

### Skills

Skills are automatically available in Claude Code, Codex CLI, and compatible MCP clients. They activate based on keywords:

#### AI Deliberation
Triggers: "deliberation", "토론", "debate", "deliberate"

Start a multi-perspective debate:
```
"deliberation: Should we use microservices or monolith?"
"토론 시작: API 설계 전략"
```

Multiple sessions run in parallel. Use `deliberation_start` to get a session ID, then reference it in subsequent calls.

#### Telepty Deliberate
Triggers: "모든 세션이랑 토론해", "멀티세션 토론", "session deliberation", "telepty deliberate"

Start a bidirectional discussion across active telepty-managed sessions:
```
"모든 세션이랑 토론해. 주제는 autoresearch 인터페이스 정렬"
"멀티세션 토론 시작: 각 프로젝트가 제공/필요로 하는 인터페이스 정리"
```

The skill auto-detects the current `TELEPTY_SESSION_ID`, collects active sessions, builds a project map, injects routing rules + skill-matching hints + boundary enforcement, and prefers `telepty deliberate` when available. If that command is unavailable, it falls back to `telepty multicast` with the full protocol embedded in the kickoff prompt.

### WTM Experiment Runner

WTM now includes an experiment runner entrypoint with built-in `program.md` templating:

```bash
wtm experiment init myproj:experiment-latency --goal "Reduce p95 latency"
wtm experiment run myproj:experiment-latency --eval-cmd "npm test" --decision keep --score 0.82
wtm experiment status myproj:experiment-latency
wtm experiment report myproj:experiment-latency --json
```

`wtm experiment init` uses the built-in `experiment-program` template to create `program.md`, plus `results.tsv`, `results.jsonl`, and `state.json` under `~/.wtm/experiments/<session>/`.

#### Deliberation Executor
Triggers: "합의안 구현", "토론 결과 구현", "deliberation 구현", "synthesis 구현", "executor"

Execute implementation from synthesis:
```
"session_id abc123 합의안 구현해줘"
"토론 결과를 코드로 반영하고 테스트까지 진행해줘"
```

Use this after `deliberation_synthesize` when you want implementation, not just discussion.

#### Environment Manager
Triggers: "env", "환경변수", "environment", ".env", "direnv"

Manage environment variables hierarchically:
```
"env check" - Audit environment setup
"env init /path/to/project" - Initialize new project
"env add API_KEY value" - Add global or project variable
```

### Workspace Initialization

Initialize a new workspace for an AI CLI session with templates, state files, and role-specific configuration:

```bash
aigentry-devkit workspace-init --cli claude --cwd ~/projects/my-project
```

**Supported CLIs:** `claude`, `codex`, `gemini`

**What it creates:**

| File | Purpose |
|------|---------|
| `AGENTS.md` | Session communication commands, configurable items, role-specific rules |
| `CLAUDE.md` / `GEMINI.md` | CLI-specific instructions (with `{{WORKSPACE_NAME}}` substitution) |
| `state/task-queue.json` | Task tracking for AI assistants |
| `state/lessons.json` | Learnings and invariants store |

**Role detection:** If the workspace name is `orchestrator`, AGENTS.md gets orchestrator-specific rules (delegate, don't code). Otherwise it gets worker rules (execute, report back).

**Idempotent:** Existing files are never overwritten. Only missing files are created.

### MCP Deliberation Server

The deliberation server provides these tools:

| Tool | Purpose |
|------|---------|
| `deliberation_speaker_candidates` | List selectable speakers from local CLIs and open browser LLM tabs |
| `deliberation_start` | Start new debate session with user-selected speakers, returns session_id (`participant_types` override supported) |
| `deliberation_route_turn` | Resolve current speaker transport and next action (`cli_respond` / `clipboard` / `browser_auto`) |
| `deliberation_browser_auto_turn` | Send turn to browser LLM automatically via CDP and collect response |
| `deliberation_respond` | Submit turn response |
| `deliberation_browser_llm_tabs` | Inspect open browser LLM tabs |
| `deliberation_clipboard_prepare_turn` | Copy current-turn prompt for browser LLM |
| `deliberation_clipboard_submit_turn` | Submit clipboard/browser response as a turn |
| `deliberation_context` | Load project context |
| `deliberation_list_active` | List active sessions |
| `deliberation_status` | Check session status |
| `deliberation_synthesize` | Generate synthesis report |
| `deliberation_history` | View full debate transcript |
| `deliberation_list` | Browse past sessions |
| `deliberation_reset` | Clear sessions |

Example workflow:

```bash
# Start any CLI with MCP deliberation enabled
<your-cli>

# In CLI A:
# > "deliberation: API design - REST vs GraphQL?"
# 1) Find selectable participants (CLI + browser LLM tabs)
# deliberation_speaker_candidates()
# 2) Start with manually selected speakers
# deliberation_start(topic="...", speakers=["codex","web-claude-1","web-chatgpt-1"], first_speaker="codex")
# optional: force transport profile per speaker
# deliberation_start(topic="...", speakers=["codex","chatgpt"], participant_types={"chatgpt":"browser_auto"})
# 3) Route the current turn
# deliberation_route_turn session_id=sess_12345
# Submit turns with deliberate speakers:
# deliberation_respond session_id=sess_12345 speaker=codex
# Browser turn flow:
# deliberation_clipboard_prepare_turn session_id=sess_12345 speaker=web-claude-1
# (paste into browser LLM, copy response)
# deliberation_clipboard_submit_turn session_id=sess_12345 speaker=web-claude-1
# Browser auto flow (CDP):
# deliberation_browser_auto_turn session_id=sess_12345 provider=chatgpt
# After rounds complete:
# deliberation_synthesize session_id=sess_12345
```

### HUD Statusline

The simple-status.sh script displays context in your shell prompt. Configure in `~/.claude/settings.json`:

```json
{
  "hud": {
    "enabled": true,
    "script": "~/.claude/hud/simple-status.sh",
    "contextWindow": 1000000
  }
}
```

## Project Structure

```
aigentry-devkit/
├── bin/                     # npx entrypoint
│   └── aigentry-devkit.js
├── .claude-plugin/           # Claude Code plugin manifests
│   ├── plugin.json          # Plugin metadata
│   └── marketplace.json     # Marketplace listing
├── config/                  # Configuration templates
│   ├── CLAUDE.md            # AI agent instructions
│   ├── settings.json.template
│   └── envrc/global.envrc
├── hooks/                   # Session lifecycle hooks
│   ├── hooks.json           # Hook definitions
│   └── session-start        # Bootstrap script
├── hud/                     # Statusline/HUD
│   └── simple-status.sh
├── mcp-servers/             # Model Context Protocol servers
│   └── deliberation/        # AI deliberation server
│       ├── index.js         # Main server implementation
│       ├── package.json
│       └── session-monitor.sh
├── skills/                  # Cross-cutting AI skills (devkit is the SSOT)
│   ├── caveman/             # Ultra-compressed reply mode
│   ├── context-manage/      # Context-window pressure handling
│   ├── deliberation/        # Debate management
│   ├── deliberation-executor/ # Synthesis-to-implementation execution
│   ├── deliberation-gate/   # Multi-AI verification gate
│   ├── deliberation-test/   # Deliberation test orchestration
│   ├── diagnose/            # Reproduce-first bug diagnosis loop
│   ├── env-manager/         # Environment variables
│   ├── grill-with-adr/      # Adversarial spec interview -> ADR
│   ├── sawe/                # Session autonomous workflow engine
│   ├── session-create/      # Project + session bootstrap
│   ├── telepty-deliberate/  # Multi-session telepty deliberation kickoff
│   ├── work-breakdown/      # Spec -> parallel task decomposition
│   ├── workspace-lifecycle/ # Workspace open/inject/wait/close automation
│   └── (clipboard-image, youtube-analyzer, project-ops — present but un-bundled)
├── install.sh               # Installation script (macOS/Linux)
├── install.ps1              # Installation script (Windows PowerShell)
├── package.json             # npm package metadata (@dmsdc-ai/aigentry-devkit)
├── LICENSE                  # MIT License
└── README.md                # This file
```

## Configuration

### Claude Code Integration

After installation, skills and MCP servers are automatically available. Configuration is stored in:

- `~/.claude/skills/` - Skill definitions
- `~/.claude/.mcp.json` - MCP server registration
- `~/.claude/settings.json` - Claude Code settings

### Codex CLI Integration

If Codex CLI is installed, the installer attempts to register the MCP deliberation server. Manual registration:

```bash
codex mcp add deliberation -- node ~/.local/lib/mcp-deliberation/index.js
```

Important: Codex is a participant CLI in deliberation, not a separate MCP server you must install.

Other CLIs can join deliberation by registering the same MCP server command in their MCP/client configuration:

```bash
node ~/.local/lib/mcp-deliberation/index.js
```

### Environment Management

direnv integration (requires direnv):

```bash
# Global configuration
cp config/envrc/global.envrc ~/.envrc
direnv allow

# Per-project
cd ~/my-project
echo 'source_up_if_exists' > .envrc
echo 'dotenv_if_exists .env.local' >> .envrc
direnv allow
```

## Troubleshooting

### Skills not loading

1. Verify skills are installed: `ls -la ~/.claude/skills/`
2. Restart your MCP client process (Claude/Codex/etc.)
3. Check for keyword matches in skill definitions

### MCP Deliberation not available

1. Verify MCP registration: `cat ~/.claude/.mcp.json`
2. Check installation: `ls ~/.local/lib/mcp-deliberation/`
3. Reinstall runtime files: `npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install --force`
4. Restart your MCP client process (Claude/Codex/etc.)
5. Review runtime log: `tail -n 120 ~/.local/lib/mcp-deliberation/runtime.log`

### MCP `Transport closed` in multi-session use

1. Restart the current CLI session first (stdio transport is session-bound).
2. Avoid killing deliberation with `pkill -f mcp-deliberation`; this can terminate other active sessions.
3. Keep one active CLI tab per long-running deliberation workflow when possible.
4. Check runtime log: `tail -n 120 ~/.local/lib/mcp-deliberation/runtime.log`
5. Confirm lock directory exists: `ls ~/.local/lib/mcp-deliberation/state/<project>/.locks`

Multi-session stability in v2.4 uses:
- Session/project lock files (`.locks/`) to serialize writes
- Atomic file writes for session/markdown persistence
- Safe tool handlers + uncaught error logging to keep server process alive

### Browser LLM tabs not detected (Linux/Windows)

Browser tab scan is cross-platform, but Linux/Windows rely on CDP endpoints. Start your browser with a remote debugging port:

Linux/macOS:
```bash
google-chrome --remote-debugging-port=9222
```

Windows (PowerShell):
```powershell
& "$Env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

Then run:
```bash
deliberation_browser_llm_tabs
```

If auto-scan is still unavailable, use the clipboard fallback:
- `deliberation_clipboard_prepare_turn`
- paste into browser LLM and copy response
- `deliberation_clipboard_submit_turn`

### Environment variables not loading

1. Check direnv installation: `command -v direnv`
2. Verify .envrc files: `cat ~/.envrc` and `cat ~/project/.envrc`
3. Allow the directory: `direnv allow`
4. Test: `direnv exec /bin/bash 'echo $VARIABLE_NAME'`

## Development

### Adding new skills

1. Create directory: `skills/my-skill/`
2. Add `SKILL.md` with metadata and implementation
3. Reinstall: `bash install.sh --force`

### Customizing MCP server

Edit `mcp-servers/deliberation/index.js` and reinstall:

```bash
cd ~/.local/lib/mcp-deliberation
npm install
```

### Extending configuration

Add templates to `config/` and update both `install.sh` and `install.ps1` to deploy them.

## Requirements

- **Node.js**: 18+ (for MCP server)
- **npm**: Latest (included with Node.js)
- **Claude Code CLI**: v1.0+ (optional, for full integration)
- **Codex CLI**: Latest (optional, for Codex integration)
- **tmux**: Latest (optional, for deliberation monitoring)
- **direnv**: Latest (optional, for environment management)
- **PowerShell**: 7+ recommended on Windows

Language-specific requirements for the un-bundled skills (only if you install them by hand — see
"Un-bundled skills (written fallback)"):

- **YouTube Analyzer**: Python 3.8+, yt-dlp
- **Clipboard Image**: xclip or pbpaste (platform-dependent)

## Architecture

### Installation Flow

```
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install
  ├─ dispatches to install.sh (macOS/Linux) or install.ps1 (Windows)
  ├─ Check prerequisites (Node.js, npm, optional tools)
  ├─ Install skills to ~/.claude/skills/
  ├─ Install HUD to ~/.claude/hud/
  ├─ Deploy MCP server to ~/.local/lib/mcp-deliberation/
  ├─ Register MCP in ~/.claude/.mcp.json
  ├─ Create config from templates (settings.json, .envrc)
  └─ Integrate with Codex CLI (if available)
```

### Runtime Flow

```
MCP Client Start (Claude/Codex/others)
  ├─ Load plugins from .claude-plugin/
  ├─ Execute SessionStart hooks
  │  └─ Run hooks/session-start (load skill index)
  ├─ Register MCP servers from ~/.claude/.mcp.json
  │  └─ Connect to MCP Deliberation Server
  ├─ Load skills from ~/.claude/skills/
  └─ Ready for interaction
```

### Skill Activation

```
User message with keywords
  ├─ Match against skill trigger patterns
  ├─ Load appropriate skill SKILL.md
  ├─ Execute skill workflow
  └─ Return results
```

## Performance

- Skills load on-demand (no performance impact until triggered)
- MCP server runs in separate process (non-blocking)
- direnv setup is cached after first load
- HUD statusline updates asynchronously

## Compatibility

| Tool | Supported | Tested |
|------|-----------|--------|
| Claude Code | 1.0+ | Yes |
| Codex CLI | Latest | Yes |
| Node.js | 18+ | 20 LTS, 22 |
| macOS | Ventura+ | Yes |
| Linux | Ubuntu 22.04+ | Yes |
| Windows | 10/11 + PowerShell | Yes |

## Contributing

Contributions welcome. Please follow these guidelines:

1. Test skills locally before submitting
2. Update SKILL.md documentation
3. Ensure installer remains idempotent
4. Follow existing code style

## License

MIT License - See LICENSE file for details.

Copyright 2026 dmsdc-ai

## Support

- Report issues: [GitHub Issues](https://github.com/dmsdc-ai/aigentry-devkit/issues)
- Documentation: [GitHub Wiki](https://github.com/dmsdc-ai/aigentry-devkit/wiki)
- Community: [dmsdc-ai Organization](https://github.com/dmsdc-ai)

## Acknowledgments

Built with:
- [Claude Code](https://github.com/anthropic-ai/claude-code) by Anthropic
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) - Multi-agent orchestration framework

## Part of the aigentry platform

aigentry-devkit is one component of the aigentry platform — an open-source engine for making AI decision-making auditable.

{{ecosystem_table}}

---

**aigentry-devkit** - Streamline your AI development workflow.
