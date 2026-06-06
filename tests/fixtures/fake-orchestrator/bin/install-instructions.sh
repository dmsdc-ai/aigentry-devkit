#!/usr/bin/env bash
# Minimal fake orchestrator install-instructions.sh for hermetic devkit tests.
# Mirrors the real script's contract: idempotent, honors $AIGENTRY_HOME, writes
# the instruction tree (roles/orchestrator.md is the doctor's load-bearing file).
set -euo pipefail
PREFIX="${AIGENTRY_HOME:-$HOME/.aigentry}"
ROOT="$PREFIX/instructions"
mkdir -p "$ROOT/roles"
ROLES=(orchestrator architect coder tester builder analyst researcher reviewer logger)
for r in "${ROLES[@]}"; do
  target="$ROOT/roles/$r.md"
  if [ -f "$target" ]; then
    echo "exists file : $target"
  else
    printf '# Role: %s\n\nPlaceholder role contract.\n' "$r" > "$target"
    echo "created file: $target"
  fi
done
echo "instruction tree ready at $ROOT"
