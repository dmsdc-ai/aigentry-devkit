#!/bin/bash
set -euo pipefail

#
# aigentry-devkit installer
#
# Usage:
#   git clone https://github.com/dmsdc-ai/aigentry-devkit.git
#   cd aigentry-devkit && bash install.sh
#

DEVKIT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
MCP_DEST="$HOME/.local/lib/mcp-deliberation"
PLATFORM="$(uname -s 2>/dev/null || echo unknown)"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force|-f)
      FORCE=1
      ;;
  esac
done

# 색상
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
header() { echo -e "\n${BOLD}${CYAN}$1${NC}"; }

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     aigentry-devkit installer          ║"
echo "  ║     AI Development Environment Kit     ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── 사전 요구사항 확인 ──
header "1. Prerequisites"

command -v node >/dev/null 2>&1 || { warn "node not found. Install Node.js 18+"; exit 1; }
command -v npm >/dev/null 2>&1 || { warn "npm not found. Install Node.js 18+"; exit 1; }
info "Node.js $(node -v) found"
info "Platform: $PLATFORM"

case "$PLATFORM" in
  MINGW*|MSYS*|CYGWIN*)
    warn "Windows shell detected. Prefer PowerShell installer: powershell -ExecutionPolicy Bypass -File .\\install.ps1"
    ;;
esac

if command -v tmux >/dev/null 2>&1; then
  info "tmux found (deliberation monitor will use it)"
else
  info "tmux not found. Attempting to install..."
  TMUX_INSTALLED=0
  case "$PLATFORM" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install tmux && TMUX_INSTALLED=1
      else
        warn "Homebrew not found. Install tmux manually: brew install tmux"
      fi
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq && sudo apt-get install -y tmux && TMUX_INSTALLED=1
      elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y tmux && TMUX_INSTALLED=1
      elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y tmux && TMUX_INSTALLED=1
      elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm tmux && TMUX_INSTALLED=1
      else
        warn "No supported package manager found. Install tmux manually."
      fi
      ;;
    *)
      warn "Unsupported platform for auto-install. Install tmux manually."
      ;;
  esac
  if [ "$TMUX_INSTALLED" -eq 1 ]; then
    info "tmux installed successfully"
  else
    warn "tmux installation failed. Deliberation monitor auto-window is disabled."
  fi
fi

if command -v claude >/dev/null 2>&1; then
  info "Claude Code CLI found"
else
  warn "Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code"
fi

# ── Skills 설치 ──
header "2. Skills"

SKILLS_DEST="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_DEST"

