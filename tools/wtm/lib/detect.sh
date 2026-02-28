#!/usr/bin/env bash
# WTM Detect Library - Auto-detection of git projects in configured discovery paths
#
# Provides functions to scan for unregistered git repos, auto-register them,
# detect which registered project a path belongs to, and detect monorepo packages.

# Source common if not already loaded
if [[ -z "${WTM_HOME:-}" ]]; then
  WTM_HOME="${HOME}/.wtm"
  WTM_PROJECTS="${WTM_HOME}/projects.json"
  WTM_SESSIONS="${WTM_HOME}/sessions.json"
fi

# ---------------------------------------------------------------------------
# discover_projects
# Scan discovery_paths from projects.json defaults, find git repos not yet
# registered. Outputs one line per discovered repo: "path|name|remote_url"
# ---------------------------------------------------------------------------
discover_projects() {
  python3 - <<'PYEOF'
import json, os, subprocess, sys

projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))
with open(projects_file) as f:
    data = json.load(f)

defaults = data.get("defaults", {})
discovery_paths = defaults.get("discovery_paths", [])

# Collect all already-registered local paths (normalized)
aliases = data.get("aliases", {})
registered_locals = set()
for alias_data in aliases.values():
    local_path = alias_data.get("local", "")
    if local_path:
        registered_locals.add(os.path.realpath(os.path.expanduser(local_path)))

for raw_path in discovery_paths:
    scan_dir = os.path.expanduser(raw_path)
    if not os.path.isdir(scan_dir):
        continue

    # Find directories one level deep
    try:
        entries = os.listdir(scan_dir)
    except PermissionError:
        continue

    for entry in sorted(entries):
        dir_path = os.path.join(scan_dir, entry)
        if not os.path.isdir(dir_path):
            continue

        # Skip if .wtmignore present
        if os.path.exists(os.path.join(dir_path, ".wtmignore")):
            continue

        # Must have .git directory (skip bare repos - bare repos have no .git subdir)
        git_dir = os.path.join(dir_path, ".git")
        if not os.path.exists(git_dir):
            continue

        # Skip bare repos: bare repos have HEAD directly in dir but no .git subdir as directory
        # A bare repo would have HEAD in dir_path, not a .git subdir that is a directory
        if os.path.isfile(git_dir):
            # .git is a file (worktree link), skip
            continue

        real_path = os.path.realpath(dir_path)

        # Skip already registered
        if real_path in registered_locals:
            continue

        # Get remote URL
        try:
            result = subprocess.run(
                ["git", "-C", dir_path, "remote", "get-url", "origin"],
                capture_output=True, text=True, timeout=5
            )
            remote_url = result.stdout.strip() if result.returncode == 0 else ""
        except (subprocess.TimeoutExpired, FileNotFoundError):
            remote_url = ""

        name = os.path.basename(dir_path)
        print(f"{dir_path}|{name}|{remote_url}")
PYEOF
}

# ---------------------------------------------------------------------------
# auto_register
# Register a discovered project path into projects.json.
# Args: path [alias]
# Detects remote URL and default branch automatically.
# ---------------------------------------------------------------------------
auto_register() {
  local path="$1"
  local alias="${2:-}"

  # Expand path
  path="${path/#\~/$HOME}"

  if [[ ! -d "${path}/.git" ]]; then
    log_error "auto_register: ${path} is not a git repository"
    return 1
  fi

  # Derive alias from directory name if not provided
  if [[ -z "${alias}" ]]; then
    alias="$(basename "${path}")"
  fi

  # Detect remote URL
  local remote_url
  remote_url="$(git -C "${path}" remote get-url origin 2>/dev/null || true)"

  # Detect default branch: check main first, then master
  local default_base="main"
  if git -C "${path}" rev-parse --verify main &>/dev/null 2>&1; then
    default_base="main"
  elif git -C "${path}" rev-parse --verify master &>/dev/null 2>&1; then
    default_base="master"
  fi

  log_info "Registering project '${alias}' at ${path} (branch: ${default_base})"

  with_lock "$(basename "${WTM_PROJECTS}" .json)" python3 - "${alias}" "${path}" "${remote_url}" "${default_base}" <<'PYEOF'
import json, sys, os

alias, path, remote_url, default_base = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))

with open(projects_file, "r") as f:
    data = json.load(f)

