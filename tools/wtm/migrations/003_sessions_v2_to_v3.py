#!/usr/bin/env python3
"""Migrate sessions.json v2 -> v3: add cross-dimension fields."""
import json, sys, socket

file = sys.argv[1]
with open(file) as f:
    data = json.load(f)

if data.get("version", 0) >= 3:
    sys.exit(0)

machine_id = socket.gethostname().lower().replace(" ", "-")

for sid, session in data.get("sessions", {}).items():
    session.setdefault("child_sessions", [])
    session.setdefault("session_group", None)
    session.setdefault("session_chain", {"previous": None, "next": None})
    session.setdefault("context", {
        "journal_path": None,
        "last_handoff": None,
        "conversation_refs": []
    })
    session.setdefault("cross_project", {
        "depends_on": [],
        "depended_by": [],
        "shared_group": None
    })
    session.setdefault("machine", {
        "origin_machine": machine_id,
        "last_sync": None,
        "sync_branch": None
    })

data["version"] = 3

with open(file, "w") as f:
    json.dump(data, f, indent=2)
