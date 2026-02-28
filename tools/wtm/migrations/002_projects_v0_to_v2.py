#!/usr/bin/env python3
"""Migrate projects.json from versionless (v0) to v2."""
import json, sys

file = sys.argv[1]
with open(file) as f:
    data = json.load(f)

# v0 has no version field; treat missing as 0. Skip if already >= 2
if data.get("version", 0) >= 2:
    sys.exit(0)

for alias, project in data.get("aliases", {}).items():
    project.setdefault("branch_naming", "{type}/{name}")
    project.setdefault("conventional_commits", True)
    project.setdefault("pr_template", True)
    default_cleanup = data.get("defaults", {}).get("cleanup_after_days", 14)
    project.setdefault("auto_cleanup_days", default_cleanup)
    project.setdefault("symlink_patterns", [
        "node_modules:dir", "frontend/node_modules:dir", ".env:file"
    ])
    project.setdefault("hooks", {"post_create": [], "pre_kill": [], "post_kill": []})

defaults = data.setdefault("defaults", {})
defaults.setdefault("worktree_root", "~/.wtm/worktrees")
defaults.setdefault("cleanup_after_days", 14)
defaults.setdefault("health_check_interval_minutes", 30)
defaults.setdefault("max_sessions_per_project", 10)
defaults.setdefault("disk_warning_gb", 5)

data.setdefault("templates", {})
data["version"] = 2

with open(file, "w") as f:
    json.dump(data, f, indent=2)
