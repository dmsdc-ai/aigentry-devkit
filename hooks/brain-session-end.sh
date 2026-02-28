#!/bin/bash
# aigentry-devkit hook: session-end → brain_append
# Saves session learnings to brain when Claude Code session ends
# Install: Add to Claude Code settings.json hooks.SessionEnd

# Check if brain is available
BRAIN_CMD=""
if command -v aigentry-brain &>/dev/null; then
  BRAIN_CMD="aigentry-brain"
elif command -v npx &>/dev/null; then
  BRAIN_CMD="npx @dmsdc-ai/aigentry-brain"
else
  exit 0  # Silently skip if brain not installed
fi

PROJECT_DIR="${PWD}"
PROJECT_NAME=$(basename "$PROJECT_DIR")

# The hook receives session summary via stdin from Claude Code
# If stdin is a terminal (no piped input), nothing to save
if [ -t 0 ]; then
  exit 0
fi

SESSION_CONTENT=$(cat)

if [ -z "$SESSION_CONTENT" ]; then
  exit 0
fi

# Save to brain as a session memory
echo "$SESSION_CONTENT" | $BRAIN_CMD brain append \
  --category "session" \
  --source "$PROJECT_NAME" \
  --tags "auto-capture,session-end" \
  2>/dev/null

echo "Brain: session context saved for $PROJECT_NAME"
