#!/usr/bin/env bash
# WTM Conflict Library - Branch conflict detection and resolution suggestions
# Detects divergence between a worktree branch and its base, identifies conflicting files,
# and recommends rebase vs merge based on divergence magnitude.

# ---------------------------------------------------------------------------
# detect_branch_conflicts <worktree_path> <base_branch>
#
# Fetches origin in the given worktree, then checks how far ahead/behind the
# current branch is relative to base_branch. If diverged, attempts a dry-run
# merge to surface conflicting files.
#
# Output (stdout):
#   Line 1: "UP_TO_DATE"                          – nothing to do
#            "DIVERGED|behind=N|ahead=N"           – branch has diverged
#   Line 2 (only when DIVERGED):
#            "CONFLICTS|file1,file2,..."            – conflicting paths
#            "MERGEABLE"                            – no conflicts detected
#
# Returns: 0 always (errors printed to stderr via log_error)
# ---------------------------------------------------------------------------
detect_branch_conflicts() {
  local worktree="$1"
  local base_branch="$2"

  if [[ ! -d "${worktree}" ]]; then
    log_error "detect_branch_conflicts: worktree directory not found: ${worktree}"
    return 1
  fi

  # Fetch origin quietly so we have up-to-date remote refs
  if ! git -C "${worktree}" fetch origin --quiet 2>/dev/null; then
    log_warn "detect_branch_conflicts: could not fetch origin (offline?)"
  fi

  # Resolve the remote tracking ref (e.g. origin/main)
  local remote_ref="origin/${base_branch}"

  # Count commits behind and ahead of the remote base
  local behind ahead
  behind=$(git -C "${worktree}" rev-list --count HEAD.."${remote_ref}" 2>/dev/null || echo 0)
  ahead=$(git -C "${worktree}"  rev-list --count "${remote_ref}"..HEAD 2>/dev/null || echo 0)

  if [[ "${behind}" -eq 0 && "${ahead}" -eq 0 ]]; then
    echo "UP_TO_DATE"
    return 0
  fi

  echo "DIVERGED|behind=${behind}|ahead=${ahead}"

  # Dry-run merge to find conflicting files (merge is reverted automatically
  # because we run it inside a detached index check without touching the work-tree)
  local conflict_files
  conflict_files=$(
    git -C "${worktree}" merge-tree \
        "$(git -C "${worktree}" merge-base HEAD "${remote_ref}")" \
        HEAD \
        "${remote_ref}" 2>/dev/null \
      | python3 -c "
import sys, re
conflicts = []
for line in sys.stdin:
    # merge-tree marks conflicting blobs with mode 0 on one side
    m = re.match(r'^CONFLICT \(content\): Merge conflict in (.+)$', line.strip())
    if m:
        conflicts.append(m.group(1))
    # Also catch the simpler 'changed in both' lines
    m2 = re.match(r'^\s+both (modified|added|deleted):\s+(.+)$', line)
    if m2:
        conflicts.append(m2.group(2).strip())
# deduplicate preserving order
seen = set()
unique = [x for x in conflicts if not (x in seen or seen.add(x))]
if unique:
    print('CONFLICTS|' + ','.join(unique))
else:
    print('MERGEABLE')
" 2>/dev/null
  )

  # Fallback: try a no-commit, no-ff merge in a temp branch if merge-tree gave nothing
  if [[ -z "${conflict_files}" ]]; then
    conflict_files=$(
      git -C "${worktree}" merge --no-commit --no-ff "${remote_ref}" 2>&1 | \
        python3 -c "
import sys
conflicts = []
for line in sys.stdin:
    line = line.strip()
    if line.startswith('CONFLICT'):
        # Extract filename after last 'in '
        parts = line.rsplit(' in ', 1)
        if len(parts) == 2:
            conflicts.append(parts[1])
if conflicts:
    print('CONFLICTS|' + ','.join(conflicts))
else:
    print('MERGEABLE')
" 2>/dev/null
      local rc=$?
      # Always abort the merge attempt so worktree is clean
      git -C "${worktree}" merge --abort 2>/dev/null || true
      return ${rc}
    )
  fi

  echo "${conflict_files:-MERGEABLE}"
}

# ---------------------------------------------------------------------------
# suggest_conflict_resolution <status_line>
#
# Reads the DIVERGED|behind=N|ahead=N line produced by detect_branch_conflicts
# and prints a human-readable recommendation.
#
# Heuristic:
#   behind <= 5  → rebase (cleaner history, low risk)
#   behind > 5   → merge  (safer for large divergence)
# ---------------------------------------------------------------------------
suggest_conflict_resolution() {
  local status="$1"

  if [[ "${status}" == "UP_TO_DATE" ]]; then
    log_ok "Branch is up to date. No action required."
    return 0
  fi

  if [[ "${status}" != DIVERGED* ]]; then
    log_warn "suggest_conflict_resolution: unexpected status: ${status}"
    return 1
  fi

  local behind ahead
  behind=$(echo "${status}" | python3 -c "
import sys, re
m = re.search(r'behind=(\d+)', sys.stdin.read())
print(m.group(1) if m else '0')
")
  ahead=$(echo "${status}" | python3 -c "
import sys, re
m = re.search(r'ahead=(\d+)', sys.stdin.read())
print(m.group(1) if m else '0')
")

  log_info "Branch divergence: ${behind} behind, ${ahead} ahead of base."

  if [[ "${behind}" -le 5 ]]; then
    log_ok "Recommendation: REBASE"
    echo -e "${CYAN}  git fetch origin && git rebase origin/<base-branch>${NC}"
    echo "  (Small divergence — rebase produces a linear, clean history.)"
  else
    log_warn "Recommendation: MERGE"
    echo -e "${CYAN}  git fetch origin && git merge origin/<base-branch>${NC}"
    echo "  (Large divergence (${behind} commits behind) — merge is safer and preserves history.)"
  fi
}
