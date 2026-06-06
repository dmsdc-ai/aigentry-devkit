#!/usr/bin/env bash
# Minimal fake session-reconciler.sh for hermetic devkit tests. No-op: the daemon
# is never actually loaded under AIGENTRY_SKIP_DAEMON=1; this only needs to exist
# so the launchd/systemd template's @REPO_PATH@ resolves to a real file.
set -euo pipefail
case "${1:-}" in
  --loop) echo "[fake-reconciler] --loop (no-op test stub)"; exit 0 ;;
  *)      echo "[fake-reconciler] one-shot (no-op test stub)"; exit 0 ;;
esac
