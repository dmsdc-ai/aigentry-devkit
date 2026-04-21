#!/usr/bin/env python3
"""H8 deep-fix F10 re-grade — pure-text re-grade on existing 40 F10 trials.

Reads stage1_output.md alongside each metrics.json, runs the (now fixed)
score_f10_checklist against it, and emits a CSV comparing old vs new
primary_score. Does NOT mutate metrics.json — orchestrator decides
whether to patch pilot state in-place.

Usage: python tools/h8-f10-regrade.py
"""
from __future__ import annotations

import csv
import importlib.util
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GRADER_PATH = REPO_ROOT / "bin" / "exec-mode-grader.py"
STATE_ROOT = REPO_ROOT / "state" / "exec-mode-experiment" / "full-pilot-fix2" / "1"
FIXTURE_PATH = (
    REPO_ROOT.parent
    / "aigentry-orchestrator"
    / "fixtures"
    / "exec-mode-experiment"
    / "F10"
    / "ground_truth.json"
)
OUTPUT_CSV = REPO_ROOT / "tools" / "h8-f10-regrade-output.csv"

MODES = ("D", "Pfresh", "Pacc", "S")


def load_grader():
    spec = importlib.util.spec_from_file_location("exec_mode_grader", GRADER_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["exec_mode_grader"] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    grader = load_grader()
    ground_truth = json.loads(FIXTURE_PATH.read_text())

    rows: list[dict] = []
    for mode in MODES:
        trial_dirs = sorted((STATE_ROOT / mode / "F10").glob("seed*"))
        for trial_dir in trial_dirs:
            metrics_path = trial_dir / "metrics.json"
            stage1_path = trial_dir / "stage1_output.md"
            if not metrics_path.exists() or not stage1_path.exists():
                continue

            metrics = json.loads(metrics_path.read_text())
            old_quality = metrics.get("quality", {}).get("primary")
            old_components = metrics.get("quality", {}).get("primary_components", {})
            old_pass = bool(old_components.get("primary_pass"))

            stage1_text = stage1_path.read_text()
            new_components = grader.score_f10_checklist(stage1_text, ground_truth)
            new_quality = new_components["primary_score"]
            new_pass = bool(new_components["primary_pass"])

            delta = (
                round(new_quality - old_quality, 4)
                if isinstance(old_quality, (int, float))
                else None
            )

            rows.append(
                {
                    "mode": mode,
                    "fixture": "F10",
                    "seed": trial_dir.name,
                    "old_quality": old_quality,
                    "new_quality": new_quality,
                    "delta": delta,
                    "old_primary_pass": old_pass,
                    "new_primary_pass": new_pass,
                    "old_status_present": old_components.get("status_summary_present"),
                    "new_status_present": new_components["status_summary_present"],
                    "old_next_present": old_components.get("next_actions_present"),
                    "new_next_present": new_components["next_actions_present"],
                    "old_stale_present": old_components.get("stale_table_present"),
                    "new_stale_present": new_components["stale_table_present"],
                    "new_unresolved_rate": new_components["unresolved_application_rate"],
                    "new_stale_rate": new_components["stale_rejection_rate"],
                }
            )

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    # Summary to stdout (orchestrator-friendly).
    per_mode: dict[str, list[dict]] = {m: [] for m in MODES}
    for r in rows:
        per_mode[r["mode"]].append(r)

    print(f"# H8 F10 re-grade — {len(rows)} trials")
    print(f"# csv: {OUTPUT_CSV.relative_to(REPO_ROOT)}")
    print("")
    print(f"{'mode':<8} {'n':>3} {'old_mean':>10} {'new_mean':>10} {'delta':>8} "
          f"{'old_pass':>9} {'new_pass':>9} {'lifted':>7}")
    total_lifted = 0
    for mode in MODES:
        mrows = per_mode[mode]
        if not mrows:
            continue
        n = len(mrows)
        old_mean = round(
            sum((r["old_quality"] or 0.0) for r in mrows) / n, 4
        )
        new_mean = round(sum(r["new_quality"] for r in mrows) / n, 4)
        delta = round(new_mean - old_mean, 4)
        old_pass = sum(1 for r in mrows if r["old_primary_pass"])
        new_pass = sum(1 for r in mrows if r["new_primary_pass"])
        lifted = sum(
            1
            for r in mrows
            if not r["old_primary_pass"] and r["new_primary_pass"]
        )
        total_lifted += lifted
        print(f"{mode:<8} {n:>3} {old_mean:>10} {new_mean:>10} {delta:>+8.4f} "
              f"{old_pass:>9} {new_pass:>9} {lifted:>7}")
    print("")
    print(f"total zero-trials lifted by H8 deep-fix: {total_lifted}/{len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
