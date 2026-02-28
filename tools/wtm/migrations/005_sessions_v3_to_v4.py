#!/usr/bin/env python3
"""WTM Migration 005: sessions v3 → v4
Converts tmux-specific fields to universal terminal abstraction.

Changes:
  - "tmux": "<name>" → "terminal": {"type": "tmux", "session_name": "<name>", ...}
  - "tmux_session": "<name>" → same (lazy.sh field)
  - "health.tmux_ok" → "health.terminal_ok"
  - Preserves old "tmux"/"tmux_session" fields for one-version backward compat
  - Updates version 3 → 4
"""

import json
import sys


def migrate_session(session: dict) -> dict:
    """Migrate a single session dict from v3 to v4."""

    # Skip if already migrated
    if "terminal" in session and isinstance(session.get("terminal"), dict):
        return session

    # Determine tmux session name from either field
    tmux_name = session.get("tmux") or session.get("tmux_session") or ""

    if tmux_name:
        session["terminal"] = {
            "type": "tmux",
            "session_name": tmux_name,
            "pid": None,
            "capabilities": ["launch", "send_command", "check_alive", "kill"],
        }
    else:
        session["terminal"] = {
            "type": "unknown",
            "session_name": None,
            "pid": None,
            "capabilities": ["launch"],
        }

    # Migrate health.tmux_ok → health.terminal_ok
    health = session.get("health", {})
    if isinstance(health, dict) and "tmux_ok" in health:
        health["terminal_ok"] = health["tmux_ok"]
        # Preserve old field for backward compat (one version)

    return session


def main():
    if len(sys.argv) < 2:
        print("Usage: 005_sessions_v3_to_v4.py <sessions.json>", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]

    with open(path, "r") as f:
        data = json.load(f)

    current_version = data.get("version", 0)
    if current_version >= 4:
        # Already at v4 or beyond; idempotent
        sys.exit(0)

    if current_version < 3:
        print(f"Expected version >= 3, got {current_version}. Run earlier migrations first.", file=sys.stderr)
        sys.exit(1)

    sessions = data.get("sessions", {})
    for sid, session in sessions.items():
        sessions[sid] = migrate_session(session)

    data["version"] = 4
    data["sessions"] = sessions

    with open(path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Migrated {len(sessions)} session(s) from v3 to v4")


if __name__ == "__main__":
    main()
