#!/usr/bin/env bash
# Migrate Pacc chain state: <state_root>/<run>/Pacc/<fixture>/chain_sess<S>.json
#                          → <state_root>/<run>/Pacc/chain_sess<S>.json
#
# Why: spec §4.4 requires one chain per Pacc session spanning all 10 fixtures
# visited in random order. The old path split chains per fixture, so pos>1
# could not resolve pos=1's session_id (refs #329 full-pilot-fix2).
#
# Idempotent: safe to re-run. Skips moves when the destination already exists
# (to avoid clobbering a merged session). Preserves the original file on skip.
#
# Usage:
#   tools/migrate-pacc-chain-state.sh [<state_root>]
#
# If <state_root> is omitted, defaults to ./state (repo-relative).

set -euo pipefail

STATE_ROOT="${1:-${EXECMODE_STATE_ROOT:-./state}}"

if [[ ! -d "$STATE_ROOT" ]]; then
  echo "migrate-pacc-chain-state: state root not found: $STATE_ROOT" >&2
  exit 0
fi

moved=0
skipped=0
missing=0

while IFS= read -r -d '' src; do
  # src: .../<run>/Pacc/<fixture>/chain_sess<S>.json
  pacc_dir="$(dirname "$(dirname "$src")")"     # .../<run>/Pacc
  base="$(basename "$src")"                      # chain_sess<S>.json
  dst="$pacc_dir/$base"

  if [[ "$src" == "$dst" ]]; then
    continue
  fi

  if [[ -f "$dst" ]]; then
    echo "SKIP: dst already exists (manual merge needed): $dst" >&2
    skipped=$((skipped + 1))
    continue
  fi

  mv "$src" "$dst"
  echo "MOVED: $src → $dst"
  moved=$((moved + 1))

  # Clean up empty fixture dir.
  fix_dir="$(dirname "$src")"
  if [[ -d "$fix_dir" ]] && [[ -z "$(ls -A "$fix_dir")" ]]; then
    rmdir "$fix_dir"
  fi
done < <(find "$STATE_ROOT" -type f -path '*/Pacc/*/chain_sess*.json' -print0 2>/dev/null)

if (( moved == 0 && skipped == 0 )); then
  missing=1
fi

echo "migrate-pacc-chain-state: moved=$moved skipped=$skipped$([ $missing -eq 1 ] && echo ' (no legacy files found)')"
