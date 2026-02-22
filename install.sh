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
  warn "tmux not found. Deliberation monitor terminals won't auto-open."
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

  if [ -L "$target" ]; then
    rm "$target"
  fi

  if [ -d "$target" ]; then
    warn "$skill_name already exists (skipping, use --force to overwrite)"
    continue
  fi

  ln -s "$skill_dir" "$target"
  info "Linked skill: $skill_name"
done

# ── HUD / Statusline ──
header "3. HUD Statusline"

HUD_DEST="$CLAUDE_DIR/hud"
mkdir -p "$HUD_DEST"

if [ ! -f "$HUD_DEST/simple-status.sh" ] || [ "${1:-}" = "--force" ]; then
  cp "$DEVKIT_DIR/hud/simple-status.sh" "$HUD_DEST/simple-status.sh"
  chmod +x "$HUD_DEST/simple-status.sh"
  info "Installed HUD: simple-status.sh"
else
  warn "HUD already exists (use --force to overwrite)"
fi

# ── MCP Deliberation Server ──
header "4. MCP Deliberation Server"

mkdir -p "$MCP_DEST"
cp "$DEVKIT_DIR/mcp-servers/deliberation/index.js" "$MCP_DEST/"
cp "$DEVKIT_DIR/mcp-servers/deliberation/package.json" "$MCP_DEST/"
cp "$DEVKIT_DIR/mcp-servers/deliberation/session-monitor.sh" "$MCP_DEST/"
chmod +x "$MCP_DEST/session-monitor.sh"

info "Installing dependencies..."
(cd "$MCP_DEST" && npm install --silent 2>/dev/null)
info "MCP deliberation server installed at $MCP_DEST"

# ── MCP 등록 ──
header "5. MCP Registration"

MCP_CONFIG="$CLAUDE_DIR/.mcp.json"

if [ -f "$MCP_CONFIG" ]; then
  # deliberation 서버가 이미 등록되어 있는지 확인
  if node -e "const c=JSON.parse(require('fs').readFileSync('$MCP_CONFIG','utf-8'));process.exit(c.mcpServers?.deliberation?0:1)" 2>/dev/null; then
    info "Deliberation MCP already registered"
  else
    # 기존 설정에 deliberation 추가
    node -e "
      const fs = require('fs');
      const c = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
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
    }
  }
}
MCPEOF
  info "Created $MCP_CONFIG with deliberation MCP"
fi

# ── Config 템플릿 ──
header "6. Config Templates"

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

# ── Codex MCP 등록 (가능하면) ──
header "7. Codex Integration (optional)"

if command -v codex >/dev/null 2>&1; then
  codex mcp add deliberation -- node "$MCP_DEST/index.js" 2>/dev/null && \
    info "Registered deliberation MCP in Codex" || \
    warn "Codex MCP registration failed (may already exist)"

  if codex mcp list 2>/dev/null | grep -q "deliberation"; then
    info "Codex MCP verification passed (deliberation found)"
  else
    warn "Codex MCP verification failed. Run manually: codex mcp add deliberation -- node $MCP_DEST/index.js"
  fi
else
  warn "Codex CLI not found. Skipping Codex integration."
fi

header "8. Cross-platform Notes"
info "Codex is a deliberation participant CLI, not a separate MCP server."
info "Browser LLM tab detection: macOS automation + CDP scan (Linux/Windows need browser remote-debugging port)."
info "If browser tab auto-scan is unavailable, use clipboard workflow: prepare_turn -> paste in browser -> submit_turn."

# ── 완료 ──
header "Installation Complete!"
echo ""
echo -e "  ${BOLD}Installed components:${NC}"
echo -e "    Skills:     $(ls -d "$SKILLS_DEST"/*/ 2>/dev/null | wc -l | tr -d ' ') skills in $SKILLS_DEST"
echo -e "    HUD:        $HUD_DEST/simple-status.sh"
echo -e "    MCP Server: $MCP_DEST"
echo -e "    Config:     $CLAUDE_DIR"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    1. Restart Claude/Codex processes for MCP changes to take effect"
echo -e "    2. Add other MCP servers to $MCP_CONFIG as needed"
echo -e "    3. Configure your HUD in settings.json if not already done"
echo -e "    4. For Linux/Windows browser scan, launch browser with --remote-debugging-port=9222"
echo ""
echo -e "  ${CYAN}Enjoy your AI development environment!${NC}"
