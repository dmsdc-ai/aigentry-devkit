#!/usr/bin/env bash
# WTM Disk - macOS-compatible disk usage monitoring

WTM_DISK_WARNING_MB="${WTM_DISK_WARNING_MB:-5120}"  # 5GB default

# Get human-readable size of a worktree directory, excluding symlinks
# Uses find to enumerate non-symlink entries, then du -sk
get_worktree_disk_usage() {
  local worktree="$1"
  if [[ ! -d "${worktree}" ]]; then
    echo "0K"
    return 0
  fi
  local total_kb=0
  while IFS= read -r entry; do
    [[ -z "${entry}" ]] && continue
    local size_kb
    size_kb=$(du -sk "${entry}" 2>/dev/null | awk '{print $1}')
    total_kb=$(( total_kb + ${size_kb:-0} ))
  done < <(find "${worktree}" -maxdepth 1 -mindepth 1 ! -type l 2>/dev/null)

  # Format as human-readable
  if (( total_kb >= 1048576 )); then
    echo "$(( total_kb / 1048576 ))G"
  elif (( total_kb >= 1024 )); then
    echo "$(( total_kb / 1024 ))M"
  else
    echo "${total_kb}K"
  fi
}

# Get raw MB size of a worktree directory, excluding symlinks
get_worktree_disk_usage_mb() {
  local worktree="$1"
  if [[ ! -d "${worktree}" ]]; then
    echo "0"
    return 0
  fi
  local total_kb=0
  while IFS= read -r entry; do
    [[ -z "${entry}" ]] && continue
    local size_kb
    size_kb=$(du -sk "${entry}" 2>/dev/null | awk '{print $1}')
    total_kb=$(( total_kb + ${size_kb:-0} ))
  done < <(find "${worktree}" -maxdepth 1 -mindepth 1 ! -type l 2>/dev/null)
  echo "$(( total_kb / 1024 ))"
}

# Get total disk usage across all WTM-managed worktrees
get_total_wtm_disk_usage() {
  if [[ ! -d "${WTM_WORKTREES}" ]]; then
    echo "0K"
    return 0
  fi
  local total_kb=0
  while IFS= read -r worktree; do
    [[ -z "${worktree}" ]] && continue
    local size_kb
    # Sum non-symlink items inside each worktree
    while IFS= read -r entry; do
      [[ -z "${entry}" ]] && continue
      local kb
      kb=$(du -sk "${entry}" 2>/dev/null | awk '{print $1}')
      total_kb=$(( total_kb + ${kb:-0} ))
    done < <(find "${worktree}" -maxdepth 1 -mindepth 1 ! -type l 2>/dev/null)
  done < <(find "${WTM_WORKTREES}" -maxdepth 1 -mindepth 1 -type d 2>/dev/null)

  if (( total_kb >= 1048576 )); then
    echo "$(( total_kb / 1048576 ))G"
  elif (( total_kb >= 1024 )); then
    echo "$(( total_kb / 1024 ))M"
  else
    echo "${total_kb}K"
  fi
}

# Calculate disk saved by symlinks in a worktree relative to a source directory
# Compares actual sizes of symlinked dirs vs what they would be if copied
get_symlink_savings() {
  local worktree="$1"
  local source="$2"
  if [[ ! -d "${worktree}" ]] || [[ ! -d "${source}" ]]; then
    echo "0K saved"
    return 0
  fi

  local saved_kb=0
  while IFS= read -r link; do
    [[ -z "${link}" ]] && continue
    local target
    target=$(readlink "${link}" 2>/dev/null) || continue
    # Resolve relative symlinks
    if [[ ! "${target}" = /* ]]; then
      target="$(dirname "${link}")/${target}"
    fi
    if [[ -d "${target}" ]]; then
      local size_kb
      size_kb=$(du -sk "${target}" 2>/dev/null | awk '{print $1}')
      saved_kb=$(( saved_kb + ${size_kb:-0} ))
    fi
  done < <(find "${worktree}" -maxdepth 1 -mindepth 1 -type l 2>/dev/null)

  if (( saved_kb >= 1048576 )); then
    echo "$(( saved_kb / 1048576 ))G saved"
  elif (( saved_kb >= 1024 )); then
    echo "$(( saved_kb / 1024 ))M saved"
  else
    echo "${saved_kb}K saved"
  fi
}

# Warn if total WTM worktree disk usage exceeds threshold
check_disk_warning() {
  local total_mb
  total_mb=0
  if [[ -d "${WTM_WORKTREES}" ]]; then
    while IFS= read -r worktree; do
      [[ -z "${worktree}" ]] && continue
      local mb
      mb=$(get_worktree_disk_usage_mb "${worktree}")
      total_mb=$(( total_mb + mb ))
    done < <(find "${WTM_WORKTREES}" -maxdepth 1 -mindepth 1 -type d 2>/dev/null)
  fi

  if (( total_mb >= WTM_DISK_WARNING_MB )); then
    local total_gb=$(( total_mb / 1024 ))
    log_warn "WTM worktrees using ${total_gb}G — exceeds warning threshold ($(( WTM_DISK_WARNING_MB / 1024 ))G). Consider running 'wtm cleanup'."
    return 1
  fi
  return 0
}
