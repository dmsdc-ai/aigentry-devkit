#!/bin/bash
# D2 front gate: builtins only, before every historical installer operation.
# Shell startup controlled by the caller is outside this entry boundary.
setup_profile=0 setup_runtime=0 setup_mode=0 setup_value=''
for setup_arg in "$@"; do
  if [[ -n "$setup_value" ]]; then
    [[ -n "$setup_arg" && "$setup_arg" != -* ]] || { printf '%s\n' 'setup: invalid option value' >&2; exit 1; }
    setup_value=''
    continue
  fi
  case "$setup_arg" in
    --help) printf '%s\n' 'setup: explicit --profile ID --runtime defer and --install-assets skills|hud|skills,hud or --configure-only required; use --dry-run to preview'; exit 0 ;;
    --profile) setup_profile=1; setup_value=1 ;;
    --runtime) setup_runtime=1; setup_value=1 ;;
    --install-assets) setup_mode=1; setup_value=1 ;;
    --configure-only) setup_mode=1 ;;
    --accept-plan) setup_value=1 ;;
    --non-interactive|--dry-run|--revisit) ;;
    *) printf '%s\n' 'setup: unsupported option; legacy installation is gated' >&2; exit 1 ;;
  esac
done
if [[ -n "$setup_value" || "$setup_profile$setup_runtime$setup_mode" != 111 ]]; then
  printf '%s\n' 'setup: installation gated; explicit choices and current plan consent required' >&2
  exit 1
fi
unset NODE_OPTIONS NODE_PATH BASH_ENV ENV CDPATH LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH
setup_node=''
setup_search=${PATH-}
while [[ -n "$setup_search" ]]; do
  setup_dir=${setup_search%%:*}
  case "$setup_dir" in
    /*) if [[ -f "$setup_dir/node" && -x "$setup_dir/node" ]]; then setup_node="$setup_dir/node"; break; fi ;;
  esac
  [[ "$setup_search" == *:* ]] || break
  setup_search=${setup_search#*:}
done
[[ -n "$setup_node" ]] || { printf '%s\n' 'setup: trusted Node interpreter unavailable' >&2; exit 1; }
case "${BASH_SOURCE[0]}" in
  */*) builtin cd -P -- "${BASH_SOURCE[0]%/*}" || exit 1 ;;
esac
# Interpreter replacement preserves the shell PID. Native descendant coverage
# is a separate acceptance row; no subprocess is described as read-only.
exec "$setup_node" "$PWD/lib/setup-executor.js" "$@"
exit 1

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
RESUME_RESOLVED_FROM="none"
# Recovery journal state (#1147). SKIP_PHASES is filled by the journal when the
# user explicitly chose to leave an interrupted unknown-effect phase alone.
INSTALL_RUN_ID=""
SKIP_PHASES=""
CURRENT_PHASE=""
PHASE_DEGRADED=""
UNKNOWN_EFFECT_POLICY="${AIGENTRY_INSTALL_UNKNOWN_EFFECT:-refuse}"
FORCE_UNLOCK="${AIGENTRY_INSTALL_FORCE_UNLOCK:-0}"
DEVKIT_STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/aigentry-devkit"
DEVKIT_STATE_FILE="$DEVKIT_STATE_DIR/install-state.json"
DEVKIT_JOURNAL_FILE="$DEVKIT_STATE_DIR/install-journal.json"
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

# manifest_field <dotted.path> — read a value out of the installer manifest as
# DATA: the path is argv and is resolved by walking own properties, never by
# constructing a program (#1147 F5 / CWE-94 — the previous manifest_eval built a
# Function() from its argument, and the resume path interpolated caller input
# into it). Same idiom as adapter_field below. Arrays join on spaces.
manifest_field() {
  node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf-8"));const v=process.argv[2].split(".").reduce((o,k)=>(o==null||typeof o!=="object"||!Object.prototype.hasOwnProperty.call(o,k)?undefined:o[k]),m);if(v==null)process.exit(1);process.stdout.write(Array.isArray(v)?v.join(" "):String(v));' "$MANIFEST_PATH" "$1" 2>/dev/null
}

