#!/bin/bash
# Install aigentry brain hooks into Claude Code
# Usage: bash brain-hooks-install.sh

HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "Installing aigentry brain hooks..."
echo "  session-start → brain_context_resume"
echo "  session-end   → brain_append"
echo ""
echo "Hook scripts location: $HOOKS_DIR/"
echo ""
echo "Add the following to your Claude Code settings.json ($SETTINGS_FILE):"
echo ""
cat <<EOF
{
  "hooks": {
    "SessionStart": [{
      "type": "command",
      "command": "bash $HOOKS_DIR/brain-session-start.sh"
    }],
    "SessionEnd": [{
      "type": "command",
      "command": "bash $HOOKS_DIR/brain-session-end.sh"
    }]
  }
}
EOF
echo ""
echo "Done. Run 'aigentry doctor' to verify hook installation."
