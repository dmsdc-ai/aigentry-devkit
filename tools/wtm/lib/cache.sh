#!/usr/bin/env bash
# WTM Cache - Shared build cache management via symlinks

WTM_CACHE_ROOT="${WTM_CACHE_ROOT:-${WTM_HOME}/shared-cache}"

# Build cache patterns: "dir_name:type"
# These directories will be symlinked from a shared location into each worktree
BUILD_CACHE_PATTERNS=(
  ".turbo:dir"
  ".parcel-cache:dir"
  ".cache:dir"
  "target:dir"
  "__pycache__:dir"
  ".pytest_cache:dir"
)

# Set up shared build cache symlinks for a worktree
# source: the original project dir (used to derive cache namespace)
# worktree: the target worktree path
setup_build_cache_symlinks() {
  local source="$1"
  local worktree="$2"

  if [[ ! -d "${worktree}" ]]; then
    log_warn "Worktree does not exist, skipping cache symlinks: ${worktree}"
    return 0
  fi

  # Namespace cache by project source path (sanitized)
  local ns
  ns=$(echo "${source}" | tr '/' '_' | tr -d '.')
  local cache_dir="${WTM_CACHE_ROOT}/${ns}"
  mkdir -p "${cache_dir}"

  for pattern in "${BUILD_CACHE_PATTERNS[@]}"; do
    local dir_name="${pattern%%:*}"
    local target="${cache_dir}/${dir_name}"
    local link="${worktree}/${dir_name}"

    # Skip if already exists as real directory (don't override)
    if [[ -d "${link}" ]] && [[ ! -L "${link}" ]]; then
      log_info "Skipping ${dir_name} (real dir exists in worktree)"
      continue
    fi

    # Remove stale symlink
    [[ -L "${link}" ]] && rm -f "${link}"

    # Create shared cache dir and symlink
    mkdir -p "${target}"
    ln -s "${target}" "${link}" 2>/dev/null || true
    log_info "Cache symlink: ${link} → ${target}"
  done
}

# Show cache statistics: total size and number of caches
get_cache_stats() {
  if [[ ! -d "${WTM_CACHE_ROOT}" ]]; then
    echo "No shared build caches found."
    return 0
  fi

  local total_kb=0
  local cache_count=0

  while IFS= read -r cache_entry; do
    [[ -z "${cache_entry}" ]] && continue
    local kb
    kb=$(du -sk "${cache_entry}" 2>/dev/null | awk '{print $1}')
    total_kb=$(( total_kb + ${kb:-0} ))
    cache_count=$(( cache_count + 1 ))
  done < <(find "${WTM_CACHE_ROOT}" -maxdepth 2 -mindepth 2 -type d 2>/dev/null)

  local human
  if (( total_kb >= 1048576 )); then
    human="$(( total_kb / 1048576 ))G"
  elif (( total_kb >= 1024 )); then
    human="$(( total_kb / 1024 ))M"
  else
    human="${total_kb}K"
  fi

  echo "Shared build caches: ${cache_count} entries, ${human} total"
  echo "Cache root: ${WTM_CACHE_ROOT}"
}

# Clear all shared build caches
clean_cache() {
  if [[ ! -d "${WTM_CACHE_ROOT}" ]]; then
    log_info "No shared build caches to clean."
    return 0
  fi

  log_warn "Cleaning shared build caches at ${WTM_CACHE_ROOT}..."
  rm -rf "${WTM_CACHE_ROOT:?}"/*
  log_ok "Shared build caches cleared."
}
