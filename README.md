# aigentry-devkit

**Local assets and explicit setup choices for your AI dev environment** — bundles skills, HUD/statusline, runtime source and configuration templates. The current installer enables only consent-bound partial asset copies and preference saving.

Part of the [aigentry platform](https://github.com/dmsdc-ai).

## Quickstart

```bash
aigentry-devkit setup --non-interactive --profile core --runtime defer --install-assets skills,hud --dry-run
```

Review the plan and approve its exact digest to copy the requested assets. Later client sessions may discover copied skills; no MCP/settings activation or full profile installation is performed.

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

D2 supports **partial local assets** on POSIX and the existing configure-only preference flow. Full profile installation, package installs, runtime verification, settings/hooks activation, services, update, replacement, and public replay remain gated. Windows product asset and setup-storage writes remain refused pending native private-storage validation. Direct PowerShell refuses before launching children; the shell host can independently write profiling data. Measured PowerShell 5.1 creates a profile even for an inert refusal, so whole-invocation no-write acceptance remains blocked.

### Preview and consent

With the package already available locally:

```bash
aigentry-devkit setup --non-interactive --profile core --runtime defer --install-assets skills,hud --dry-run
# Review the complete plan, then use its exact current digest:
aigentry-devkit setup --non-interactive --profile core --runtime defer --install-assets skills,hud --accept-plan <SHA256>
```

Choose `skills`, `hud`, or `skills,hud`. Node.js 18+ runs the devkit; the gated telepty policy independently requires Node.js 20+. Every built-in profile still has required components that these copies do not install.

The preview binds the installed package, source files, host/interpreter, selected files, fixed destinations, existing targets, storage and journal history. Changed observations invalidate consent. `--yes`, `--force`, custom manifests, commands and inherited installer flags do not authorize writes. Interactive setup requests the displayed digest; back regenerates the plan, skip leaves without saving, and cancel/EOF refuses.

For a local checkout, `bash install.sh` accepts the same explicit choices and replaces its process with the fixed Node entry. Missing choices refuse before the historical installer body. Interpreter selection is a trusted launch boundary. Native process observation must independently verify the same-PID/no-descendant claim on each supported runner.

### Exact partial effects

- Skills: 38 bundled files per selected client destination. Claude is always selected; other fixed client roots are selected by safe existing directories or executable metadata, with no client execution.
- HUD: one `~/.claude/hud/simple-status.sh` file. Copying does not activate the statusline.
- Existing whole skill directories and existing HUD files are skipped and preserved. Every skip is previewed. An all-skip approval writes no journal.
- New directories are private (0700); skill files are data (0600), and the HUD file is 0700. Existing parents are never chmod-repaired.
- Skills use private sibling staging and refuse observed destination conflicts. Portable check-then-rename is not atomic no-replace and does not protect against a malicious same-UID racer. Failed staging may remain for inspection; there is no automatic rollback.

Clients may discover copied skill instructions in later sessions. No MCP registration, settings, env fan-out, WTM, package manager, version probe, daemon, network or credential action is included.

### Configure-only preferences

```bash
aigentry-devkit setup --non-interactive --profile core --runtime defer --configure-only --dry-run
aigentry-devkit setup --non-interactive --profile core --runtime defer --configure-only --accept-plan <SHA256>
```

This preserves the CommonJS `{contractMajor:1, run(optionArgv, optionalStreams)->Promise<number>}` contract. Streams supply input/output only. A preference is not runtime verification or authentication. `--revisit` displays a saved suggestion and still requires fresh consent.

### Durable receipts and recovery

The shared writer records a durable begin and phase1 begin before asset effects in:

```
${XDG_CONFIG_HOME:-$HOME/.config}/aigentry-devkit/install-journal.json
```

Asset records identify the bounded action set and `partial: true`; completion is not full devkit-core/profile/runtime readiness. Failures report partial/failed results; interruption without a terminal receipt stays running/unknown. Corrupt/unsupported records, unsafe storage and foreign locks refuse without repair or PID probes. Any unresolved legacy phase blocks asset execution, including phase1 effects beyond this asset subset. Configure-only saves preserve that history without resolving it. Public skip/replay/force-unlock is unavailable.

### telepty version compatibility

The unchanged `lib/telepty-version-policy.js` remains the single source of version decisions, using `config/installer-manifest.json`. Its tested pin is `0.8.5`, supported range `>=0.8.5 <0.9.0`, and Node minimum `20.0.0`. The real policy APIs preserve these decisions:

| Observed telepty | Policy decision (not executed by D2) |
|---|---|
| absent | propose the exact pin |
| below minimum | propose an exact-pin upgrade |
| compatible, including newer than the pin | keep, no npm call |
| at/above maximum or unknown | refuse without downgrade |

The bounded policy probe retains its 5-second/1024-byte limits; verification uses the observed version, never the target as an observation. D2 asset installation does not invoke that probe, npm or daemon/health checks.

## Offline / Firewalled Install

Local asset copies make no npm call and need no network once the package is available. External component installation has no fallback chain: it is unavailable. Historical hard/soft failure metadata describes the retained policy/writer APIs, not active install routes. No warning or soft result means an external component was installed.

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

Copied skills may be discovered by later client sessions. MCP servers and settings are not activated by partial asset setup. Existing client configuration is stored in:

- `~/.claude/skills/` - Skill definitions
- `~/.claude/.mcp.json` - MCP server registration
- `~/.claude/settings.json` - Claude Code settings

### Codex CLI Integration

Partial asset setup does not register an MCP deliberation server. The following is a separate manual registration operation:

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
3. Runtime installation/replacement is gated; partial asset setup does not repair an MCP runtime.
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
3. Review an explicit skills preview; existing skill directories are preserved and replacement is unavailable.

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
- **PowerShell**: 7+ recommended on Windows. This recommendation is not a default-host or whole-invocation no-write guarantee.

Language-specific requirements for the un-bundled skills (only if you install them by hand — see
"Un-bundled skills (written fallback)"):

- **YouTube Analyzer**: Python 3.8+, yt-dlp
- **Clipboard Image**: xclip or pbpaste (platform-dependent)

## Architecture

### Installation Flow

```
aigentry-devkit setup / install / implicit setup
  ├─ Enter the shared inert setup module before legacy imports
  ├─ Preview explicit configure-only or partial asset choices
  ├─ Require the current plan digest; revalidate source/storage
  ├─ Record durable partial phase1 before approved local copies
  └─ Report partial completion, failure or unknown; no runtime activation
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
| Windows | 10/11 + PowerShell | Yes; asset writes gated; PowerShell 5.1 whole-invocation no-write acceptance blocked. |

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

| Module | Package | Version | Role | Maturity |
| --- | --- | --- | --- | --- |
| **telepty** | `@dmsdc-ai/aigentry-telepty` | 0.8.5 | Cross-terminal / cross-machine prompt transport (PTY daemon) | Shipping |
| **brain** | `@dmsdc-ai/aigentry-brain` | 0.3.1 | Persistent cross-session memory (MCP server) | Early |
| **deliberation** | `@dmsdc-ai/aigentry-deliberation` | 0.0.47 | Multi-AI structured debate + synthesis (MCP server) | Early |
| **devkit** | `@dmsdc-ai/aigentry-devkit` | 0.2.0 | Installer/scaffold for the AI dev environment | Early |
| **aterm** | `@dmsdc-ai/aterm` | 0.2.14 | Terminal launcher with native session IPC | Early |
| **orchestrator** | *(unpublished)* | — | Control tower that drives sessions via telepty | Internal |

> Licenses: all MIT except `@dmsdc-ai/aterm` (UNLICENSED).

---

**aigentry-devkit** - Streamline your AI development workflow.
