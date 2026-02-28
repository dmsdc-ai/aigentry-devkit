#!/usr/bin/env bash
# plugin.sh - Plugin directory structure and lifecycle management
# Part of WTM (WorkTree Manager)

[[ -n "${WTM_HOME}" ]] || WTM_HOME="${HOME}/.wtm"

WTM_PLUGINS="${WTM_PLUGINS:-${WTM_HOME}/plugins}"

# ---------------------------------------------------------------------------
# _plugin_json_field(plugin_name, field)
# Extract a top-level string field from a plugin's plugin.json
# ---------------------------------------------------------------------------
_plugin_json_field() {
  local plugin_name="$1"
  local field="$2"
  local plugin_json="${WTM_PLUGINS}/${plugin_name}/plugin.json"
  [[ -f "${plugin_json}" ]] || return 1
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(d.get(sys.argv[2], ''))
" "${plugin_json}" "${field}"
}

# ---------------------------------------------------------------------------
# install_plugin(plugin_path)
# Install a plugin from a directory path. Registers hooks and symlinks commands.
# ---------------------------------------------------------------------------
install_plugin() {
  local plugin_path="$1"

  if [[ ! -d "${plugin_path}" ]]; then
    log_error "Plugin path does not exist: ${plugin_path}"
    return 1
  fi

  local plugin_json="${plugin_path}/plugin.json"
  if [[ ! -f "${plugin_json}" ]]; then
    log_error "No plugin.json found in: ${plugin_path}"
    return 1
  fi

  local plugin_name
  plugin_name=$(python3 -c "import json; print(json.load(open('${plugin_json}')).get('name',''))" 2>/dev/null)
  if [[ -z "${plugin_name}" ]]; then
    log_error "plugin.json missing 'name' field: ${plugin_json}"
    return 1
  fi

  local plugin_version
  plugin_version=$(python3 -c "import json; print(json.load(open('${plugin_json}')).get('version','unknown'))" 2>/dev/null)

  # Copy/link plugin directory into WTM_PLUGINS if not already there
  local dest="${WTM_PLUGINS}/${plugin_name}"
  if [[ "$(realpath "${plugin_path}" 2>/dev/null)" != "$(realpath "${dest}" 2>/dev/null)" ]]; then
    mkdir -p "${WTM_PLUGINS}"
    if [[ -d "${dest}" ]]; then
      log_warn "Plugin '${plugin_name}' already installed at ${dest}, reinstalling"
      rm -rf "${dest}"
    fi
    cp -r "${plugin_path}" "${dest}"
  fi

  # Register hooks from plugin.json hooks map
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
hooks = d.get('hooks', {})
for event, script_rel in hooks.items():
    print(f'{event}|{script_rel}')
" "${dest}/plugin.json" | while IFS='|' read -r event_name script_rel; do
    local script_abs="${dest}/${script_rel}"
    if [[ -f "${script_abs}" ]] && [[ -x "${script_abs}" ]]; then
      register_hook "${event_name}" "${script_abs}"
    else
      log_warn "Hook script not found or not executable, skipping: ${script_abs}"
    fi
  done

  # Symlink commands into WTM bin
  local cmds_dir="${dest}/commands"
  if [[ -d "${cmds_dir}" ]]; then
    local bin_dir="${WTM_HOME}/bin"
    mkdir -p "${bin_dir}"
    for cmd_script in "${cmds_dir}"/*; do
      [[ -f "${cmd_script}" ]] && [[ -x "${cmd_script}" ]] || continue
      local cmd_name
      cmd_name=$(basename "${cmd_script}")
      local link="${bin_dir}/wtm-plugin-${cmd_name}"
      ln -sf "${cmd_script}" "${link}"
      log_info "Command symlinked: ${link}"
    done
  fi

  log_ok "Plugin installed: ${plugin_name} v${plugin_version}"
}

# ---------------------------------------------------------------------------
# remove_plugin(plugin_name)
# Uninstall a plugin: remove hooks symlinks and command symlinks.
# ---------------------------------------------------------------------------
remove_plugin() {
  local plugin_name="$1"
  local dest="${WTM_PLUGINS}/${plugin_name}"

  if [[ ! -d "${dest}" ]]; then
    log_error "Plugin not installed: ${plugin_name}"
    return 1
  fi

  local plugin_json="${dest}/plugin.json"

  # Remove registered hook symlinks
  if [[ -f "${plugin_json}" ]]; then
    python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
hooks = d.get('hooks', {})
for event, script_rel in hooks.items():
    print(f'{event}|{script_rel}')
" "${plugin_json}" | while IFS='|' read -r event_name script_rel; do
      local script_abs="${dest}/${script_rel}"
      local hook_dir="${WTM_HOOKS}/${event_name}"
      local link="${hook_dir}/$(basename "${script_rel}")"
      if [[ -L "${link}" ]]; then
        rm -f "${link}"
        log_info "Hook removed: ${event_name} -> $(basename "${script_rel}")"
      fi
    done

    # Remove command symlinks
    local cmds_dir="${dest}/commands"
    if [[ -d "${cmds_dir}" ]]; then
      for cmd_script in "${cmds_dir}"/*; do
        [[ -f "${cmd_script}" ]] || continue
        local cmd_name
        cmd_name=$(basename "${cmd_script}")
        local link="${WTM_HOME}/bin/wtm-plugin-${cmd_name}"
        if [[ -L "${link}" ]]; then
          rm -f "${link}"
          log_info "Command symlink removed: ${link}"
        fi
      done
    fi
  fi

  rm -rf "${dest}"
  log_ok "Plugin removed: ${plugin_name}"
}

# ---------------------------------------------------------------------------
# list_plugins()
# List all installed plugins with name, version, description.
# ---------------------------------------------------------------------------
list_plugins() {
  if [[ ! -d "${WTM_PLUGINS}" ]]; then
    log_info "No plugins directory found: ${WTM_PLUGINS}"
    return 0
  fi

  local found=0
  printf "%-20s %-10s %s\n" "NAME" "VERSION" "DESCRIPTION"
  printf "%s\n" "$(printf '%0.s-' {1..60})"

  for plugin_json in "${WTM_PLUGINS}"/*/plugin.json; do
    [[ -f "${plugin_json}" ]] || continue
    python3 -c "
import json
with open('${plugin_json}') as f:
    d = json.load(f)
name = d.get('name', '?')
version = d.get('version', '?')
desc = d.get('description', '')
print(f'{name:<20} {version:<10} {desc}')
"
    found=1
  done

  [[ "${found}" -eq 0 ]] && echo "  (no plugins installed)"
}

