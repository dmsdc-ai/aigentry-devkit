#!/bin/bash
# Install aigentry brain hooks into devkit hooks.json
# Usage: bash brain-hooks-install.sh [--dry-run]

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_FILE="$HOOKS_DIR/hooks.json"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
  esac
done

if [ ! -f "$HOOKS_FILE" ]; then
  echo "Error: hooks.json not found at $HOOKS_FILE"
  exit 1
fi

BRAIN_START_CMD="bash $HOOKS_DIR/brain-session-start.sh"
BRAIN_END_CMD="bash $HOOKS_DIR/brain-session-end.sh"

# Check if already installed
if grep -q "brain-session-start" "$HOOKS_FILE" 2>/dev/null; then
  echo "Brain hooks already installed in hooks.json"
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] Would add brain hooks to $HOOKS_FILE:"
  echo "  SessionStart: $BRAIN_START_CMD"
  echo "  SessionEnd:   $BRAIN_END_CMD"
  exit 0
fi

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
" && echo "Brain hooks installed successfully." || { echo "Failed to install brain hooks."; exit 1; }
