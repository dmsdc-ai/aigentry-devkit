#!/bin/bash
# Start all aigentry sessions defined in sessions.yml
# Usage: bash scripts/start-sessions.sh

echo "Starting aigentry sessions..."

if ! command -v telepty >/dev/null 2>&1; then
  echo "Error: telepty not installed. Run 'aigentry setup' first."
  exit 1
fi

if ! command -v aigentry >/dev/null 2>&1; then
  echo "Error: aigentry-devkit not installed. Run 'npm install -g @dmsdc-ai/aigentry-devkit' first."
  exit 1
fi

# Start telepty daemon
telepty daemon >/dev/null 2>&1 || true

# Start sessions via aigentry
aigentry start

echo ""
echo "Sessions started. Run 'telepty list' to see active sessions."
