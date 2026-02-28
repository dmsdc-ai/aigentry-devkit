# WTM Shell Integration - Source this from .zshrc or .bashrc
# Add to your shell profile: source ~/.wtm/wtm-shell-init.sh
# NOTE: No shebang - this file is meant to be sourced, not executed

# Add WTM bin to PATH (prepend to override system wtm)
export PATH="${HOME}/.wtm/bin:${PATH}"

# WTM session detection for current directory
wtm-detect() {
  if [[ -f ".wtm-session.json" ]]; then
    local session_id
    session_id=$(python3 -c "import json; print(json.load(open('.wtm-session.json')).get('session_id',''))" 2>/dev/null)
    if [[ -n "${session_id}" ]]; then
      echo "[WTM:${session_id}]"
    fi
  fi
}

# WTM pending-cd hook (terminal abstraction layer)
# Checks for pending directory changes from materialize_worktree on Tier 2 terminals
_wtm_pending_cd() {
  local marker="${HOME}/.wtm/pending-cd/${WTM_SESSION_ID:-__none__}"
  if [[ -f "${marker}" ]]; then
    local target
    target=$(cat "${marker}")
    rm -f "${marker}"
    if [[ -d "${target}" ]]; then
      cd "${target}" || return
      echo "[WTM] Switched to worktree: ${target}"
    fi
  fi
}

# Install pending-cd hook into shell prompt cycle
if [[ -n "${ZSH_VERSION:-}" ]]; then
  precmd_functions+=(_wtm_pending_cd)
elif [[ -n "${BASH_VERSION:-}" ]]; then
  PROMPT_COMMAND="_wtm_pending_cd;${PROMPT_COMMAND:-}"
fi

# Optional: Add WTM info to shell prompt
# Uncomment below to show WTM session in your prompt
# PROMPT='$(wtm-detect) '"${PROMPT}"