component_selected() {
  case ",$INSTALL_COMPONENTS," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

should_run_phase() {
  [ "$1" -ge "$START_PHASE" ] || return 1
  # Phases the journal told us to leave alone (AIGENTRY_INSTALL_UNKNOWN_EFFECT=skip).
  case ",$SKIP_PHASES," in
    *",$1,"*) return 1 ;;
  esac
  return 0
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
  # Written through the one shared writer: atomic (tmp + rename) and mode 0600,
  # so an interruption can no longer truncate it and a torn file can no longer
  # read as "nothing installed" (#1147 F7).
  #
  # AIGENTRY_API_KEY is deliberately NOT passed: the writer only ever receives a
  # presence boolean, so the durable record cannot contain the secret even by
  # mistake (#1147 F8/H1). env.sh (chmod 600) stays its only sink.
  env \
    AIGENTRY_ST_PROFILE="$INSTALL_PROFILE" \
    AIGENTRY_ST_MANIFEST="$MANIFEST_PATH" \
    AIGENTRY_ST_COMPONENTS="$INSTALL_COMPONENTS" \
    AIGENTRY_ST_OPTIONAL_COMPONENTS="$OPTIONAL_COMPONENTS" \
    AIGENTRY_ST_JOURNAL_PATH="$DEVKIT_JOURNAL_FILE" \
    AIGENTRY_ST_TELEPTY_VERSION="${TELEPTY_INSTALLED_VERSION:-}" \
    AIGENTRY_ST_TELEPTY_BASE_URL="$TELEPTY_BASE_URL" \
    AIGENTRY_ST_DELIBERATION_RUNTIME_PATH="${DELIBERATION_RUNTIME_PATH:-}" \
    AIGENTRY_ST_DELIBERATION_DOCTOR_OK="${DELIBERATION_DOCTOR_OK:-false}" \
    AIGENTRY_ST_BRAIN_SELECTED="${BRAIN_SELECTED:-false}" \
    AIGENTRY_ST_BRAIN_PACKAGE="${BRAIN_PACKAGE:-}" \
    AIGENTRY_ST_BRAIN_PROFILE_ROOT="${BRAIN_PROFILE_ROOT:-}" \
    AIGENTRY_ST_BRAIN_INSTALL_MODE="${BRAIN_INSTALL_MODE:-}" \
    AIGENTRY_ST_BRAIN_REMOTE_URL="${BRAIN_REMOTE_URL:-}" \
    AIGENTRY_ST_BRAIN_PROJECT_ID="${BRAIN_PROJECT_ID:-}" \
    AIGENTRY_ST_REGISTRY_MODE="${REGISTRY_MODE:-}" \
    AIGENTRY_ST_REGISTRY_API_URL="${REGISTRY_API_URL:-}" \
    AIGENTRY_ST_REGISTRY_API_KEY_PRESENT="$([ -n "${REGISTRY_API_KEY:-}" ] && echo true || echo false)" \
    AIGENTRY_ST_DUSTCRAW_SELECTED="${DUSTCRAW_SELECTED:-false}" \
    AIGENTRY_ST_DUSTCRAW_PACKAGE="${DUSTCRAW_PACKAGE:-}" \
    AIGENTRY_ST_DUSTCRAW_PRESET="${DUSTCRAW_PRESET:-}" \
    AIGENTRY_ST_DUSTCRAW_CONFIG_PATH="${DUSTCRAW_CONFIG_PATH:-}" \
    node "$DEVKIT_DIR/lib/install-state.js" write-state --file "$DEVKIT_STATE_FILE"
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
    RESUME_RESOLVED_FROM="none"
    return
  fi

  if [[ "$RESUME_TARGET" =~ ^[0-9]+$ ]]; then
    START_PHASE="$RESUME_TARGET"
    RESUME_RESOLVED_FROM="numeric"
    return
  fi

  # Named target: looked up as data (own property + integer phase), so an
  # unknown or hostile value can only ever be refused (#1147 F5).
  START_PHASE="$(node "$DEVKIT_DIR/lib/install-state.js" resume-phase --manifest "$MANIFEST_PATH" --component "$RESUME_TARGET")" || \
    die "Unknown resume target: $RESUME_TARGET"
  RESUME_RESOLVED_FROM="component"
}

