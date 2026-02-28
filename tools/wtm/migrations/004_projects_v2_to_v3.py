#!/usr/bin/env python3
"""Migrate projects.json v2 -> v3: add cross-dimension fields."""
import json, sys

file = sys.argv[1]
with open(file) as f:
    data = json.load(f)

if data.get("version", 0) >= 3:
    sys.exit(0)

for alias, project in data.get("aliases", {}).items():
    project.setdefault("dependencies", [])
    project.setdefault("monorepo_packages", [])
    project.setdefault("discovery_paths", [])

defaults = data.setdefault("defaults", {})
defaults.setdefault("auto_discover", False)
defaults.setdefault("discovery_paths", ["~/Projects", "~/work", "~/repos"])
defaults.setdefault("sync_remote", "origin")
defaults.setdefault("sync_branch_prefix", "wtm-state")

data.setdefault("machines", {})
data["version"] = 3

with open(file, "w") as f:
    json.dump(data, f, indent=2)