for skill_dir in "$DEVKIT_DIR"/skills/*/; do
  skill_name=$(basename "$skill_dir")
  target="$SKILLS_DEST/$skill_name"

  if [ -e "$target" ]; then
    if [ "$FORCE" -eq 1 ]; then
      rm -rf "$target"
    else
      warn "$skill_name already exists (skipping, use --force to overwrite)"
      continue
    fi
  fi

  if [ ! -d "$skill_dir" ]; then
    warn "Skill source missing: $skill_dir"
    continue
  fi

  cp -R "$skill_dir" "$target"
  info "Installed skill: $skill_name"
done

# ── HUD / Statusline ──
header "3. HUD Statusline"

HUD_DEST="$CLAUDE_DIR/hud"
mkdir -p "$HUD_DEST"

if [ ! -f "$HUD_DEST/simple-status.sh" ] || [ "$FORCE" -eq 1 ]; then
  cp "$DEVKIT_DIR/hud/simple-status.sh" "$HUD_DEST/simple-status.sh"
  chmod +x "$HUD_DEST/simple-status.sh"
  info "Installed HUD: simple-status.sh"
else
  warn "HUD already exists (use --force to overwrite)"
fi

# ── MCP Deliberation Server ──
header "4. MCP Deliberation Server"

DELIB_REPO="https://github.com/dmsdc-ai/aigentry-deliberation.git"

if [ "$FORCE" -eq 1 ] && [ -d "$MCP_DEST" ]; then
  rm -rf "$MCP_DEST"
fi

if [ -d "$MCP_DEST" ] && [ -f "$MCP_DEST/index.js" ] && [ "$FORCE" -ne 1 ]; then
  info "MCP deliberation server already installed at $MCP_DEST (use --force to reinstall)"
else
  info "Installing from $DELIB_REPO ..."
  DELIB_TMP=$(mktemp -d)
  if git clone --depth 1 "$DELIB_REPO" "$DELIB_TMP" 2>/dev/null; then
    rm -rf "$MCP_DEST"
    mkdir -p "$MCP_DEST"
    # Copy all files except .git
    rsync -a --exclude='.git' --exclude='node_modules' "$DELIB_TMP/" "$MCP_DEST/"
    rm -rf "$DELIB_TMP"
    chmod +x "$MCP_DEST/session-monitor.sh" 2>/dev/null || true
    info "Installing dependencies..."
    (cd "$MCP_DEST" && npm install --omit=dev)
    info "MCP deliberation server installed at $MCP_DEST"
  else
    rm -rf "$DELIB_TMP"
    warn "Failed to clone $DELIB_REPO. Check network and try again."
    warn "Manual install: git clone $DELIB_REPO $MCP_DEST && cd $MCP_DEST && npm install"
  fi
fi

# ── MCP Server Bundle ──
header "5. MCP Server Bundle"

# context7 (기본 포함)
info "Verifying context7 MCP server (default)..."
if npx -y @upstash/context7-mcp@latest --help >/dev/null 2>&1; then
  info "context7 MCP server available (npx @upstash/context7-mcp)"
else
  warn "context7 MCP server not available. Check npm/npx installation."
fi

# 선택 서버
if [ -t 0 ]; then
  echo ""
  echo -e "  ${BOLD}추가 MCP 서버 설치 (선택):${NC}"
  echo ""
  OPTIONAL_SERVERS="sequential-thinking"
  SELECTED_SERVERS=""
  for srv in $OPTIONAL_SERVERS; do
    case "$srv" in
      sequential-thinking)
        desc="구조화된 사고 프로세스"
        ;;
    esac
    printf "  Enable ${CYAN}%-24s${NC} — %s? [y/N] " "$srv" "$desc"
    read -r answer </dev/tty
    case "$answer" in
      [yY]*) SELECTED_SERVERS="$SELECTED_SERVERS $srv" ;;
    esac
  done
  SELECTED_SERVERS=$(echo "$SELECTED_SERVERS" | xargs)
  if [ -n "$SELECTED_SERVERS" ]; then
    info "Selected optional servers: $SELECTED_SERVERS"
  else
    info "No optional servers selected"
  fi
fi

# ── MCP 등록 ──
header "6. MCP Registration"

MCP_CONFIG="$CLAUDE_DIR/.mcp.json"

if [ -f "$MCP_CONFIG" ]; then
  # deliberation 서버가 이미 등록되어 있는지 확인
  if node -e "const fs=require('fs');let c={};try{c=JSON.parse(fs.readFileSync('$MCP_CONFIG','utf-8'));}catch{}process.exit(c.mcpServers?.deliberation?0:1)" 2>/dev/null; then
    info "Deliberation MCP already registered"
  else
    # 기존 설정에 deliberation 추가
    node -e "
      const fs = require('fs');
      let c = {};
      try {
        c = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
      } catch {
        c = {};
      }
      if (!c.mcpServers) c.mcpServers = {};
      c.mcpServers.deliberation = {
        command: 'node',
        args: ['$MCP_DEST/index.js']
      };
      fs.writeFileSync('$MCP_CONFIG', JSON.stringify(c, null, 2));
    "
    info "Registered deliberation MCP in $MCP_CONFIG"
  fi
else
  # 새로 생성
  cat > "$MCP_CONFIG" << MCPEOF
{
  "mcpServers": {
    "deliberation": {
      "command": "node",
      "args": ["$MCP_DEST/index.js"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    }
  }
}
MCPEOF
  info "Created $MCP_CONFIG with deliberation MCP"
fi

# context7 MCP 등록
if node -e "const fs=require('fs');let c={};try{c=JSON.parse(fs.readFileSync('$MCP_CONFIG','utf-8'));}catch{}process.exit(c.mcpServers?.context7?0:1)" 2>/dev/null; then
  info "context7 MCP already registered"
else
  node -e "
    const fs = require('fs');
    let c = {};
    try {
      c = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
    } catch {
      c = {};
    }
    if (!c.mcpServers) c.mcpServers = {};
    c.mcpServers.context7 = {
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp@latest']
    };
    fs.writeFileSync('$MCP_CONFIG', JSON.stringify(c, null, 2));
  "
  info "Registered context7 MCP in $MCP_CONFIG"
fi

# 선택 서버 MCP 등록
if [ -n "${SELECTED_SERVERS:-}" ]; then
  for srv in $SELECTED_SERVERS; do
    case "$srv" in
      sequential-thinking)
        SRV_CMD="npx"
        SRV_ARGS='["-y","@modelcontextprotocol/server-sequential-thinking"]'
        ;;
    esac
    node -e "
      const fs = require('fs');
      let c = {};
      try {
        c = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
      } catch {
        c = {};
      }
      if (!c.mcpServers) c.mcpServers = {};
      c.mcpServers['$srv'] = {
        command: '$SRV_CMD',
        args: $SRV_ARGS
      };
      fs.writeFileSync('$MCP_CONFIG', JSON.stringify(c, null, 2));
    "
    info "Registered $srv MCP in $MCP_CONFIG"
  done
fi

# Claude Code CLI 등록 (최신 런타임 경로)
if command -v claude >/dev/null 2>&1; then
  if claude mcp add --help 2>/dev/null | grep -q -- '--scope'; then
    claude mcp remove --scope local deliberation >/dev/null 2>&1 || true
    claude mcp remove --scope user deliberation >/dev/null 2>&1 || true
    if claude mcp add --scope user deliberation -- node "$MCP_DEST/index.js" >/dev/null 2>&1; then
      info "Registered deliberation MCP in Claude Code user scope (~/.claude.json)"
    else
      warn "Claude Code MCP registration failed. Run manually: claude mcp add --scope user deliberation -- node $MCP_DEST/index.js"
    fi
    # context7 등록
    claude mcp remove --scope user context7 >/dev/null 2>&1 || true
    if claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest >/dev/null 2>&1; then
      info "Registered context7 MCP in Claude Code user scope"
    fi
  else
    if claude mcp add deliberation -- node "$MCP_DEST/index.js" >/dev/null 2>&1; then
      info "Registered deliberation MCP in Claude Code"
    else
      warn "Claude Code MCP registration failed (legacy CLI)."
    fi
  fi

  if claude mcp list 2>/dev/null | grep -q '^deliberation:'; then
    info "Claude Code MCP verification passed (deliberation found)"
  else
    warn "Claude Code MCP verification failed. Restart Claude and run: claude mcp list"
  fi
else
  warn "Claude CLI not found. Skipping Claude MCP registration."
fi

# ── Config 템플릿 ──
header "7. Config Templates"

# settings.json
SETTINGS_DEST="$CLAUDE_DIR/settings.json"
if [ ! -f "$SETTINGS_DEST" ]; then
  SETTINGS_TEMPLATE="$DEVKIT_DIR/config/settings.json.template"
  if [ -f "$SETTINGS_TEMPLATE" ]; then
    sed "s|{{HOME}}|$HOME|g" "$SETTINGS_TEMPLATE" > "$SETTINGS_DEST"
    info "Created settings.json from template"
  fi
else
  info "settings.json already exists (skipping)"
fi

# envrc
if command -v direnv >/dev/null 2>&1; then
  if [ ! -f "$HOME/.envrc" ]; then
    cp "$DEVKIT_DIR/config/envrc/global.envrc" "$HOME/.envrc"
    info "Installed global .envrc"
  else
    info "Global .envrc already exists (skipping)"
  fi
else
  warn "direnv not found. Skipping .envrc setup."
fi

# ── 참가자 CLI 선택 ──
header "8. Participant CLI Selection"

# Detect available CLIs
AVAILABLE_CLIS=""
for cli in claude codex gemini qwen chatgpt aider llm opencode cursor; do
  if command -v "$cli" >/dev/null 2>&1; then
    AVAILABLE_CLIS="$AVAILABLE_CLIS $cli"
  fi
done
AVAILABLE_CLIS=$(echo "$AVAILABLE_CLIS" | xargs)  # trim

if [ -z "$AVAILABLE_CLIS" ]; then
  warn "No participant CLIs detected. Install claude, codex, gemini, or other AI CLIs."
else
  info "Detected CLIs: $AVAILABLE_CLIS"
  echo ""

  # Interactive selection (skip if --force flag or non-interactive)
  DELIBERATION_CONFIG="$MCP_DEST/config.json"
  if [ -t 0 ] && [ "${FORCE_INSTALL:-}" != "true" ]; then
    echo -e "  ${BOLD}Select CLIs to enable for deliberation:${NC}"
    echo ""

    SELECTED_CLIS=""
    for cli in $AVAILABLE_CLIS; do
      printf "  Enable ${CYAN}%-12s${NC} for deliberation? [Y/n] " "$cli"
      read -r answer </dev/tty
      case "$answer" in
        [nN]*) ;;
        *) SELECTED_CLIS="$SELECTED_CLIS $cli" ;;
      esac
    done
    SELECTED_CLIS=$(echo "$SELECTED_CLIS" | xargs)

    if [ -z "$SELECTED_CLIS" ]; then
      warn "No CLIs selected. All detected CLIs will be available by default."
      SELECTED_CLIS="$AVAILABLE_CLIS"
    fi
  else
    # Non-interactive: enable all detected
    SELECTED_CLIS="$AVAILABLE_CLIS"
  fi

  info "Enabled CLIs: $SELECTED_CLIS"

  # Save config
  node -e "
    const fs = require('fs');
    const configPath = '$DELIBERATION_CONFIG';
    let config = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
    config.enabled_clis = '${SELECTED_CLIS}'.split(/\s+/).filter(Boolean);
    config.updated = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  " && info "Saved CLI config to $DELIBERATION_CONFIG" || warn "Failed to save CLI config"
fi

# Codex MCP registration (only CLI with native MCP support)
if command -v codex >/dev/null 2>&1; then
  codex mcp add deliberation -- node "$MCP_DEST/index.js" 2>/dev/null && \
    info "Registered deliberation MCP in Codex" || \
    warn "Codex MCP registration failed (may already exist)"
  codex mcp add context7 -- npx -y @upstash/context7-mcp@latest 2>/dev/null && \
    info "Registered context7 MCP in Codex" || true

  if codex mcp list 2>/dev/null | grep -q "deliberation"; then
    info "Codex MCP verification passed (deliberation found)"
  else
    warn "Codex MCP verification failed. Run manually: codex mcp add deliberation -- node $MCP_DEST/index.js"
  fi
fi

# ── WTM (WorkTree Manager) ──
header "9. WTM (WorkTree Manager)"

WTM_SRC="$DEVKIT_DIR/tools/wtm"
WTM_DEST="$HOME/.local/lib/wtm"
WTM_BIN="$HOME/.local/bin"

if [ -d "$WTM_SRC/bin" ]; then
  mkdir -p "$WTM_DEST" "$WTM_BIN"

  if [ -d "$WTM_DEST/bin" ] && [ "$FORCE" -ne 1 ]; then
    info "WTM already installed at $WTM_DEST (use --force to reinstall)"
  else
    cp -R "$WTM_SRC/bin" "$WTM_SRC/lib" "$WTM_DEST/" 2>/dev/null || true
    [ -d "$WTM_SRC/plugins" ] && cp -R "$WTM_SRC/plugins" "$WTM_DEST/"
    [ -d "$WTM_SRC/migrations" ] && cp -R "$WTM_SRC/migrations" "$WTM_DEST/"
    [ -d "$WTM_SRC/templates" ] && cp -R "$WTM_SRC/templates" "$WTM_DEST/"
    [ -f "$WTM_SRC/wtm-shell-init.sh" ] && cp "$WTM_SRC/wtm-shell-init.sh" "$WTM_DEST/"

    # Make all bin scripts executable
    chmod +x "$WTM_DEST/bin/"* 2>/dev/null || true

    # Symlink main wtm command to PATH
    ln -sf "$WTM_DEST/bin/wtm" "$WTM_BIN/wtm"
    info "WTM installed at $WTM_DEST"
    info "Symlinked wtm → $WTM_BIN/wtm"

    # Add ~/.local/bin to PATH hint
    if ! echo "$PATH" | tr ':' '\n' | grep -q "$WTM_BIN"; then
      warn "Add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
  fi
else
  warn "WTM source not found in devkit (skipping)"
fi

header "10. Cross-platform Notes"
info "Supported participant CLIs: claude, codex, gemini, qwen, chatgpt, aider, llm, opencode, cursor"
info "Manage enabled CLIs anytime: deliberation_cli_config MCP tool"
info "Browser LLM tab detection: macOS automation + CDP scan (Linux/Windows need browser remote-debugging port)."
info "CDP auto-detect upgrades browser speakers to browser_auto for hands-free operation."

# ── 완료 ──
header "Installation Complete!"
echo ""
echo -e "  ${BOLD}Installed components:${NC}"
echo -e "    Skills:     $(ls -d "$SKILLS_DEST"/*/ 2>/dev/null | wc -l | tr -d ' ') skills in $SKILLS_DEST"
echo -e "    HUD:        $HUD_DEST/simple-status.sh"
echo -e "    MCP Servers: deliberation + context7 (default) + ${SELECTED_SERVERS:-none} (optional)"
echo -e "    WTM:        ${WTM_DEST:-skipped}"
echo -e "    Config:     $CLAUDE_DIR"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    1. Restart CLI processes for MCP changes to take effect"
echo -e "    2. Modify enabled CLIs anytime via deliberation_cli_config MCP tool"
echo -e "    3. Add other MCP servers to $MCP_CONFIG as needed"
echo -e "    4. Configure your HUD in settings.json if not already done"
echo -e "    5. For Linux/Windows browser scan, launch browser with --remote-debugging-port=9222"
echo ""
echo -e "  ${CYAN}Enjoy your AI development environment!${NC}"