# ── recovery journal (#1147 F6/F7/F8) ───────────────────────────────────────
# lib/install-state.js is the single writer of the durable, redacted record:
# atomic (tmp + rename), mode 0600, one O_EXCL lock per run. A `running` record
# is made durable BEFORE the first mutation of every phase and a terminal one
# (completed/failed/unknown) after the last, so an interrupted install is
# classifiable instead of looking like a clean absence. The traps below are only
# how the terminal record is reached — the pre-phase record is the contract.
journal() { node "$DEVKIT_DIR/lib/install-state.js" "$@"; }

journal_begin_run() {
  local line status message
  line="$(journal begin-run \
    --dir "$DEVKIT_STATE_DIR" \
    --installer install.sh \
    --profile "$INSTALL_PROFILE" \
    --components "$INSTALL_COMPONENTS" \
    --optional-components "$OPTIONAL_COMPONENTS" \
    --resume-raw "$RESUME_TARGET" \
    --resolved-from "$RESUME_RESOLVED_FROM" \
    --start-phase "$START_PHASE" \
    --unknown-effect "$UNKNOWN_EFFECT_POLICY" \
    --force-unlock "$FORCE_UNLOCK" \
    --registry-api-key-present "$([ -n "$REGISTRY_API_KEY" ] && echo true || echo false)")" || {
      IFS=$'\t' read -r status INSTALL_RUN_ID _ SKIP_PHASES message < <(printf '%s\n' "$line")
      die "${message:-installer recovery journal could not be opened at $DEVKIT_JOURNAL_FILE; nothing was installed}"
    }
  IFS=$'\t' read -r status INSTALL_RUN_ID _ SKIP_PHASES message < <(printf '%s\n' "$line")
  [ "$SKIP_PHASES" = "-" ] && SKIP_PHASES=""
  trap 'journal_on_exit' EXIT
  trap 'journal_on_signal INT 130' INT
  trap 'journal_on_signal TERM 143' TERM
  trap 'journal_on_signal HUP 129' HUP
  info "$message"
}

journal_phase_begin() { # <phase> — durable record BEFORE the first mutation
  CURRENT_PHASE="$1"
  PHASE_DEGRADED=""
  journal phase-begin --dir "$DEVKIT_STATE_DIR" --run "$INSTALL_RUN_ID" --phase "$1" \
    || die "could not record the start of phase $1 in $DEVKIT_JOURNAL_FILE; this phase changed nothing"
}

journal_phase_done() { # <phase> — durable record AFTER the last mutation
  local phase="$1"
  local args=(phase-end --dir "$DEVKIT_STATE_DIR" --run "$INSTALL_RUN_ID" --phase "$phase" --status completed)
  # Soft-policy phases warn and continue; say so instead of claiming a clean run.
  [ -n "$PHASE_DEGRADED" ] && args+=(--degraded 1 --detail "$PHASE_DEGRADED")
  CURRENT_PHASE=""
  PHASE_DEGRADED=""
  journal "${args[@]}" || warn "could not record the completion of phase $phase in $DEVKIT_JOURNAL_FILE"
}

# A soft failure inside a phase: the installer continues by policy, the record
# keeps the reason and marks the phase degraded rather than completed-clean.
phase_degraded() {
  PHASE_DEGRADED="${PHASE_DEGRADED:+$PHASE_DEGRADED; }$1"
  warn "$1"
}

# Owned temporary artifacts only: the credential-bearing dustcraw config THIS
# run created (#1147 F8). Removed on success and failure alike; nothing else is
# ever removed and no file content is inspected to decide.
cleanup_owned_temp() {
  if [ -n "${DUSTCRAW_CONFIG_PATH:-}" ] && [ -f "$DUSTCRAW_CONFIG_PATH" ]; then
    rm -f "$DUSTCRAW_CONFIG_PATH" || warn "could not remove $DUSTCRAW_CONFIG_PATH"
    DUSTCRAW_CONFIG_PATH=""
  fi
}

