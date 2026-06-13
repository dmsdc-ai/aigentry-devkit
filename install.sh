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
MCP_CONFIG="$CLAUDE_DIR/.mcp.json"
PLATFORM="$(uname -s 2>/dev/null || echo unknown)"
FORCE=0
MANIFEST_PATH="${AIGENTRY_INSTALL_MANIFEST:-$DEVKIT_DIR/config/installer-manifest.json}"
INSTALL_PROFILE="${AIGENTRY_INSTALL_PROFILE:-core}"
INSTALL_COMPONENTS="${AIGENTRY_INSTALL_COMPONENTS:-devkit-core,telepty,deliberation}"
OPTIONAL_COMPONENTS="${AIGENTRY_OPTIONAL_COMPONENTS:-}"
RESUME_TARGET="${AIGENTRY_INSTALL_RESUME:-}"
START_PHASE=0
DEVKIT_STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/aigentry-devkit"
DEVKIT_STATE_FILE="$DEVKIT_STATE_DIR/install-state.json"
DEVKIT_ENV_FILE="$DEVKIT_STATE_DIR/env.sh"
TELEPTY_BASE_URL="${AIGENTRY_TELEPTY_URL:-http://localhost:3848}"
DELIBERATION_RUNTIME_PATH="$MCP_DEST"
BRAIN_PROFILE_ROOT="${AIGENTRY_BRAIN_PROFILE_ROOT:-$HOME/.aigentry}"
BRAIN_INSTALL_MODE="${AIGENTRY_BRAIN_INSTALL_MODE:-local}"
BRAIN_REMOTE_URL="${AIGENTRY_BRAIN_REMOTE_URL:-}"
BRAIN_PROJECT_ID="${AIGENTRY_BRAIN_PROJECT_ID:-}"
BRAIN_SERVICE_URL="${AIGENTRY_BRAIN_URL:-}"
DUSTCRAW_PRESET="${AIGENTRY_DUSTCRAW_PRESET:-}"
DUSTCRAW_RUN_DEMO="${AIGENTRY_DUSTCRAW_RUN_DEMO:-}"
DUSTCRAW_ENABLE_SERVICE="${AIGENTRY_DUSTCRAW_ENABLE_SERVICE:-}"
REGISTRY_MODE="${AIGENTRY_REGISTRY_MODE:-}"
REGISTRY_API_URL="${AIGENTRY_API_URL:-}"
REGISTRY_API_KEY="${AIGENTRY_API_KEY:-}"
REGISTRY_REPO_DIR="${AIGENTRY_REGISTRY_REPO_DIR:-}"
REGISTRY_TENANT_NAME="${AIGENTRY_REGISTRY_TENANT_NAME:-aigentry}"
REGISTRY_TENANT_SLUG="${AIGENTRY_REGISTRY_TENANT_SLUG:-aigentry}"
REGISTRY_API_KEY_NAME="${AIGENTRY_REGISTRY_API_KEY_NAME:-devkit-installer}"

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
die() { echo -e "${YELLOW}[!]${NC} $1"; exit 1; }

manifest_eval() {
  local expr="$1"
  node - "$MANIFEST_PATH" "$expr" <<'NODE'
const fs = require("fs");
const manifestPath = process.argv[2];
const expr = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const value = Function("manifest", `return (${expr});`)(manifest);
if (value === undefined || value === null) {
  process.exit(1);
}
if (typeof value === "object") {
  process.stdout.write(JSON.stringify(value));
} else {
  process.stdout.write(String(value));
}
NODE
}

component_selected() {
  case ",$INSTALL_COMPONENTS," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

should_run_phase() {
  [ "$1" -ge "$START_PHASE" ]
}

is_interactive() {
  [ -t 0 ] && [ -t 1 ]
}

prompt_value() {
  local __name="$1"
  local prompt="$2"
  local default_value="${3:-}"
  local current_value="${!__name:-}"
  local value="$default_value"

  if [ -n "$current_value" ]; then
    return 0
  fi

  if is_interactive; then
    local input=""
    if [ -n "$default_value" ]; then
      printf "%s [%s]: " "$prompt" "$default_value"
    else
      printf "%s: " "$prompt"
    fi
    read -r input </dev/tty || true
    if [ -n "$input" ]; then
      value="$input"
    fi
  fi

  printf -v "$__name" '%s' "$value"
}

prompt_secret() {
  local __name="$1"
  local prompt="$2"
  local current_value="${!__name:-}"
  local value=""

  if [ -n "$current_value" ]; then
    return 0
  fi

  if is_interactive; then
    printf "%s: " "$prompt"
    read -r -s value </dev/tty || true
    printf "\n"
  fi

  printf -v "$__name" '%s' "$value"
}

prompt_choice() {
  local __name="$1"
  local prompt="$2"
  local default_value="$3"
  shift 3
  local current_value="${!__name:-}"
  local value="$default_value"
  local options=("$@")

  if [ -n "$current_value" ]; then
    return 0
  fi

  if is_interactive; then
    echo "$prompt"
    local idx=1
    for option in "${options[@]}"; do
      echo "  $idx) $option"
      idx=$((idx + 1))
    done
    printf "> "
    local input=""
    read -r input </dev/tty || true
    if [[ "$input" =~ ^[0-9]+$ ]] && [ "$input" -ge 1 ] && [ "$input" -le "${#options[@]}" ]; then
      value="${options[$((input - 1))]}"
    elif [ -n "$input" ]; then
      value="$input"
    fi
  fi

  printf -v "$__name" '%s' "$value"
}

normalize_bool() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|y|Y|on|ON) echo "true" ;;
    0|false|FALSE|no|NO|n|N|off|OFF) echo "false" ;;
    *) echo "" ;;
  esac
}