data.setdefault("aliases", {})[alias] = {
    "repo": remote_url,
    "local": path,
    "default_base": default_base,
    "dependencies": [],
    "monorepo_packages": [],
    "discovery_paths": []
}

with open(projects_file, "w") as f:
    json.dump(data, f, indent=2)

print(f"Registered: {alias}")
PYEOF

  log_ok "Project '${alias}' registered successfully"
}

# ---------------------------------------------------------------------------
# detect_project_from_path
# Walk up from given path, check if any parent is a registered project's
# local path. Prints the matching alias or nothing (empty) if not found.
# Args: path
# ---------------------------------------------------------------------------
detect_project_from_path() {
  local path="$1"
  path="${path/#\~/$HOME}"

  python3 - "${path}" <<'PYEOF'
import json, os, sys

start_path = os.path.realpath(sys.argv[1])
projects_file = os.environ.get('WTM_PROJECTS', os.path.expanduser('~/.wtm/projects.json'))

with open(projects_file) as f:
    data = json.load(f)

aliases = data.get("aliases", {})

# Build map of real local paths -> alias
path_to_alias = {}
for alias, info in aliases.items():
    local = info.get("local", "")
    if local:
        real = os.path.realpath(os.path.expanduser(local))
        path_to_alias[real] = alias

# Walk up from start_path
current = start_path
while True:
    if current in path_to_alias:
        print(path_to_alias[current])
        break
    parent = os.path.dirname(current)
    if parent == current:
        # Reached filesystem root, no match
        break
    current = parent
PYEOF
}

# ---------------------------------------------------------------------------
# detect_monorepo_packages
# Check for monorepo config files and return newline-separated relative
# package paths found within the project.
# Args: project_path
# ---------------------------------------------------------------------------
detect_monorepo_packages() {
  local project_path="$1"
  project_path="${project_path/#\~/$HOME}"

  python3 - "${project_path}" <<'PYEOF'
import json, os, sys

project_path = sys.argv[1]
packages = []

# --- package.json workspaces ---
pkg_json = os.path.join(project_path, "package.json")
if os.path.exists(pkg_json):
    try:
        with open(pkg_json) as f:
            pkg = json.load(f)
        workspaces = pkg.get("workspaces", [])
        # workspaces can be a list or {"packages": [...]}
        if isinstance(workspaces, dict):
            workspaces = workspaces.get("packages", [])
        for ws in workspaces:
            # Expand globs
            import glob
            pattern = os.path.join(project_path, ws)
            matched = glob.glob(pattern)
            for m in matched:
                if os.path.isdir(m):
                    rel = os.path.relpath(m, project_path)
                    packages.append(rel)
    except (json.JSONDecodeError, OSError):
        pass

# --- lerna.json ---
lerna_json = os.path.join(project_path, "lerna.json")
if os.path.exists(lerna_json):
    try:
        with open(lerna_json) as f:
            lerna = json.load(f)
        import glob
        lerna_packages = lerna.get("packages", ["packages/*"])
        for pattern_rel in lerna_packages:
            pattern = os.path.join(project_path, pattern_rel)
            matched = glob.glob(pattern)
            for m in matched:
                if os.path.isdir(m):
                    rel = os.path.relpath(m, project_path)
                    if rel not in packages:
                        packages.append(rel)
    except (json.JSONDecodeError, OSError):
        pass

# --- pnpm-workspace.yaml ---
pnpm_yaml = os.path.join(project_path, "pnpm-workspace.yaml")
if os.path.exists(pnpm_yaml):
    try:
        import re, glob
        with open(pnpm_yaml) as f:
            content = f.read()
        # Simple YAML list parser for "packages:" section
        in_packages = False
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("packages:"):
                in_packages = True
                continue
            if in_packages:
                if stripped.startswith("- "):
                    pkg_glob = stripped[2:].strip().strip("'\"")
                    pattern = os.path.join(project_path, pkg_glob)
                    matched = glob.glob(pattern)
                    for m in matched:
                        if os.path.isdir(m):
                            rel = os.path.relpath(m, project_path)
                            if rel not in packages:
                                packages.append(rel)
                elif stripped and not stripped.startswith("#"):
                    in_packages = False
    except OSError:
        pass

for pkg in packages:
    print(pkg)
PYEOF
}
