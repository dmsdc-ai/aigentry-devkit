#!/usr/bin/env bash
# WTM Commits Library - Conventional commit enforcement

COMMIT_TYPES="feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"

# Validate a commit message against conventional commit pattern
# Returns "VALID" or "INVALID: <reason>" and exits 0/1
validate_commit_msg() {
  local msg="$1"
  if [[ -z "${msg}" ]]; then
    echo "INVALID: Empty commit message"
    return 1
  fi
  if [[ "${msg}" =~ ^(${COMMIT_TYPES})(\(.+\))?\!?:\ .+ ]]; then
    echo "VALID"
    return 0
  else
    echo "INVALID: Message must match pattern: type(scope): description"
    echo "         Types: ${COMMIT_TYPES//|/, }"
    echo "         Example: feat(auth): add OAuth2 login flow"
    return 1
  fi
}

# Install commit-msg hook into a worktree
# Handles both .git directories and .git files (worktree links)
install_commit_hook() {
  local worktree="$1"
  local git_path="${worktree}/.git"

  if [[ ! -e "${git_path}" ]]; then
    log_error "No .git found in worktree: ${worktree}"
    return 1
  fi

  local hooks_dir
  if [[ -f "${git_path}" ]]; then
    # .git is a file — git worktree link: "gitdir: /path/to/.git/worktrees/name"
    local gitdir
    gitdir=$(grep '^gitdir:' "${git_path}" | sed 's/^gitdir: //' | tr -d '[:space:]')
    if [[ -z "${gitdir}" ]]; then
      log_error "Could not parse gitdir from: ${git_path}"
      return 1
    fi
    # Resolve relative paths
    if [[ "${gitdir}" != /* ]]; then
      gitdir="${worktree}/${gitdir}"
    fi
    hooks_dir="${gitdir}/hooks"
  else
    # .git is a directory — normal repo
    hooks_dir="${git_path}/hooks"
  fi

  mkdir -p "${hooks_dir}"
  local hook_dest="${hooks_dir}/commit-msg"
  cp "${WTM_HOOKS}/commit-msg.template" "${hook_dest}"
  chmod +x "${hook_dest}"
  log_ok "Installed commit-msg hook at: ${hook_dest}"
}

# Format a conventional commit string
# Usage: format_commit <type> <scope> <message>
#   scope can be empty string to omit it
format_commit() {
  local type="$1"
  local scope="$2"
  local message="$3"

  if [[ -n "${scope}" ]]; then
    echo "${type}(${scope}): ${message}"
  else
    echo "${type}: ${message}"
  fi
}

# Print available commit types with descriptions
list_commit_types() {
  echo "Available conventional commit types:"
  echo ""
  printf "  %-12s %s\n" "feat"     "A new feature"
  printf "  %-12s %s\n" "fix"      "A bug fix"
  printf "  %-12s %s\n" "docs"     "Documentation only changes"
  printf "  %-12s %s\n" "style"    "Formatting, missing semi-colons, etc (no logic change)"
  printf "  %-12s %s\n" "refactor" "Code change that neither fixes a bug nor adds a feature"
  printf "  %-12s %s\n" "perf"     "Code change that improves performance"
  printf "  %-12s %s\n" "test"     "Adding or correcting tests"
  printf "  %-12s %s\n" "build"    "Changes to build system or external dependencies"
  printf "  %-12s %s\n" "ci"       "Changes to CI configuration files and scripts"
  printf "  %-12s %s\n" "chore"    "Other changes that don't modify src or test files"
  printf "  %-12s %s\n" "revert"   "Reverts a previous commit"
}
