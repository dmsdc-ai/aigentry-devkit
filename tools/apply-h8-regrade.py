#!/usr/bin/env python3
"""Apply H8 deep-fix F10 re-grade CSV to full-pilot-fix4 metrics.json files.

Reads tools/h8-f10-regrade-output.csv (40 rows) and patches
state/exec-mode-experiment/full-pilot-fix4/1/<mode>/F10/<seed>/metrics.json
with the new quality values. Does NOT touch the fix2 (preserved) snapshot.

Audit trail: adds quality.regraded_from_fix3=True to each patched metrics.json.
Actions are logged to tools/apply-h8-regrade.log.
"""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = REPO_ROOT / "tools" / "h8-f10-regrade-output.csv"
STATE_ROOT = REPO_ROOT / "state" / "exec-mode-experiment" / "full-pilot-fix4" / "1"
LOG_PATH = REPO_ROOT / "tools" / "apply-h8-regrade.log"


def _to_bool(value: str) -> bool:
    return str(value).strip().lower() == "true"


def _to_float(value: str) -> float:
    return float(value)


def patch_metrics(metrics: dict, row: dict) -> list[str]:
    """Mutate `metrics` in place; return list of human-readable change notes."""
    changes: list[str] = []

    quality = metrics.setdefault("quality", {})
    components = quality.setdefault("primary_components", {})

    new_quality = _to_float(row["new_quality"])
    new_pass = _to_bool(row["new_primary_pass"])
    new_status = _to_bool(row["new_status_present"])
    new_next = _to_bool(row["new_next_present"])
    new_stale = _to_bool(row["new_stale_present"])
    new_unresolved_rate = _to_float(row["new_unresolved_rate"])
    new_stale_rate = _to_float(row["new_stale_rate"])

    field_updates = [
        (quality, "primary", new_quality),
        (components, "primary_score", new_quality),
        (components, "primary_pass", new_pass),
        (components, "status_summary_present", new_status),
        (components, "next_actions_present", new_next),
        (components, "stale_table_present", new_stale),
        (components, "unresolved_application_rate", new_unresolved_rate),
        (components, "stale_rejection_rate", new_stale_rate),
    ]
    for container, key, new_value in field_updates:
        old_value = container.get(key)
        if old_value != new_value:
            changes.append(f"{key}: {old_value!r} -> {new_value!r}")
            container[key] = new_value

    if not quality.get("regraded_from_fix3"):
        quality["regraded_from_fix3"] = True
        changes.append("regraded_from_fix3: None -> True")

    return changes


def main() -> int:
    if not CSV_PATH.exists():
        raise SystemExit(f"missing CSV: {CSV_PATH}")
    if not STATE_ROOT.exists():
        raise SystemExit(f"missing state dir: {STATE_ROOT}")

    log_lines: list[str] = []
    patched = 0
    skipped_missing = 0
    no_change = 0

    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    log_lines.append(f"# apply-h8-regrade run @ {timestamp}")
    log_lines.append(f"# csv={CSV_PATH.relative_to(REPO_ROOT)}")
    log_lines.append(f"# state_root={STATE_ROOT.relative_to(REPO_ROOT)}")

    with CSV_PATH.open() as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            mode = row["mode"]
            fixture = row["fixture"]
            seed = row["seed"]
            trial_dir = STATE_ROOT / mode / fixture / seed
            metrics_path = trial_dir / "metrics.json"
            if not metrics_path.exists():
                skipped_missing += 1
                log_lines.append(f"SKIP missing {metrics_path.relative_to(REPO_ROOT)}")
                continue

            metrics = json.loads(metrics_path.read_text())
            changes = patch_metrics(metrics, row)
            if not changes:
                no_change += 1
                log_lines.append(
                    f"NOOP {mode}/{fixture}/{seed} already matches CSV"
                )
                continue

            metrics_path.write_text(
                json.dumps(metrics, ensure_ascii=False, sort_keys=True) + "\n"
            )
            patched += 1
            log_lines.append(f"PATCH {mode}/{fixture}/{seed} :: " + "; ".join(changes))

    log_lines.append(
        f"# summary: patched={patched} no_change={no_change} skipped_missing={skipped_missing}"
    )
    LOG_PATH.write_text("\n".join(log_lines) + "\n")
    print(
        f"apply-h8-regrade: patched={patched} no_change={no_change} skipped={skipped_missing}"
    )
    print(f"log -> {LOG_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