write_installer_state() {
  mkdir -p "$DEVKIT_STATE_DIR"
  env \
    AIGENTRY_INSTALL_PROFILE="$INSTALL_PROFILE" \
    AIGENTRY_INSTALL_MANIFEST="$MANIFEST_PATH" \
    AIGENTRY_INSTALL_COMPONENTS="$INSTALL_COMPONENTS" \
    AIGENTRY_OPTIONAL_COMPONENTS="$OPTIONAL_COMPONENTS" \
    TELEPTY_INSTALLED_VERSION="${TELEPTY_INSTALLED_VERSION:-}" \
    TELEPTY_BASE_URL="$TELEPTY_BASE_URL" \
    DELIBERATION_RUNTIME_PATH="${DELIBERATION_RUNTIME_PATH:-}" \
    DELIBERATION_DOCTOR_OK="${DELIBERATION_DOCTOR_OK:-false}" \
    BRAIN_SELECTED="${BRAIN_SELECTED:-false}" \
    BRAIN_PACKAGE="${BRAIN_PACKAGE:-}" \
    BRAIN_PROFILE_ROOT="${BRAIN_PROFILE_ROOT:-}" \
    BRAIN_INSTALL_MODE="${BRAIN_INSTALL_MODE:-}" \
    BRAIN_REMOTE_URL="${BRAIN_REMOTE_URL:-}" \
    BRAIN_PROJECT_ID="${BRAIN_PROJECT_ID:-}" \
    REGISTRY_MODE="${REGISTRY_MODE:-}" \
    REGISTRY_API_URL="${REGISTRY_API_URL:-}" \
    REGISTRY_API_KEY="${REGISTRY_API_KEY:-}" \
    DUSTCRAW_SELECTED="${DUSTCRAW_SELECTED:-false}" \
    DUSTCRAW_PACKAGE="${DUSTCRAW_PACKAGE:-}" \
    DUSTCRAW_PRESET="${DUSTCRAW_PRESET:-}" \
    DUSTCRAW_CONFIG_PATH="${DUSTCRAW_CONFIG_PATH:-}" \
    node - "$DEVKIT_STATE_FILE" <<'NODE'
const fs = require("fs");
const targetPath = process.argv[2];
const env = process.env;

const omitEmpty = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  return value;
};

const state = {
  generated_at: new Date().toISOString(),
  profile: env.AIGENTRY_INSTALL_PROFILE || "core",
  manifest_path: env.AIGENTRY_INSTALL_MANIFEST || "",
  components: (env.AIGENTRY_INSTALL_COMPONENTS || "").split(",").filter(Boolean),
  optional_components: (env.AIGENTRY_OPTIONAL_COMPONENTS || "").split(",").filter(Boolean),
  telepty: {
    version: omitEmpty(env.TELEPTY_INSTALLED_VERSION || ""),
    base_url: omitEmpty(env.TELEPTY_BASE_URL || "")
  },
  deliberation: {
    runtime_path: omitEmpty(env.DELIBERATION_RUNTIME_PATH || ""),
    doctor_ok: env.DELIBERATION_DOCTOR_OK === "true"
  },
  brain: {
    selected: env.BRAIN_SELECTED === "true",
    package: omitEmpty(env.BRAIN_PACKAGE || ""),
    profile_root: omitEmpty(env.BRAIN_PROFILE_ROOT || ""),
    install_mode: omitEmpty(env.BRAIN_INSTALL_MODE || ""),
    remote_url: omitEmpty(env.BRAIN_REMOTE_URL || ""),
    project_id: omitEmpty(env.BRAIN_PROJECT_ID || "")
  },
  registry: {
    mode: omitEmpty(env.REGISTRY_MODE || ""),
    api_url: omitEmpty(env.REGISTRY_API_URL || ""),
    api_key: omitEmpty(env.REGISTRY_API_KEY || "")
  },
  dustcraw: {
    selected: env.DUSTCRAW_SELECTED === "true",
    package: omitEmpty(env.DUSTCRAW_PACKAGE || ""),
    preset: omitEmpty(env.DUSTCRAW_PRESET || ""),
    config_path: omitEmpty(env.DUSTCRAW_CONFIG_PATH || "")
  }
};

fs.writeFileSync(targetPath, JSON.stringify(state, null, 2));
NODE
}

write_env_fanout() {
  mkdir -p "$DEVKIT_STATE_DIR"
  {
    echo "#!/bin/sh"
    echo "# Generated by aigentry-devkit installer"
    [ -n "$REGISTRY_API_URL" ] && printf "export AIGENTRY_API_URL=%q\n" "$REGISTRY_API_URL"
    [ -n "$REGISTRY_API_KEY" ] && printf "export AIGENTRY_API_KEY=%q\n" "$REGISTRY_API_KEY"
    [ -n "$BRAIN_REMOTE_URL" ] && printf "export BRAIN_REMOTE_URL=%q\n" "$BRAIN_REMOTE_URL"
    [ -n "$BRAIN_PROJECT_ID" ] && printf "export BRAIN_PROJECT_ID=%q\n" "$BRAIN_PROJECT_ID"
  } > "$DEVKIT_ENV_FILE"
  chmod 600 "$DEVKIT_ENV_FILE"
}

