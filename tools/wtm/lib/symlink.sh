#!/usr/bin/env bash
# WTM Symlink Manager - Share node_modules, .env, and other large/config files

# Patterns to symlink from source to worktree
# Format: relative_path:type
# type: dir (symlink entire directory), file (symlink single file), glob (symlink matching files)
SYMLINK_PATTERNS=(
  "node_modules:dir"
  ".env:file"
  ".env.local:file"
  ".env.development:file"
  ".env.production:file"
)

# Additional patterns for common project structures
FRONTEND_SYMLINK_PATTERNS=(
  "frontend/node_modules:dir"
  "frontend/.env:file"
  "frontend/.env.local:file"
  "frontend/.next:dir"
)

# Setup symlinks from source project to worktree
# Args: $1 = source_dir, $2 = worktree_dir
setup_symlinks() {
  local source_dir="$1"
  local worktree_dir="$2"
  local count=0

  # Combine all patterns
  local all_patterns=("${SYMLINK_PATTERNS[@]}" "${FRONTEND_SYMLINK_PATTERNS[@]}")

  for pattern in "${all_patterns[@]}"; do
    IFS=':' read -r rel_path link_type <<< "${pattern}"

    local source_path="${source_dir}/${rel_path}"
    local target_path="${worktree_dir}/${rel_path}"

    case "${link_type}" in
      dir)
        if [[ -d "${source_path}" ]]; then
          # Remove existing directory in worktree if it exists
          if [[ -d "${target_path}" ]] && [[ ! -L "${target_path}" ]]; then
            rm -rf "${target_path}"
          fi
          # Create parent directory if needed
          mkdir -p "$(dirname "${target_path}")"
          # Create symlink
          ln -sfn "${source_path}" "${target_path}"
          count=$((count + 1))
          echo "  Linked: ${rel_path} (dir)"
        fi
        ;;
      file)
        if [[ -f "${source_path}" ]]; then
          mkdir -p "$(dirname "${target_path}")"
          ln -sf "${source_path}" "${target_path}"
          count=$((count + 1))
          echo "  Linked: ${rel_path} (file)"
        fi
        ;;
    esac
  done

  echo "  ${count} resource(s) symlinked"
}

# Remove symlinks from worktree (before deletion)
cleanup_symlinks() {
  local worktree_dir="$1"

  local all_patterns=("${SYMLINK_PATTERNS[@]}" "${FRONTEND_SYMLINK_PATTERNS[@]}")

  for pattern in "${all_patterns[@]}"; do
    IFS=':' read -r rel_path link_type <<< "${pattern}"
    local target_path="${worktree_dir}/${rel_path}"

    if [[ -L "${target_path}" ]]; then
      rm -f "${target_path}"
    fi
  done
}

# Verify symlinks are intact
verify_symlinks() {
  local worktree_dir="$1"
  local broken=0

  local all_patterns=("${SYMLINK_PATTERNS[@]}" "${FRONTEND_SYMLINK_PATTERNS[@]}")

  for pattern in "${all_patterns[@]}"; do
    IFS=':' read -r rel_path link_type <<< "${pattern}"
    local target_path="${worktree_dir}/${rel_path}"

    if [[ -L "${target_path}" ]]; then
      if [[ ! -e "${target_path}" ]]; then
        echo "  BROKEN: ${rel_path}"
        broken=$((broken + 1))
      fi
    fi
  done

  if [[ ${broken} -eq 0 ]]; then
    echo "  All symlinks healthy"
  else
    echo "  ${broken} broken symlink(s) found"
  fi

  return ${broken}
}
