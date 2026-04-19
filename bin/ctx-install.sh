#!/usr/bin/env bash
# ctx-install.sh — Install Claude hooks + git templates for context routing
# Spec: docs/superpowers/specs/2026-04-19-context-compact-switching-design.md §7
set -euo pipefail

DEVKIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_HOOKS="${CLAUDE_HOOKS_DIR:-$HOME/.claude/hooks}"
SETTINGS="${CLAUDE_SETTINGS_FILE:-$HOME/.claude/settings.json}"

install_claude_hooks() {
  mkdir -p "$CLAUDE_HOOKS"
  local h src dst
  for h in pre-compact.sh session-start.sh; do
    src="$DEVKIT_ROOT/templates/claude-hooks/$h"
    dst="$CLAUDE_HOOKS/$h"
    if [[ ! -f "$src" ]]; then
      echo "[ctx-install] ERROR: template missing: $src" >&2
      return 1
    fi
    if [[ -f "$dst" ]] && ! cmp -s "$src" "$dst"; then
      echo "[ctx-install] skipping $dst (exists + differs). diff:"
      diff "$dst" "$src" | head -20 || true
      continue
    fi
    cp "$src" "$dst"
    chmod +x "$dst"
    echo "[ctx-install] installed $dst"
  done
}

register_hooks_in_settings() {
  mkdir -p "$(dirname "$SETTINGS")"
  [[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
  # Claude Code does NOT expand $HOME in hook commands — use absolute path
  local pre_path ss_path tmp
  pre_path="$CLAUDE_HOOKS/pre-compact.sh"
  ss_path="$CLAUDE_HOOKS/session-start.sh"
  tmp=$(mktemp)
  jq --arg pre "$pre_path" --arg ss "$ss_path" '
    .hooks.PreCompact = (
      ((.hooks.PreCompact // []) + [{
        matcher: "*",
        hooks: [{type: "command", command: $pre}]
      }])
      | unique_by(.hooks[0].command)
    )
    | .hooks.SessionStart = (
      ((.hooks.SessionStart // []) + [{
        matcher: "compact",
        hooks: [{type: "command", command: $ss}]
      }])
      | unique_by(.hooks[0].command)
    )
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "[ctx-install] registered hooks in $SETTINGS"
}

install_git_template_instructions() {
  cat <<EOF
[ctx-install] Git post-commit template is project-opt-in.
  To enable per-project:
    cp $DEVKIT_ROOT/templates/git-hooks/post-commit .git/hooks/post-commit
    chmod +x .git/hooks/post-commit
EOF
}

main() {
  install_claude_hooks
  register_hooks_in_settings
  install_git_template_instructions
  echo "[ctx-install] DONE. Context routing glue installed."
}

main "$@"