resolve_start_phase() {
  if [ -z "$RESUME_TARGET" ]; then
    START_PHASE=0
    return
  fi

  if [[ "$RESUME_TARGET" =~ ^[0-9]+$ ]]; then
    START_PHASE="$RESUME_TARGET"
    return
  fi

  START_PHASE="$(manifest_eval "manifest.components['$RESUME_TARGET'] && manifest.components['$RESUME_TARGET'].phase")" || \
    die "Unknown resume target: $RESUME_TARGET"
}

resolve_start_phase

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     aigentry-devkit installer          ║"
echo "  ║     AI Development Environment Kit     ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"
info "Profile: $INSTALL_PROFILE"
info "Manifest: $MANIFEST_PATH"
info "Components: ${INSTALL_COMPONENTS:-none}"
[ -n "$OPTIONAL_COMPONENTS" ] && info "Optional profile components: $OPTIONAL_COMPONENTS"
[ -n "$RESUME_TARGET" ] && info "Resume target: $RESUME_TARGET (starting at phase $START_PHASE)"

# ── 사전 요구사항 확인 ──
header "Phase 0. Prerequisites"

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

SKILLS_DEST="$CLAUDE_DIR/skills"
HUD_DEST="$CLAUDE_DIR/hud"
WTM_SRC="$DEVKIT_DIR/tools/wtm"
WTM_DEST="$HOME/.local/lib/wtm"
WTM_BIN="$HOME/.local/bin"

if should_run_phase 1 && component_selected "devkit-core"; then
  header "Phase 1. Devkit Core Assets"

  mkdir -p "$SKILLS_DEST"
  # Bundled skills (skills/*) + distributable template skills (templates/skills/*)
  # share the same install convention: cp -R into ~/.claude/skills, idempotent,
  # honoring --force / skip semantics.
  for skill_dir in "$DEVKIT_DIR"/skills/*/ "$DEVKIT_DIR"/templates/skills/*/; do
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

  mkdir -p "$HUD_DEST"
  if [ ! -f "$HUD_DEST/simple-status.sh" ] || [ "$FORCE" -eq 1 ]; then
    cp "$DEVKIT_DIR/hud/simple-status.sh" "$HUD_DEST/simple-status.sh"
    chmod +x "$HUD_DEST/simple-status.sh"
    info "Installed HUD: simple-status.sh"
  else
    warn "HUD already exists (use --force to overwrite)"
  fi

  SETTINGS_DEST="$CLAUDE_DIR/settings.json"
  if [ ! -f "$SETTINGS_DEST" ]; then
    SETTINGS_TEMPLATE="$DEVKIT_DIR/config/settings.json.template"
    if [ -f "$SETTINGS_TEMPLATE" ]; then
      mkdir -p "$CLAUDE_DIR"
      sed "s|{{HOME}}|$HOME|g" "$SETTINGS_TEMPLATE" > "$SETTINGS_DEST"
      info "Created settings.json from template"
    fi
  else
    info "settings.json already exists (skipping)"
  fi

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

      chmod +x "$WTM_DEST/bin/"* 2>/dev/null || true
      ln -sf "$WTM_DEST/bin/wtm" "$WTM_BIN/wtm"
      info "WTM installed at $WTM_DEST"
      info "Symlinked wtm → $WTM_BIN/wtm"

      if ! echo "$PATH" | tr ':' '\n' | grep -q "$WTM_BIN"; then
        warn "Add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
      fi
    fi
  else
    warn "WTM source not found in devkit (skipping)"
  fi
fi