journal_on_exit() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [ -n "$INSTALL_RUN_ID" ]; then
    if [ -n "$CURRENT_PHASE" ] && [ "$rc" -ne 0 ]; then
      # Observed non-zero return inside the phase (die / set -e): failed.
      journal phase-end --dir "$DEVKIT_STATE_DIR" --run "$INSTALL_RUN_ID" --phase "$CURRENT_PHASE" \
        --status failed --exit-code "$rc" --detail "installer exited with status $rc inside phase $CURRENT_PHASE" >/dev/null 2>&1 || true
    fi
    journal end-run --dir "$DEVKIT_STATE_DIR" --run "$INSTALL_RUN_ID" \
      --outcome "$([ "$rc" -eq 0 ] && echo completed || echo failed)" --exit-code "$rc" >/dev/null 2>&1 || true
  fi
  cleanup_owned_temp
  exit "$rc"
}

journal_on_signal() { # <name> <exit-code>
  local sig="$1" rc="$2"
  trap - EXIT INT TERM HUP
  if [ -n "$INSTALL_RUN_ID" ]; then
    if [ -n "$CURRENT_PHASE" ]; then
      # Interrupted mid-mutation: the effect is genuinely indeterminate, so it
      # is recorded as unknown and will not be blindly replayed.
      journal phase-end --dir "$DEVKIT_STATE_DIR" --run "$INSTALL_RUN_ID" --phase "$CURRENT_PHASE" \
        --status unknown --signal "SIG$sig" --detail "interrupted by SIG$sig inside phase $CURRENT_PHASE; effect is indeterminate" >/dev/null 2>&1 || true
    fi
    journal end-run --dir "$DEVKIT_STATE_DIR" --run "$INSTALL_RUN_ID" --outcome unknown --exit-code "$rc" >/dev/null 2>&1 || true
  fi
  cleanup_owned_temp
  warn "interrupted by SIG$sig — the partial outcome is recorded in $DEVKIT_JOURNAL_FILE"
  exit "$rc"
}

# node reads the manifest and keeps the journal, so it is required before any
# phase runs (npm is checked with the rest of the prerequisites in Phase 0).
command -v node >/dev/null 2>&1 || { warn "node not found. Install Node.js 18+"; exit 1; }

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

# Open the durable record before anything can mutate the machine. A corrupt,
# unsupported, locked or interrupted-unknown journal refuses here, with nothing
# installed and nothing deleted (#1147 F6).
journal_begin_run

# ── 사전 요구사항 확인 ──
header "Phase 0. Prerequisites"
journal_phase_begin 0

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
journal_phase_done 0

SKILLS_DEST="$CLAUDE_DIR/skills"
# Every agent CLI reads skills from its own user dir (#1204). Claude Code's is
# always a destination; another CLI's only when it is on PATH or its config dir
# already exists. agy's global customization root is ~/.gemini/config.
SKILLS_DESTS=("$SKILLS_DEST")
add_skills_dest() { # <cli> <config-dir> <skills-dir>
  if command -v "$1" >/dev/null 2>&1 || [ -d "$2" ]; then SKILLS_DESTS+=("$3"); fi
}
add_skills_dest codex "$HOME/.codex" "$HOME/.codex/skills"
add_skills_dest gemini "$HOME/.gemini" "$HOME/.gemini/skills"
add_skills_dest agy "$HOME/.gemini/config" "$HOME/.gemini/config/skills"
add_skills_dest grok "$HOME/.grok" "$HOME/.grok/skills"
HUD_DEST="$CLAUDE_DIR/hud"
WTM_SRC="$DEVKIT_DIR/tools/wtm"
WTM_DEST="$HOME/.local/lib/wtm"
WTM_BIN="$HOME/.local/bin"

