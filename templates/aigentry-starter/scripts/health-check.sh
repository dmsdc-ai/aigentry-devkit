#!/bin/bash
# aigentry ecosystem health check
# Usage: bash scripts/health-check.sh

echo "=== aigentry Health Check ==="
echo ""

check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  ✅ $name"
  else
    echo "  ❌ $name"
  fi
}

check "Node.js 18+"        "node -e 'process.exit(process.versions.node.split(\".\")[0] >= 18 ? 0 : 1)'"
check "aigentry-devkit"     "aigentry-devkit --help"
check "telepty"             "telepty list"
check "deliberation MCP"    "test -f ~/.local/lib/mcp-deliberation/index.js"
check "aigentry-brain"      "aigentry-brain health"
check "dustcraw"            "dustcraw --version"
check "License"             "test -f ~/.aigentry/license.json"

echo ""
echo "Run 'aigentry doctor' for detailed diagnostics."
