#!/usr/bin/env bash
# WTM Branch Library - Branch naming strategy enforcement

# Validate a branch name against type/name pattern
# Usage: validate_branch_name <type> <name> [pattern]
# Output: "VALID|branch-name" or "INVALID|branch-name"
validate_branch_name() {
  local type="$1"
  local name="$2"
  local _default_pattern='{type}/{name}'
  local pattern="${3:-${_default_pattern}}"

  # Reject empty type or name
  if [[ -z "${type}" ]] || [[ -z "${name}" ]]; then
    echo "INVALID|"
    return 1
  fi

  # Build expected branch name from pattern
  local branch_name
  branch_name=$(echo "${pattern}" | sed "s/{type}/${type}/g" | sed "s/{name}/${name}/g")

  # Rules: no spaces, only [a-z0-9._/-], must contain type/name
  if [[ "${branch_name}" =~ [[:space:]] ]]; then
    echo "INVALID|${branch_name}"
    return 1
  fi

  if [[ ! "${branch_name}" =~ ^[a-z0-9._/-]+$ ]]; then
    echo "INVALID|${branch_name}"
    return 1
  fi

  if [[ ! "${branch_name}" == *"${type}"* ]] || [[ ! "${branch_name}" == *"${name}"* ]]; then
    echo "INVALID|${branch_name}"
    return 1
  fi

  echo "VALID|${branch_name}"
  return 0
}

# Suggest a valid branch name by slugifying raw input
# Usage: suggest_branch_name <type> <raw_name>
# Output: "type/slugified-name"
suggest_branch_name() {
  local type="$1"
  local raw_name="$2"

  local slug
  # Lowercase
  slug="${raw_name,,}"
  # Replace any non-alphanumeric (except hyphens, dots, underscores) with hyphens
  slug="${slug//[^a-z0-9._-]/-}"
  # Collapse multiple consecutive hyphens
  while [[ "${slug}" == *"--"* ]]; do
    slug="${slug//--/-}"
  done
  # Trim leading/trailing hyphens
  slug="${slug#-}"
  slug="${slug%-}"

  echo "${type}/${slug}"
}

# Get branch naming pattern for a project from projects.json
# Usage: get_branch_pattern <project_alias>
# Output: pattern string, default "{type}/{name}"
get_branch_pattern() {
  local project="$1"
  local default_pattern="{type}/{name}"

  if [[ ! -f "${WTM_PROJECTS}" ]]; then
    echo "${default_pattern}"
    return 0
  fi

  python3 -c "
import json, sys
with open('${WTM_PROJECTS}') as f:
    data = json.load(f)
alias = data.get('aliases', {}).get('${project}', {})
pattern = alias.get('branch_naming', '${default_pattern}')
print(pattern)
" 2>/dev/null || echo "${default_pattern}"
}
