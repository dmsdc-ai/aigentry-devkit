#!/usr/bin/env bash
# WTM Schema Migration Engine
# Auto-migrates JSON files to latest schema version on first read

WTM_MIGRATIONS="${WTM_HOME}/migrations"
WTM_CURRENT_SESSIONS_VERSION=4
WTM_CURRENT_PROJECTS_VERSION=3

# Get current schema version from a JSON file
# Returns 0 if no version field exists
get_schema_version() {
  local file="$1"
  [[ -f "${file}" ]] || { echo "0"; return; }
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
print(data.get('version', 0))
" "${file}"
}

# Run all pending migrations for a file
run_migrations() {
  local file="$1"
  local current
  current=$(get_schema_version "${file}")

  # Create backup before migration
  if [[ -f "${file}" ]]; then
    cp "${file}" "${file}.bak-v${current}"
  fi

  # Run numbered migration scripts
  for migration in "${WTM_MIGRATIONS}"/*.py; do
    [[ -f "${migration}" ]] || continue
    local mig_num
    mig_num=$(basename "${migration}" | grep -o '^[0-9]*' | sed 's/^0*//')
    [[ -z "${mig_num}" ]] && continue
    if [[ ${mig_num} -gt ${current} ]]; then
      log_info "Running migration $(basename "${migration}")..."
      if python3 "${migration}" "${file}"; then
        current=${mig_num}
        log_ok "Migration $(basename "${migration}") succeeded"
      else
        log_error "Migration $(basename "${migration}") FAILED! Restoring backup..."
        local backup="${file}.bak-v$(get_schema_version "${file}")"
        [[ -f "${backup}" ]] && cp "${backup}" "${file}"
        return 1
      fi
    fi
  done
}

# Auto-migrate sessions.json to latest version
ensure_sessions_current() {
  local current
  current=$(get_schema_version "${WTM_SESSIONS}")
  if [[ ${current} -lt ${WTM_CURRENT_SESSIONS_VERSION} ]]; then
    log_info "Auto-migrating sessions.json from v${current} to v${WTM_CURRENT_SESSIONS_VERSION}..."
    run_migrations "${WTM_SESSIONS}"
  fi
}

# Auto-migrate projects.json to latest version
ensure_projects_current() {
  local current
  current=$(get_schema_version "${WTM_PROJECTS}")
  if [[ ${current} -lt ${WTM_CURRENT_PROJECTS_VERSION} ]]; then
    log_info "Auto-migrating projects.json from v${current} to v${WTM_CURRENT_PROJECTS_VERSION}..."
    run_migrations "${WTM_PROJECTS}"
  fi
}

# Convenience: ensure both files are current
ensure_all_schemas() {
  ensure_sessions_current
  ensure_projects_current
}
