#!/bin/bash
# aigentry-devkit hook: session-start → brain_context_resume
# Restores brain memory context when a Claude Code session starts
# Install: Add to Claude Code settings.json hooks.SessionStart

# Check if aigentry-brain is available
BRAIN_CMD=""
if command -v aigentry-brain &>/dev/null; then
  BRAIN_CMD="aigentry-brain"
elif command -v npx &>/dev/null; then
  BRAIN_CMD="npx @dmsdc-ai/aigentry-brain"
else
  exit 0  # Silently skip if brain not installed
fi

# Get project context
PROJECT_DIR="${PWD}"
PROJECT_NAME=$(basename "$PROJECT_DIR")

# Query recent memories relevant to this project
CONTEXT=$($BRAIN_CMD list --source "$PROJECT_NAME" --search "" 2>/dev/null | head -50)

if [ -z "$CONTEXT" ]; then
  exit 0
fi

SUMMARY="Brain context restored for project: $PROJECT_NAME\n\n$CONTEXT"

# Output in Claude Code hook format (matches existing session-start pattern)
ESCAPED=$(printf '%s' "$SUMMARY" | node -e '
  let d=""; process.stdin.on("data",c=>d+=c);
  process.stdin.on("end",()=>console.log(JSON.stringify(d)));
' 2>/dev/null)

if [ -n "$ESCAPED" ]; then
  echo "{\"hookSpecificOutput\":{\"additionalContext\":$ESCAPED}}"
fi
