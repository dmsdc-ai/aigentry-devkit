#!/usr/bin/env bash
# open-session.sh — Open a cmux workspace following aigentry session conventions
#
# Two-layer design (Rule 14 generic/multi-cross):
#   Layer 1 (generic): --cwd always works. No project-name assumptions.
#   Layer 2 (optional): --role looks up ~/.aigentry/config.json for user-specific shortcut
#
# Workspace title convention: {track}-{name}  (name = short identifier, e.g. "architect-264")
#
# Usage:
#   open-session.sh --track B --name architect-264 --cwd ~/repos/my-design --cli claude
#   open-session.sh --track A --name bench-250 --cwd /tmp/bench-orch
#
#   # With ~/.aigentry/config.json configured:
#   open-session.sh --track B --role architect --task 264
#   # ↑ looks up config.roles.architect.path → resolves cwd
#
# Output: workspace ref on stdout (e.g., "workspace:37")
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CONFIG_FILE="${AIGENTRY_CONFIG:-$HOME/.aigentry/config.json}"

track=""
name=""
role=""
task=""
cli="claude"
cwd_override=""
extra_flags=""

while [ $# -gt 0 ]; do
  case "$1" in
    --track) track="$2"; shift 2;;
    --name) name="$2"; shift 2;;
    --role) role="$2"; shift 2;;
    --task) task="$2"; shift 2;;
    --cli) cli="$2"; shift 2;;
    --cwd) cwd_override="$2"; shift 2;;
    --extra-flags) extra_flags="$2"; shift 2;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0;;
    *) echo "ERR unknown arg: $1" >&2; exit 1;;
  esac
done

[ -z "$track" ] && { echo "ERR --track required" >&2; exit 1; }

# Resolve name: explicit --name wins, else {role}-{task}, else error
if [ -z "$name" ]; then
  if [ -n "$role" ] && [ -n "$task" ]; then
    name="${role}-${task}"
  else
    echo "ERR need either --name or (--role + --task)" >&2; exit 1
  fi
fi

# Resolve cwd: explicit --cwd wins, else lookup ~/.aigentry/config.json by --role, else error
cwd=""
cli_flags_from_config=""
if [ -n "$cwd_override" ]; then
  cwd="$cwd_override"
elif [ -n "$role" ] && [ -f "$CONFIG_FILE" ]; then
  cwd=$(jq -r --arg r "$role" '.roles[$r].path // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
  cli_flags_from_config=$(jq -r --arg r "$role" '.roles[$r].cli_flags // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
  cli_from_config=$(jq -r --arg r "$role" '.roles[$r].cli // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
  [ -n "$cli_from_config" ] && cli="$cli_from_config"
fi

if [ -z "$cwd" ]; then
  echo "ERR cwd unresolved. Options:" >&2
  echo "  1. Pass --cwd PATH explicitly" >&2
  echo "  2. Configure role in $CONFIG_FILE (see $HOME/projects/aigentry-devkit/docs/session-conventions.md)" >&2
  exit 1
fi

# Homedir shortcut expansion
eval cwd="$cwd"
[ -d "$cwd" ] || mkdir -p "$cwd"

# Trust check warning
trust_status=$(jq -r --arg p "$cwd" '.projects[$p].hasTrustDialogAccepted // false' "$HOME/.claude.json" 2>/dev/null || echo "false")
if [ "$trust_status" != "true" ] && [ "$cli" = "claude" ]; then
  echo "WARN: $cwd not in ~/.claude.json trust list — claude will show trust prompt" >&2
  echo "      run: aigentry-devkit/bin/trust-path.sh $cwd" >&2
fi

title="${track}-${name}"

# CLI flags: config > --extra-flags arg > defaults
if [ -z "$extra_flags" ] && [ -n "$cli_flags_from_config" ]; then
  extra_flags="$cli_flags_from_config"
fi
case "$cli" in
  claude) [ -z "$extra_flags" ] && extra_flags="--permission-mode bypassPermissions";;
esac

# Open workspace — NOTE: --command is unreliable due to shell init prompts (oh-my-zsh etc).
# Two-step: open shell-only, then send command via cmux send after shell ready.
out=$(cmux new-workspace --cwd "$cwd" 2>&1)
ref=$(echo "$out" | grep -oE 'workspace:[0-9]+' | head -1)
[ -z "$ref" ] && { echo "ERR new-workspace failed: $out" >&2; exit 2; }

cmux rename-workspace --workspace "$ref" "$title" >/dev/null 2>&1 || true

# Wait for shell ready (3s is usually enough for zsh + oh-my-zsh)
sleep 3

# Send "N" to decline oh-my-zsh update prompt if any, then boot CLI
cmux send --workspace "$ref" "N" >/dev/null 2>&1 || true
cmux send-key --workspace "$ref" enter >/dev/null 2>&1 || true
sleep 1

# Now send the real command: cd to cwd, exec CLI
boot_cmd="cd '$cwd' && exec $cli $extra_flags"
cmux send --workspace "$ref" "$boot_cmd" >/dev/null
cmux send-key --workspace "$ref" enter >/dev/null

# Log
log_file="$HOME/.aigentry/open-session.log"
mkdir -p "$(dirname "$log_file")"
echo "$(date -u +%FT%TZ) ref=$ref title=$title cwd=$cwd cli=$cli flags=$extra_flags" >> "$log_file"
echo "$ref"
