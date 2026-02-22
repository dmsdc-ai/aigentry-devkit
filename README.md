# aigentry-devkit

**Your AI development environment, packaged.**

A comprehensive development kit that bundles skills, hooks, MCP servers, HUD/statusline, and configuration templates for Claude Code, Codex CLI, and other MCP-compatible CLIs. Install once, use everywhere.

## Features

### Skills (Reusable AI Capabilities)

Four production-ready skills that extend Claude Code, Codex CLI, and other MCP-compatible CLIs:

- **Clipboard Image Viewer** - Capture and analyze clipboard images directly from your terminal
- **AI Deliberation** - Multi-session parallel debates across arbitrary CLI participants with structured turn-taking and synthesis
- **Environment Manager** - direnv-based hierarchical environment variable management with global and project-scoped variables
- **YouTube Analyzer** - Extract and analyze YouTube video metadata, captions, and transcripts without downloading

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

- Node.js 18+
- npm (included with Node.js)
- Optional: Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Optional: tmux (for deliberation monitoring)
- Optional: direnv (for environment management)

### Quick Start

```bash
git clone https://github.com/dmsdc-ai/aigentry-devkit.git
cd aigentry-devkit
bash install.sh
```

The installer will:

1. Verify Node.js and optional dependencies (Claude Code CLI, tmux, direnv)
2. Link skills to `~/.claude/skills/`
3. Install HUD statusline to `~/.claude/hud/`
4. Set up MCP Deliberation Server at `~/.local/lib/mcp-deliberation/`
5. Register MCP server in `~/.claude/.mcp.json`
6. Create configuration templates from templates
7. Attempt Codex CLI integration (if available)

### Post-Installation

After installation, restart Claude Code for changes to take effect:

```bash
# Restart Claude Code to load the new skills and MCP servers
```

To verify installation:

```bash
ls -la ~/.claude/skills/      # Check skills are linked
ls -la ~/.claude/hud/         # Check HUD is installed
ls -la ~/.local/lib/mcp-deliberation/  # Check MCP server
cat ~/.claude/.mcp.json       # Verify MCP registration
```

## Usage

### Skills

Skills are automatically available in Claude Code, Codex CLI, and compatible MCP clients. They activate based on keywords:

#### Clipboard Image
Triggers: "clipboard", "paste image", "캡처 확인"

View and analyze images from your clipboard:
```
"Analyze this screenshot: [image in clipboard]"
"What's on my clipboard?"
```

#### AI Deliberation
Triggers: "deliberation", "토론", "debate", "deliberate"

Start a multi-perspective debate:
```
"deliberation: Should we use microservices or monolith?"
"토론 시작: API 설계 전략"
```

Multiple sessions run in parallel. Use `deliberation_start` to get a session ID, then reference it in subsequent calls.

#### Environment Manager
Triggers: "env", "환경변수", "environment", ".env", "direnv"

Manage environment variables hierarchically:
```
"env check" - Audit environment setup
"env init /path/to/project" - Initialize new project
"env add API_KEY value" - Add global or project variable
```

#### YouTube Analyzer
Triggers: "youtube", "유튜브", "영상 분석", "video analysis"

Extract and analyze YouTube content:
```
"Analyze this video: https://youtube.com/watch?v=xxx"
"유튜브 영상 요약: https://youtu.be/xxx"
```

### MCP Deliberation Server

The deliberation server provides these tools:

| Tool | Purpose |
|------|---------|
| `deliberation_speaker_candidates` | List selectable speakers from local CLIs and open browser LLM tabs |
| `deliberation_start` | Start new debate session with user-selected speakers, returns session_id |
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
# Submit turns with deliberate speakers:
# deliberation_respond session_id=sess_12345 speaker=codex
# Browser turn flow:
# deliberation_clipboard_prepare_turn session_id=sess_12345 speaker=web-claude-1
# (paste into browser LLM, copy response)
# deliberation_clipboard_submit_turn session_id=sess_12345 speaker=web-claude-1
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
├── skills/                  # Reusable AI skills
│   ├── clipboard-image/     # Image clipboard capture
│   ├── deliberation/        # Debate management
│   ├── env-manager/         # Environment variables
│   └── youtube-analyzer/    # YouTube content analysis
├── install.sh               # Installation script
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

1. Verify skills are linked: `ls -la ~/.claude/skills/`
2. Restart Claude Code
3. Check for keyword matches in skill definitions

### MCP Deliberation not available

1. Verify MCP registration: `cat ~/.claude/.mcp.json`
2. Check installation: `ls ~/.local/lib/mcp-deliberation/`
3. Restart Claude Code
4. Review MCP server logs in Claude Code console

### MCP `Transport closed` in multi-session use

1. Restart the current CLI session first (stdio transport is session-bound).
2. Avoid killing deliberation with `pkill -f mcp-deliberation`; this can terminate other active sessions.
3. Keep one active CLI tab per long-running deliberation workflow when possible.
4. Check runtime log: `tail -n 120 ~/.local/lib/mcp-deliberation/runtime.log`
5. Confirm lock directory exists: `ls ~/.local/lib/mcp-deliberation/state/<project>/.locks`

Multi-session stability in v2.3 uses:
- Session/project lock files (`.locks/`) to serialize writes
- Atomic file writes for session/markdown persistence
- Safe tool handlers + uncaught error logging to keep server process alive

### Environment variables not loading

1. Check direnv installation: `command -v direnv`
2. Verify .envrc files: `cat ~/.envrc` and `cat ~/project/.envrc`
3. Allow the directory: `direnv allow`
4. Test: `direnv exec /bin/bash 'echo $VARIABLE_NAME'`

### YouTube Analyzer errors

1. Verify Python 3.8+: `python3 --version`
2. Check yt-dlp: `python3 -c "import yt_dlp; print('OK')"`
3. Install if missing: `pip install yt-dlp`

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

Add templates to `config/` and update `install.sh` to deploy them.

## Requirements

- **Node.js**: 18+ (for MCP server)
- **npm**: Latest (included with Node.js)
- **Claude Code CLI**: v1.0+ (optional, for full integration)
- **Codex CLI**: Latest (optional, for Codex integration)
- **tmux**: Latest (optional, for deliberation monitoring)
- **direnv**: Latest (optional, for environment management)

Language-specific requirements for skills:

- **YouTube Analyzer**: Python 3.8+, yt-dlp
- **Clipboard Image**: xclip or pbpaste (platform-dependent)

## Architecture

### Installation Flow

```
bash install.sh
  ├─ Check prerequisites (Node.js, npm, optional tools)
  ├─ Link skills to ~/.claude/skills/
  ├─ Install HUD to ~/.claude/hud/
  ├─ Deploy MCP server to ~/.local/lib/mcp-deliberation/
  ├─ Register MCP in ~/.claude/.mcp.json
  ├─ Create config from templates (settings.json, .envrc)
  └─ Integrate with Codex CLI (if available)
```

### Runtime Flow

```
Claude Code Start
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
| Windows | WSL2 | Partial |

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

---

**aigentry-devkit** - Streamline your AI development workflow.
