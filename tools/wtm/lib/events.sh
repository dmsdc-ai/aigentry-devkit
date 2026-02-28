#!/usr/bin/env bash
# events.sh - File-based event bus with plugin hooks
# Part of WTM (WorkTree Manager) cross-dimension library

# Source common utilities if not already loaded
[[ -n "${WTM_HOME}" ]] || WTM_HOME="${HOME}/.wtm"

# Hooks directory: each subdirectory is a named event/hook
WTM_HOOKS="${WTM_HOME}/hooks"

# ---------------------------------------------------------------------------
# emit_event(event_name, [data_json])
# Log event via log_json(), then run all scripts in hooks/{event_name}/
#
# Supported event names:
#   session.created, session.killed, session.cleanup
#   health.check, health.healed
#   sync.push, sync.pull
# ---------------------------------------------------------------------------
emit_event() {
  local event_name="$1"
  local data_json="${2-}"
  : "${data_json:="{}"}"

  # Log to structured log
  log_json "info" "${event_name}" "Event: ${event_name}" "data=${data_json}"

  # Send desktop/webhook notifications for important events
  case "${event_name}" in
    session.created|session.killed|session.cleanup)
      if declare -f send_notification &>/dev/null; then
        send_notification "WTM: ${event_name}" "${data_json}" "normal" 2>/dev/null || true
      fi
      ;;
  esac

  # Run hooks
  run_hooks "${event_name}" "${data_json}"
}

# ---------------------------------------------------------------------------
# run_hooks(hook_name, [context_json])
# Execute all executable scripts in hooks/{hook_name}/ directory,
# passing context_json as $1.
# ---------------------------------------------------------------------------
run_hooks() {
  local hook_name="$1"
  local context="${2-}"
  : "${context:="{}"}"
  local hook_dir="${WTM_HOOKS}/${hook_name}"

  [[ -d "${hook_dir}" ]] || return 0

  for script in "${hook_dir}"/*; do
    [[ -x "${script}" ]] || continue
    "${script}" "${context}" 2>/dev/null || log_warn "Hook failed: ${script}"
  done
}

# ---------------------------------------------------------------------------
# register_hook(hook_name, script_path)
# Symlink script into hooks/{hook_name}/ directory.
# ---------------------------------------------------------------------------
register_hook() {
  local hook_name="$1"
  local script_path="$2"

  if [[ ! -f "${script_path}" ]]; then
    log_error "Script not found: ${script_path}"
    return 1
  fi

  if [[ ! -x "${script_path}" ]]; then
    log_error "Script is not executable: ${script_path}"
    return 1
  fi

  local hook_dir="${WTM_HOOKS}/${hook_name}"
  mkdir -p "${hook_dir}"

  # Use the script's basename for the symlink name
  local link_name="${hook_dir}/$(basename "${script_path}")"

  # Resolve absolute path for symlink target
  local abs_script
  abs_script=$(cd "$(dirname "${script_path}")" && pwd)/$(basename "${script_path}")

  if [[ -L "${link_name}" ]]; then
    log_warn "Hook already registered (replacing): ${link_name}"
    rm -f "${link_name}"
  fi

  ln -s "${abs_script}" "${link_name}"
  log_ok "Hook registered: ${hook_name} -> ${abs_script}"
}

# ---------------------------------------------------------------------------
# list_hooks([hook_name])
# List registered hooks. If hook_name given, list only that event's hooks.
# ---------------------------------------------------------------------------
list_hooks() {
  local hook_name="${1:-}"

  if [[ ! -d "${WTM_HOOKS}" ]]; then
    log_info "No hooks directory found: ${WTM_HOOKS}"
    return 0
  fi

  if [[ -n "${hook_name}" ]]; then
    # List hooks for a specific event
    local hook_dir="${WTM_HOOKS}/${hook_name}"
    if [[ ! -d "${hook_dir}" ]]; then
      log_info "No hooks registered for event: ${hook_name}"
      return 0
    fi
    echo "Hooks for event '${hook_name}':"
    local found=0
    for script in "${hook_dir}"/*; do
      [[ -e "${script}" ]] || continue
      local executable_flag="  "
      [[ -x "${script}" ]] && executable_flag="[x]"
      echo "  ${executable_flag} $(basename "${script}")"
      if [[ -L "${script}" ]]; then
        echo "      -> $(readlink "${script}")"
      fi
      found=1
    done
    [[ "${found}" -eq 0 ]] && echo "  (none)"
  else
    # List all hooks across all events
    echo "Registered hooks (${WTM_HOOKS}):"
    local any_found=0
    for event_dir in "${WTM_HOOKS}"/*/; do
      [[ -d "${event_dir}" ]] || continue
      local event
      event=$(basename "${event_dir}")
      echo ""
      echo "  Event: ${event}"
      local found=0
      for script in "${event_dir}"*; do
        [[ -e "${script}" ]] || continue
        local executable_flag="  "
        [[ -x "${script}" ]] && executable_flag="[x]"
        echo "    ${executable_flag} $(basename "${script}")"
        if [[ -L "${script}" ]]; then
          echo "        -> $(readlink "${script}")"
        fi
        found=1
        any_found=1
      done
      [[ "${found}" -eq 0 ]] && echo "    (none)"
    done
    [[ "${any_found}" -eq 0 ]] && echo "  (no hooks registered)"
  fi
}