if should_run_phase 1 && component_selected "devkit-core"; then
  header "Phase 1. Devkit Core Assets"
  journal_phase_begin 1

  # Bundled skills (skills/*) + distributable template skills (templates/skills/*)
  # share the same install convention: cp -R into each skills destination,
  # idempotent, honoring --force / skip semantics.
  # De-listed skills (#739 D1/D4): kept in git, never shipped and never installed.
  # Keep in sync with package.json "files" (which omits the same directories).
  SKILLS_DELISTED="project-ops clipboard-image youtube-analyzer"
  for skills_dest in "${SKILLS_DESTS[@]}"; do
    mkdir -p "$skills_dest"
    for skill_dir in "$DEVKIT_DIR"/skills/*/ "$DEVKIT_DIR"/templates/skills/*/; do
      skill_name=$(basename "$skill_dir")
      case " $SKILLS_DELISTED " in
        *" $skill_name "*) continue ;;
      esac
      target="$skills_dest/$skill_name"

      if [ -e "$target" ]; then
        if [ "$FORCE" -eq 1 ]; then
          rm -rf "$target"
        else
          warn "$skill_name already exists in $skills_dest (skipping, use --force to overwrite)"
          continue
        fi
      fi

      if [ ! -d "$skill_dir" ]; then
        warn "Skill source missing: $skill_dir"
        continue
      fi

      cp -R "$skill_dir" "$target"
      info "Installed skill: $skill_name → $skills_dest"
    done
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
  journal_phase_done 1
fi

TELEPTY_INSTALLED_VERSION="" # set only by Phase 2 from a verified observation (#1213)
if should_run_phase 2 && component_selected "telepty"; then
  header "Phase 2. Telepty"
  journal_phase_begin 2

  # #1213: the shared policy (lib/telepty-version-policy.js, also used by
  # install.ps1) decides from a bounded `telepty --version` probe (5s, 1024 bytes,
  # run by the policy itself). npm runs only for an absent or too-old telepty; a
  # newer compatible install is kept, and an incompatible/unidentifiable one is
  # refused untouched. No `latest` fallback.
  telepty_policy() { # <plan|verify> — prints one decision line, exits 1 on refusal
    node "$DEVKIT_DIR/lib/telepty-version-policy.js" \
      --mode "$1" --manifest "$MANIFEST_PATH" --probe bounded < /dev/null
  }
  telepty_policy_read() { # <decision line> — tab-separated, never evaluated
    IFS=$'\t' read -r TELEPTY_ACTION TELEPTY_STATUS TELEPTY_SPEC TELEPTY_OBSERVED TELEPTY_MESSAGE \
      < <(printf '%s\n' "$1") || true
  }

  if TELEPTY_DECISION="$(telepty_policy plan)"; then TELEPTY_RC=0; else TELEPTY_RC=$?; fi
  telepty_policy_read "$TELEPTY_DECISION"
  case "$TELEPTY_RC:$TELEPTY_ACTION" in
    0:keep)
      info "$TELEPTY_MESSAGE"
      ;;
    0:install|0:upgrade)
      info "$TELEPTY_MESSAGE"
      npm install -g "$TELEPTY_SPEC" || die "npm install -g $TELEPTY_SPEC failed; no other telepty version was tried"
      command -v telepty >/dev/null 2>&1 || die "telepty command not found after install"
      if TELEPTY_DECISION="$(telepty_policy verify)"; then TELEPTY_RC=0; else TELEPTY_RC=$?; fi
      telepty_policy_read "$TELEPTY_DECISION"
      [ "$TELEPTY_RC:$TELEPTY_ACTION" = "0:keep" ] || die "${TELEPTY_MESSAGE:-telepty version policy failed after install}"
      info "$TELEPTY_MESSAGE"
      ;;
    *)
      die "${TELEPTY_MESSAGE:-telepty version policy failed (lib/telepty-version-policy.js)}"
      ;;
  esac
  TELEPTY_INSTALLED_VERSION="$TELEPTY_OBSERVED"

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
  journal_phase_done 2
fi