# ---------------------------------------------------------------------------
# get_plugin_info(plugin_name)
# Show detailed plugin info.
# ---------------------------------------------------------------------------
get_plugin_info() {
  local plugin_name="$1"
  local plugin_json="${WTM_PLUGINS}/${plugin_name}/plugin.json"

  if [[ ! -f "${plugin_json}" ]]; then
    log_error "Plugin not found: ${plugin_name}"
    return 1
  fi

  python3 -c "
import json
with open('${plugin_json}') as f:
    d = json.load(f)
print(f\"Name:        {d.get('name', '?')}\")
print(f\"Version:     {d.get('version', '?')}\")
print(f\"Description: {d.get('description', '')}\")
hooks = d.get('hooks', {})
if hooks:
    print('Hooks:')
    for event, script in hooks.items():
        print(f'  {event} -> {script}')
else:
    print('Hooks:       (none)')
commands = d.get('commands', {})
if commands:
    print('Commands:')
    for cmd, script in commands.items():
        print(f'  {cmd} -> {script}')
else:
    print('Commands:    (none)')
"
}

# ---------------------------------------------------------------------------
# load_plugin_commands(plugin_name)
# Source plugin command scripts for CLI extension.
# ---------------------------------------------------------------------------
load_plugin_commands() {
  local plugin_name="$1"
  local cmds_dir="${WTM_PLUGINS}/${plugin_name}/commands"

  if [[ ! -d "${cmds_dir}" ]]; then
    return 0
  fi

  for cmd_script in "${cmds_dir}"/*; do
    [[ -f "${cmd_script}" ]] && [[ -x "${cmd_script}" ]] || continue
    # shellcheck source=/dev/null
    source "${cmd_script}"
    log_info "Loaded plugin command: $(basename "${cmd_script}")"
  done
}
