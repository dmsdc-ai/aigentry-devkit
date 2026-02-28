#!/usr/bin/env python3
"""Migrate sessions.json v1 -> v2: add health, metrics, ttl, tags fields."""
import json, sys

file = sys.argv[1]
with open(file) as f:
    data = json.load(f)

if data.get("version", 0) >= 2:
    sys.exit(0)  # Already at v2+

for sid, session in data.get("sessions", {}).items():
    session.setdefault("last_activity_at", session.get("created_at"))
    session.setdefault("ttl_hours", 168)
    session.setdefault("tags", [])
    session.setdefault("template", None)
    session.setdefault("parent_session", None)
    session.setdefault("metrics", {
        "commits": 0, "files_changed": 0,
        "lines_added": 0, "lines_removed": 0,
        "duration_minutes": 0
    })
    session.setdefault("health", {
        "worktree_ok": True, "tmux_ok": True,
        "watcher_ok": True, "symlinks_ok": True,
        "last_check": None
    })

data["version"] = 2
with open(file, "w") as f:
    json.dump(data, f, indent=2)