if should_run_phase 3 && component_selected "deliberation"; then
  header "Phase 3. Deliberation"
  journal_phase_begin 3

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
    phase_degraded "deliberation doctor failed"
  fi
  journal_phase_done 3
fi

if should_run_phase 4 && component_selected "brain"; then
  header "Phase 4. Brain"
  journal_phase_begin 4

  BRAIN_SELECTED="true"
  BRAIN_PACKAGE="$(manifest_field "components.brain.install.package")" || BRAIN_PACKAGE="@dmsdc-ai/aigentry-brain"
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
        phase_degraded "aigentry-brain health check failed. Run 'aigentry-brain setup' for manual completion."
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
          " && info "Brain hooks wired into hooks.json" || phase_degraded "Failed to wire brain hooks"
        else
          info "Brain hooks already present in hooks.json"
        fi
      fi
    else
      phase_degraded "aigentry-brain command not found after install"
    fi
  else
    phase_degraded "aigentry-brain install failed"
  fi
  journal_phase_done 4
fi

if should_run_phase 5 && component_selected "dustcraw"; then
  header "Phase 5. Dustcraw"
  journal_phase_begin 5

  DUSTCRAW_SELECTED="true"
  DUSTCRAW_PACKAGE="$(manifest_field "components.dustcraw.install.package")" || DUSTCRAW_PACKAGE="@dmsdc-ai/aigentry-dustcraw"
  DUSTCRAW_VERSION="$(manifest_field "components.dustcraw.install.version")" || DUSTCRAW_VERSION=""
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
      phase_degraded "dustcraw init failed"
    fi
    # The handoff file carries the registry key, so it dies with the handoff —
    # on this path, on the init-failure path and in the traps (#1147 F8). Its
    # path is cleared too, so no stale pointer is recorded in install-state.
    cleanup_owned_temp

    if [ -z "$DUSTCRAW_RUN_DEMO" ]; then
      if is_interactive; then
        prompt_choice DUSTCRAW_RUN_DEMO "Run dustcraw demo now?" "yes" yes no
      else
        DUSTCRAW_RUN_DEMO="yes"
      fi
    fi
    if [ "$(normalize_bool "$DUSTCRAW_RUN_DEMO")" = "true" ]; then
      dustcraw demo --non-interactive || phase_degraded "dustcraw demo failed"
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
    phase_degraded "dustcraw install failed or command not found"
  fi
  journal_phase_done 5
fi

if should_run_phase 6 && component_selected "registry-wiring"; then
  header "Phase 6. Registry Wiring"
  journal_phase_begin 6

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
      phase_degraded "registry wiring smoke test failed"
    fi
  fi
  journal_phase_done 6
fi

if should_run_phase 7; then
  header "Phase 7. Config Fan-Out"
  journal_phase_begin 7
  write_installer_state
  write_env_fanout
  info "Wrote installer state: $DEVKIT_STATE_FILE"
  info "Wrote env fan-out: $DEVKIT_ENV_FILE"
  journal_phase_done 7
fi