if should_run_phase 2 && component_selected "telepty"; then
  header "Phase 2. Telepty"

  TELEPTY_PACKAGE="$(manifest_eval "manifest.components.telepty.install.package")" || TELEPTY_PACKAGE="@dmsdc-ai/aigentry-telepty"
  TELEPTY_VERSION="$(manifest_eval "manifest.components.telepty.install.version")" || TELEPTY_VERSION="latest"
  TELEPTY_SPEC="${TELEPTY_PACKAGE}@${TELEPTY_VERSION}"

  info "Installing $TELEPTY_SPEC"
  npm install -g "$TELEPTY_SPEC"

  command -v telepty >/dev/null 2>&1 || die "telepty command not found after install"
  TELEPTY_INSTALLED_VERSION="$(telepty --version 2>/dev/null || true)"
  info "telepty version: ${TELEPTY_INSTALLED_VERSION:-unknown}"

  # Semver comparison: warn if installed version is below target
  TELEPTY_TARGET="$(manifest_eval "manifest.compatibility.telepty.target")" || TELEPTY_TARGET=""
  if [ -n "$TELEPTY_TARGET" ] && [ -n "$TELEPTY_INSTALLED_VERSION" ]; then
    version_gte() {
      [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
    }
    # Strip any leading 'v' prefix
    _installed="${TELEPTY_INSTALLED_VERSION#v}"
    _target="${TELEPTY_TARGET#v}"
    if ! version_gte "$_installed" "$_target"; then
      warn "telepty $_installed is below target $_target — consider upgrading"
    else
      info "telepty version $_installed meets target $_target"
    fi
  fi

  telepty daemon >/dev/null 2>&1 || true

  TELEPTY_OK=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf http://localhost:3848/api/meta >/dev/null 2>&1; then
      TELEPTY_OK=1
      break
    fi
    sleep 1
  done

  [ "$TELEPTY_OK" -eq 1 ] || die "telepty daemon health check failed (GET /api/meta)"
  info "telepty daemon is healthy"
fi

if should_run_phase 3 && component_selected "deliberation"; then
  header "Phase 3. Deliberation"

  info "Running canonical deliberation installer"
  if ! npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-install; then
    die "Canonical deliberation installer failed"
  fi

  info "Running deliberation doctor"
  if npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-doctor; then
    DELIBERATION_DOCTOR_OK="true"
    info "deliberation doctor passed"
  else
    DELIBERATION_DOCTOR_OK="false"
    warn "deliberation doctor failed"
  fi
fi

if should_run_phase 4 && component_selected "brain"; then
  header "Phase 4. Brain"

  BRAIN_SELECTED="true"
  BRAIN_PACKAGE="$(manifest_eval "manifest.components.brain.install.package")" || BRAIN_PACKAGE="@dmsdc-ai/aigentry-brain"
  prompt_choice BRAIN_INSTALL_MODE "Choose brain install mode" "${BRAIN_INSTALL_MODE:-local}" local sync
  if [ "$BRAIN_INSTALL_MODE" = "sync" ]; then
    prompt_value BRAIN_REMOTE_URL "Brain remote sync URL (optional)" "${BRAIN_REMOTE_URL:-}"
  fi
  prompt_value BRAIN_PROJECT_ID "Brain project id (optional)" "${BRAIN_PROJECT_ID:-}"

  info "Installing $BRAIN_PACKAGE"
  if npm install -g "$BRAIN_PACKAGE"; then
    if command -v aigentry-brain >/dev/null 2>&1; then
      if aigentry-brain health >/dev/null 2>&1; then
        info "aigentry-brain health check passed"
      else
        warn "aigentry-brain health check failed. Run 'aigentry-brain setup' for manual completion."
      fi

      # Wire brain hooks into devkit hooks.json
      HOOKS_FILE="$DEVKIT_DIR/hooks/hooks.json"
      if [ -f "$HOOKS_FILE" ]; then
        HOOKS_DIR="$DEVKIT_DIR/hooks"
        BRAIN_START_CMD="bash $HOOKS_DIR/brain-session-start.sh"
        BRAIN_END_CMD="bash $HOOKS_DIR/brain-session-end.sh"

        # Check if brain hooks are already present
        if ! grep -q "brain-session-start" "$HOOKS_FILE" 2>/dev/null; then
          info "Wiring brain hooks into $HOOKS_FILE"
          node -e "
            const fs = require('fs');
            const hf = JSON.parse(fs.readFileSync('$HOOKS_FILE', 'utf8'));
            if (!hf.hooks) hf.hooks = {};

            function ensureHook(eventName, matcher, cmd, isAsync) {
              if (!hf.hooks[eventName]) hf.hooks[eventName] = [];
              let group = hf.hooks[eventName].find(g => g.matcher === matcher);
              if (!group) {
                group = { matcher: matcher, hooks: [] };
                hf.hooks[eventName].push(group);
              }
              const exists = group.hooks.some(h => h.command && h.command.includes(cmd));
              if (!exists) {
                group.hooks.push({ type: 'command', command: 'bash $HOOKS_DIR/' + cmd, async: isAsync });
              }
            }

            ensureHook('SessionStart', 'startup|resume|clear|compact', 'brain-session-start.sh', true);
            ensureHook('SessionEnd', '', 'brain-session-end.sh', true);

            fs.writeFileSync('$HOOKS_FILE', JSON.stringify(hf, null, 2) + '\n');
          " && info "Brain hooks wired into hooks.json" || warn "Failed to wire brain hooks"
        else
          info "Brain hooks already present in hooks.json"
        fi
      fi
    else
      warn "aigentry-brain command not found after install"
    fi
  else
    warn "aigentry-brain install failed"
  fi
fi

if should_run_phase 5 && component_selected "dustcraw"; then
  header "Phase 5. Dustcraw"

  DUSTCRAW_SELECTED="true"
  DUSTCRAW_PACKAGE="$(manifest_eval "manifest.components.dustcraw.install.package")" || DUSTCRAW_PACKAGE="@dmsdc-ai/aigentry-dustcraw"
  DUSTCRAW_VERSION="$(manifest_eval "manifest.components.dustcraw.install.version")" || DUSTCRAW_VERSION=""
  if [ -n "$DUSTCRAW_VERSION" ]; then
    DUSTCRAW_SPEC="${DUSTCRAW_PACKAGE}@${DUSTCRAW_VERSION}"
  else
    DUSTCRAW_SPEC="$DUSTCRAW_PACKAGE"
  fi
  prompt_choice DUSTCRAW_PRESET "Choose your interest profile" "${DUSTCRAW_PRESET:-tech-business}" tech-business humanities finance creator custom

  info "Installing $DUSTCRAW_SPEC"
  if npm install -g "$DUSTCRAW_SPEC" && command -v dustcraw >/dev/null 2>&1; then
    DUSTCRAW_CONFIG_PATH="$(mktemp "${TMPDIR:-/tmp}/dustcraw-config.XXXXXX")"
    env \
      REGISTRY_API_URL="${REGISTRY_API_URL:-}" \
      REGISTRY_API_KEY="${REGISTRY_API_KEY:-}" \
      TELEPTY_BASE_URL="${TELEPTY_BASE_URL:-}" \
      BRAIN_SERVICE_URL="${BRAIN_SERVICE_URL:-}" \
      DUSTCRAW_PRESET="${DUSTCRAW_PRESET:-}" \
      node - "$DUSTCRAW_CONFIG_PATH" <<'NODE'
const fs = require("fs");
const targetPath = process.argv[2];
const env = process.env;
const config = {
  strategyPreset: env.DUSTCRAW_PRESET || "tech-business"
};
if (env.REGISTRY_API_URL) config.registryBaseUrl = env.REGISTRY_API_URL;
if (env.REGISTRY_API_KEY) config.registryApiKey = env.REGISTRY_API_KEY;
if (env.TELEPTY_BASE_URL) config.busUrl = env.TELEPTY_BASE_URL;
if (env.BRAIN_SERVICE_URL) config.brainUrl = env.BRAIN_SERVICE_URL;
fs.writeFileSync(targetPath, JSON.stringify(config, null, 2));
NODE

    if dustcraw init --preset "$DUSTCRAW_PRESET" --config "$DUSTCRAW_CONFIG_PATH" --non-interactive; then
      info "dustcraw initialized with preset '$DUSTCRAW_PRESET'"
    else
      warn "dustcraw init failed"
    fi

    if [ -z "$DUSTCRAW_RUN_DEMO" ]; then
      if is_interactive; then
        prompt_choice DUSTCRAW_RUN_DEMO "Run dustcraw demo now?" "yes" yes no
      else
        DUSTCRAW_RUN_DEMO="yes"
      fi
    fi
    if [ "$(normalize_bool "$DUSTCRAW_RUN_DEMO")" = "true" ]; then
      dustcraw demo --non-interactive || warn "dustcraw demo failed"
    fi

    if [ -z "$DUSTCRAW_ENABLE_SERVICE" ]; then
      if is_interactive; then
        prompt_choice DUSTCRAW_ENABLE_SERVICE "Enable dustcraw background service now?" "no" yes no
      else
        DUSTCRAW_ENABLE_SERVICE="no"
      fi
    fi
    if [ "$(normalize_bool "$DUSTCRAW_ENABLE_SERVICE")" = "true" ]; then
      warn "dustcraw service registration surface is not wired yet. Complete it in dustcraw once a stable public command is available."
    fi
  else
    warn "dustcraw install failed or command not found"
  fi
fi

if should_run_phase 6 && component_selected "registry-wiring"; then
  header "Phase 6. Registry Wiring"

  prompt_choice REGISTRY_MODE "Choose registry mode" "${REGISTRY_MODE:-skip}" cloud self_hosted skip

  registry_smoke_test() {
    local base_url="$1"
    local api_key="$2"
    curl -sf "${base_url%/}/health" >/dev/null 2>&1 || return 1
    curl -sf "${base_url%/}/api/experiments/leaderboard?page=1&size=1" \
      -H "X-API-Key: $api_key" >/dev/null 2>&1 || return 1
    return 0
  }

  case "$REGISTRY_MODE" in
    cloud)
      prompt_value REGISTRY_API_URL "Registry base URL" "${REGISTRY_API_URL:-}"
      prompt_secret REGISTRY_API_KEY "Registry API key"
      ;;
    self_hosted)
      prompt_value REGISTRY_API_URL "Registry base URL" "${REGISTRY_API_URL:-}"
      if [ -n "$REGISTRY_REPO_DIR" ] && [ -f "$REGISTRY_REPO_DIR/docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
        info "Starting self-hosted registry from $REGISTRY_REPO_DIR/docker-compose.yml"
        (cd "$REGISTRY_REPO_DIR" && docker compose up -d) || warn "docker compose up failed"

        if [ -n "$REGISTRY_API_URL" ]; then
          for _ in 1 2 3 4 5 6 7 8 9 10; do
            if curl -sf "${REGISTRY_API_URL%/}/health" >/dev/null 2>&1; then
              break
            fi
            sleep 2
          done
        fi

        if [ -z "$REGISTRY_API_KEY" ] && [ -n "$REGISTRY_API_URL" ]; then
          local_bootstrap_payload="$(node -e "console.log(JSON.stringify({tenant_name: process.argv[1], tenant_slug: process.argv[2], api_key_name: process.argv[3]}))" "$REGISTRY_TENANT_NAME" "$REGISTRY_TENANT_SLUG" "$REGISTRY_API_KEY_NAME")"
          bootstrap_response="$(curl -sf -X POST "${REGISTRY_API_URL%/}/api/v1/tenants/bootstrap" \
            -H "Content-Type: application/json" \
            -d "$local_bootstrap_payload" 2>/dev/null || true)"
          if [ -n "$bootstrap_response" ]; then
            REGISTRY_API_KEY="$(printf '%s' "$bootstrap_response" | node -e "const fs=require('fs'); const raw=fs.readFileSync(0,'utf8'); try{const obj=JSON.parse(raw); if(obj.raw_key) process.stdout.write(obj.raw_key);}catch{}")"
          fi
        fi
      else
        warn "Self-hosted auto-bootstrap requires AIGENTRY_REGISTRY_REPO_DIR with docker-compose.yml. Falling back to manual wiring."
      fi
      [ -z "$REGISTRY_API_URL" ] && prompt_value REGISTRY_API_URL "Registry base URL" "${REGISTRY_API_URL:-}"
      [ -z "$REGISTRY_API_KEY" ] && prompt_secret REGISTRY_API_KEY "Registry API key"
      ;;
    *)
      info "Skipping registry wiring"
      ;;
  esac

  if [ "$REGISTRY_MODE" != "skip" ] && [ -n "$REGISTRY_API_URL" ] && [ -n "$REGISTRY_API_KEY" ]; then
    if registry_smoke_test "$REGISTRY_API_URL" "$REGISTRY_API_KEY"; then
      info "registry wiring smoke test passed"
    else
      warn "registry wiring smoke test failed"
    fi
  fi