# Phase 8 — orchestrator-role (#518). Soft-policy: every step degrades (warn +
# continue) rather than failing the installer, so a core user is never blocked.
# New logic is confined to this one gated block + the config/launchd|systemd
# templates (§1 경량 — no new framework, reuses the existing phase pipeline).
if should_run_phase 8 && component_selected "orchestrator-role"; then
  header "Phase 8. Orchestrator Role"
  journal_phase_begin 8

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
    phase_degraded "orchestrator-role skipped (need git+node+npm)"
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
        phase_degraded "orchestrator clone failed — orchestrator-role degraded (core install unaffected)"
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
        ( cd "$ORCH_DIR" && eval "$build_cmd" ) || phase_degraded "orchestrator built incompletely — continuing best-effort"
      fi

      # 8.4 PATH-link the orchestrator's own real scripts (dispatch.sh,
      # session-reconciler.sh, install-instructions.sh) into the user bin dir.
      mkdir -p "$WTM_BIN"
      for b in $ORCH_BIN_LINK; do
        if [ -e "$ORCH_DIR/bin/$b" ]; then
          ln -sf "$ORCH_DIR/bin/$b" "$WTM_BIN/$b"
          info "Linked $b → $WTM_BIN/$b"
        else
          phase_degraded "orchestrator bin missing: $b (skipped link)"
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
          phase_degraded "devkit bin missing for re-point: $s (left as-is)"
        fi
      done

      # 8.6 Instruction tree — reuse the orchestrator's own idempotent installer
      # (no --force → preserves user edits; honors $AIGENTRY_HOME for tests).
      if [ -f "$ORCH_DIR/bin/install-instructions.sh" ]; then
        AIGENTRY_HOME="${AIGENTRY_HOME:-$HOME/.aigentry}" bash "$ORCH_DIR/bin/install-instructions.sh" \
          || phase_degraded "install-instructions.sh exited non-zero — instruction tree may be incomplete"
      else
        phase_degraded "install-instructions.sh not found in clone — instruction tree skipped"
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
                phase_degraded "launchctl bootstrap failed — load manually: launchctl bootstrap gui/$uid \"$PLIST_DEST\""
              fi
            fi
          else
            phase_degraded "launchd template missing — reconciler daemon not generated"
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
                || phase_degraded "systemctl enable failed — load manually: systemctl --user enable --now aigentry-reconciler.service"
            fi
          else
            phase_degraded "systemd --user not available — reconciler not loaded. Run manually: bash $ORCH_DIR/bin/session-reconciler.sh --loop"
          fi
          ;;
        *)
          phase_degraded "No launchd/systemd on $PLATFORM — run reconciler manually: bash $ORCH_DIR/bin/session-reconciler.sh --loop"
          ;;
      esac

      # 8.8 config.json — GENERATE parameterized role→path map (never copy a
      # reference machine's deviceId/paths); deep-merge add-only.
      ORCH_DEVICE_ID="device-$(hostname 2>/dev/null | tr -c 'A-Za-z0-9.-' '-' | sed 's/-*$//')"
      if node -e 'require(process.argv[1]).writeOrchestratorConfig({projectsRoot:process.argv[2],deviceId:process.argv[3]})' "$DEVKIT_DIR/lib/bootstrap.js" "$PROJECTS_ROOT" "$ORCH_DEVICE_ID"; then
        info "Generated ~/.aigentry/config.json (roles → $PROJECTS_ROOT)"
      else
        phase_degraded "config.json generation failed"
      fi

      # 8.9 Hooks deep-merge into ~/.claude/settings.json (PostToolUse rewritten
      # to the absolute clone path; dedupe → re-runs are no-ops).
      if node -e 'require(process.argv[1]).mergeClaudeHooks({orchDir:process.argv[2]})' "$DEVKIT_DIR/lib/bootstrap.js" "$ORCH_DIR"; then
        info "Merged orchestrator Claude hooks into ~/.claude/settings.json"
      else
        phase_degraded "Claude hooks merge failed"
      fi
    fi
  fi

  # 8.10 State — add the orchestrator-role outcome to the installer-state JSON.
  # Atomic and add-only: a read or write failure is reported instead of being
  # swallowed, and a corrupt state file is preserved rather than reset to {}
  # (#1147 F7). Phase 8 keeps its soft policy, so this warns and continues.
  node "$DEVKIT_DIR/lib/install-state.js" merge-orchestrator \
    --file "$DEVKIT_STATE_FILE" --status "$ORCH_STATUS" --repo-dir "$ORCH_DIR" \
    || phase_degraded "could not record the orchestrator-role outcome in $DEVKIT_STATE_FILE"
  info "orchestrator-role: $ORCH_STATUS"
  journal_phase_done 8
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
for skills_dest in "${SKILLS_DESTS[@]}"; do
  echo -e "    Skills:     $(ls -d "$skills_dest"/*/ 2>/dev/null | wc -l | tr -d ' ') skills in $skills_dest"
done
echo -e "    HUD:        $HUD_DEST/simple-status.sh"
echo -e "    telepty:    ${TELEPTY_INSTALLED_VERSION:-not checked}"
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