fi

if should_run_phase 7; then
  header "Phase 7. Config Fan-Out"
  write_installer_state
  write_env_fanout
  info "Wrote installer state: $DEVKIT_STATE_FILE"
  info "Wrote env fan-out: $DEVKIT_ENV_FILE"
fi

# Phase 8 — orchestrator-role (#518). Soft-policy: every step degrades (warn +
# continue) rather than failing the installer, so a core user is never blocked.
# New logic is confined to this one gated block + the config/launchd|systemd
# templates (§1 경량 — no new framework, reuses the existing phase pipeline).
if should_run_phase 8 && component_selected "orchestrator-role"; then
  header "Phase 8. Orchestrator Role"

  ORCH_ADAPTER="$DEVKIT_DIR/config/modules/orchestrator-role.adapter.json"
  ORCH_STATUS="skipped"
  ORCH_DIR=""

  # adapter_field <dotted.path> — read a value from the orchestrator adapter's
  # x-git-install block (data, not hardcoded shell). Arrays join on spaces.
  adapter_field() {
    node -e 'const a=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>(o==null?o:o[k]),a);if(v==null)process.exit(1);process.stdout.write(Array.isArray(v)?v.join(" "):String(v));' "$ORCH_ADAPTER" "$1" 2>/dev/null
  }

  ORCH_REPO="${AIGENTRY_ORCH_REPO:-$(adapter_field 'x-git-install.repo')}"
  # ref pinned to "main" in the adapter for now — switch to a release tag once
  # the orchestrator publishes one (override per-install via AIGENTRY_ORCH_REF).
  ORCH_REF="${AIGENTRY_ORCH_REF:-$(adapter_field 'x-git-install.ref')}"
  ORCH_BUILD_CMD="$(adapter_field 'x-git-install.build')"
  ORCH_BIN_LINK="$(adapter_field 'x-git-install.bin_link')"
  ORCH_REPOINT="$(adapter_field 'x-git-install.self_symlink_repoint')"

  # 8.1 Preflight + resolve PROJECTS_ROOT (discover → prompt → default) and ORCH_DIR.
  PROJECTS_ROOT="${AIGENTRY_PROJECTS_ROOT:-}"
  if [ -z "$PROJECTS_ROOT" ]; then
    if [ -n "${AIGENTRY_ORCH_DIR:-}" ]; then
      PROJECTS_ROOT="$(dirname "$AIGENTRY_ORCH_DIR")"
    elif [ -d "$HOME/projects" ]; then
      PROJECTS_ROOT="$HOME/projects"
    fi
  fi
  prompt_value PROJECTS_ROOT "Projects root (where aigentry-* repos live)" "${PROJECTS_ROOT:-$HOME/projects}"
  ORCH_DIR="${AIGENTRY_ORCH_DIR:-$PROJECTS_ROOT/aigentry-orchestrator}"

  if ! command -v git >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    warn "orchestrator-role skipped (need git+node+npm)"
    ORCH_STATUS="skipped"
  else
    # 8.2 Clone or update (idempotent; dirty tree → keep local).
    if [ -d "$ORCH_DIR/.git" ]; then
      info "Updating orchestrator repo at $ORCH_DIR"
      git -C "$ORCH_DIR" fetch --quiet origin "$ORCH_REF" 2>/dev/null || warn "git fetch failed (offline?) — using local checkout"
      if [ -n "$(git -C "$ORCH_DIR" status --porcelain 2>/dev/null)" ]; then
        warn "orchestrator repo has local changes — skipping pull, keeping local"
      else
        git -C "$ORCH_DIR" checkout --quiet "$ORCH_REF" 2>/dev/null || true
        git -C "$ORCH_DIR" pull --ff-only --quiet 2>/dev/null || warn "git pull --ff-only failed — keeping local"
      fi
      ORCH_STATUS="installed"
    else
      info "Cloning orchestrator repo → $ORCH_DIR"
      mkdir -p "$(dirname "$ORCH_DIR")"
      if git clone --branch "$ORCH_REF" --depth 1 "$ORCH_REPO" "$ORCH_DIR" 2>/dev/null \
        || git clone "$ORCH_REPO" "$ORCH_DIR" 2>/dev/null; then
        ORCH_STATUS="installed"
      else
        warn "orchestrator clone failed — orchestrator-role degraded (core install unaffected)"
        ORCH_STATUS="degraded"
      fi
    fi

    if [ "$ORCH_STATUS" = "installed" ] && [ -d "$ORCH_DIR" ]; then
      # 8.3 Build (registry deps resolve post-#520). AIGENTRY_ORCH_BUILD=true
      # bypasses the real build for CI/hermetic tests.
      if [ "${AIGENTRY_ORCH_BUILD:-}" = "true" ]; then
        info "AIGENTRY_ORCH_BUILD=true → skipping real build (CI/test)"
      else
        build_cmd="$ORCH_BUILD_CMD"
        [ -f "$ORCH_DIR/package-lock.json" ] || build_cmd="${build_cmd/npm ci/npm install}"
        info "Building orchestrator: $build_cmd"
        ( cd "$ORCH_DIR" && eval "$build_cmd" ) || warn "orchestrator built incompletely — continuing best-effort"
      fi

      # 8.4 PATH-link the orchestrator's own real scripts (dispatch.sh,
      # session-reconciler.sh, install-instructions.sh) into the user bin dir.
      mkdir -p "$WTM_BIN"
      for b in $ORCH_BIN_LINK; do
        if [ -e "$ORCH_DIR/bin/$b" ]; then
          ln -sf "$ORCH_DIR/bin/$b" "$WTM_BIN/$b"
          info "Linked $b → $WTM_BIN/$b"
        else
          warn "orchestrator bin missing: $b (skipped link)"
        fi
      done
      if ! echo "$PATH" | tr ':' '\n' | grep -q "$WTM_BIN"; then
        warn "Add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
      fi

      # 8.5 Re-point the orchestrator's self-symlinks. In the orchestrator repo
      # these (tq-*.sh, trust-*.sh) are committed as symlinks to an absolute
      # reference-machine devkit path → DANGLING on a fresh clone. Re-point them to
      # THIS installed devkit's bin/. The targets are shipped in the published
      # tarball via package.json files[] (§8.5 resolution: option a).
      # #613 A2: open-session.sh is NO LONGER repointed — it is now an orchestrator
      # real file (owns its runtime spawn entrypoint + adapter libs). #614: tq-*.sh
      # and trust-*.sh likewise own themselves as orchestrator real files. All five
      # were removed from self_symlink_repoint in orchestrator-role.adapter.json, so
      # this loop is now a no-op until a future self-symlink is declared (forward-compat).
      for s in $ORCH_REPOINT; do
        if [ -e "$DEVKIT_DIR/bin/$s" ]; then
          ln -sfn "$DEVKIT_DIR/bin/$s" "$ORCH_DIR/bin/$s"
        else
          warn "devkit bin missing for re-point: $s (left as-is)"
        fi
      done

      # 8.6 Instruction tree — reuse the orchestrator's own idempotent installer
      # (no --force → preserves user edits; honors $AIGENTRY_HOME for tests).
      if [ -f "$ORCH_DIR/bin/install-instructions.sh" ]; then
        AIGENTRY_HOME="${AIGENTRY_HOME:-$HOME/.aigentry}" bash "$ORCH_DIR/bin/install-instructions.sh" \
          || warn "install-instructions.sh exited non-zero — instruction tree may be incomplete"
      else
        warn "install-instructions.sh not found in clone — instruction tree skipped"
      fi

      # 8.7 Reconciler daemon — GENERATE from template (never copy); load
      # idempotently. Non-macOS/non-systemd or AIGENTRY_SKIP_DAEMON=1 → print
      # manual instructions and continue (soft).
      NODE_BIN_DIR="$(dirname "$(command -v node)")"
      case "$PLATFORM" in
        Darwin) LOG_PATH="$HOME/Library/Logs/aigentry-orchestrator/reconciler.log" ;;
        *)      LOG_PATH="${XDG_STATE_HOME:-$HOME/.local/state}/aigentry/reconciler.log" ;;
      esac
      mkdir -p "$(dirname "$LOG_PATH")"
      RECONCILER_SKIP_LOAD="${AIGENTRY_SKIP_DAEMON:-0}"

      case "$PLATFORM" in
        Darwin)
          PLIST_TMPL="$DEVKIT_DIR/config/launchd/com.aigentry.reconciler.plist.template"
          PLIST_DEST="$HOME/Library/LaunchAgents/com.aigentry.reconciler.plist"
          if [ -f "$PLIST_TMPL" ]; then
            mkdir -p "$HOME/Library/LaunchAgents"
            sed -e "s|@REPO_PATH@|$ORCH_DIR|g" -e "s|@LOG_PATH@|$LOG_PATH|g" -e "s|@NODE_BIN_DIR@|$NODE_BIN_DIR|g" "$PLIST_TMPL" > "$PLIST_DEST"
            info "Generated launchd unit: $PLIST_DEST"
            if [ "$RECONCILER_SKIP_LOAD" = "1" ]; then
              info "AIGENTRY_SKIP_DAEMON=1 → not loading. Load manually: launchctl bootstrap gui/$(id -u) \"$PLIST_DEST\""
            else
              uid="$(id -u)"
              launchctl bootout "gui/$uid" "$PLIST_DEST" 2>/dev/null || true
              if launchctl bootstrap "gui/$uid" "$PLIST_DEST" 2>/dev/null; then
                launchctl enable "gui/$uid/com.aigentry.reconciler" 2>/dev/null || true
                info "Loaded reconciler daemon (launchd, KeepAlive)"
              else
                warn "launchctl bootstrap failed — load manually: launchctl bootstrap gui/$uid \"$PLIST_DEST\""
              fi
            fi
          else
            warn "launchd template missing — reconciler daemon not generated"
          fi
          ;;
        Linux)
          SVC_TMPL="$DEVKIT_DIR/config/systemd/aigentry-reconciler.service.template"
          SVC_DEST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/aigentry-reconciler.service"
          if [ -f "$SVC_TMPL" ] && command -v systemctl >/dev/null 2>&1; then
            mkdir -p "$(dirname "$SVC_DEST")"
            sed -e "s|@REPO_PATH@|$ORCH_DIR|g" -e "s|@LOG_PATH@|$LOG_PATH|g" -e "s|@NODE_BIN_DIR@|$NODE_BIN_DIR|g" "$SVC_TMPL" > "$SVC_DEST"
            info "Generated systemd unit: $SVC_DEST"
            if [ "$RECONCILER_SKIP_LOAD" = "1" ]; then
              info "AIGENTRY_SKIP_DAEMON=1 → not loading. Load manually: systemctl --user enable --now aigentry-reconciler.service"
            else
              systemctl --user daemon-reload 2>/dev/null || true
              systemctl --user enable --now aigentry-reconciler.service 2>/dev/null \
                || warn "systemctl enable failed — load manually: systemctl --user enable --now aigentry-reconciler.service"
            fi
          else
            warn "systemd --user not available — reconciler not loaded. Run manually: bash $ORCH_DIR/bin/session-reconciler.sh --loop"
          fi
          ;;
        *)
          warn "No launchd/systemd on $PLATFORM — run reconciler manually: bash $ORCH_DIR/bin/session-reconciler.sh --loop"
          ;;
      esac

      # 8.8 config.json — GENERATE parameterized role→path map (never copy a
      # reference machine's deviceId/paths); deep-merge add-only.
      ORCH_DEVICE_ID="device-$(hostname 2>/dev/null | tr -c 'A-Za-z0-9.-' '-' | sed 's/-*$//')"
      if node -e 'require(process.argv[1]).writeOrchestratorConfig({projectsRoot:process.argv[2],deviceId:process.argv[3]})' "$DEVKIT_DIR/lib/bootstrap.js" "$PROJECTS_ROOT" "$ORCH_DEVICE_ID"; then
        info "Generated ~/.aigentry/config.json (roles → $PROJECTS_ROOT)"
      else
        warn "config.json generation failed"
      fi

      # 8.9 Hooks deep-merge into ~/.claude/settings.json (PostToolUse rewritten
      # to the absolute clone path; dedupe → re-runs are no-ops).
      if node -e 'require(process.argv[1]).mergeClaudeHooks({orchDir:process.argv[2]})' "$DEVKIT_DIR/lib/bootstrap.js" "$ORCH_DIR"; then
        info "Merged orchestrator Claude hooks into ~/.claude/settings.json"
      else
        warn "Claude hooks merge failed"
      fi
    fi
  fi

  # 8.10 State — append orchestrator-role outcome to the installer-state JSON.
  node -e 'const fs=require("fs");const p=process.argv[1];let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch(_){};s.orchestrator={status:process.argv[2]||"skipped",repo_dir:process.argv[3]||""};fs.mkdirSync(require("path").dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(s,null,2));' "$DEVKIT_STATE_FILE" "$ORCH_STATUS" "$ORCH_DIR" 2>/dev/null || true
  info "orchestrator-role: $ORCH_STATUS"
fi

header "Cross-platform Notes"
info "Supported participant CLIs: claude, codex, gemini, qwen, chatgpt, aider, llm, opencode, cursor"
info "Manage deliberation runtime with the canonical installer surface from aigentry-deliberation."
info "Registry env fan-out is stored in $DEVKIT_ENV_FILE"
info "Browser/provider auth may still require CLI restart or manual login."

# ── 완료 ──
header "Installation Complete!"
echo ""
echo -e "  ${BOLD}Installed components:${NC}"
echo -e "    Skills:     $(ls -d "$SKILLS_DEST"/*/ 2>/dev/null | wc -l | tr -d ' ') skills in $SKILLS_DEST"
echo -e "    HUD:        $HUD_DEST/simple-status.sh"
echo -e "    telepty:    $(command -v telepty >/dev/null 2>&1 && telepty --version 2>/dev/null || echo not-installed)"
echo -e "    deliberation: $( [ "${DELIBERATION_DOCTOR_OK:-false}" = "true" ] && echo healthy || echo not-run )"
echo -e "    brain:      $( [ "${BRAIN_SELECTED:-false}" = "true" ] && echo selected || echo skipped )"
echo -e "    dustcraw:   $( [ "${DUSTCRAW_SELECTED:-false}" = "true" ] && echo selected || echo skipped )"
echo -e "    registry:   ${REGISTRY_MODE:-skip}"
echo -e "    WTM:        ${WTM_DEST:-skipped}"
echo -e "    Config:     $CLAUDE_DIR"
echo -e "    State:      $DEVKIT_STATE_FILE"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    1. Restart CLI processes for MCP changes to take effect"
echo -e "    2. Source $DEVKIT_ENV_FILE if you want registry env in new shells"
echo -e "    3. Run 'aigentry-brain setup' if you want full interactive brain bootstrap"
echo -e "    4. Configure your HUD in settings.json if not already done"
echo ""
echo -e "  ${CYAN}Enjoy your AI development environment!${NC}"
