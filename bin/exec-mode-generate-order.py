#!/usr/bin/env python3
"""Generate pre-registered run orders for the exec-mode comparison experiment (T14).

Produces four CSVs under --output-dir:

  run_order_D.csv       300 trials  10 fixtures × 30 seeds   flat shuffle
  run_order_Pfresh.csv  300 trials  10 fixtures × 30 seeds   flat shuffle
  run_order_S.csv       300 trials  10 fixtures × 30 seeds   flat shuffle
  run_order_Pacc.csv    300 trials  30 sessions × 10 positions  per-session shuffle

Determinism (spec §4.4 / §7.5):
- D / Pfresh / S use a master seed derived as MASTER_SEED + mode_offset so the
  three orders are reproducible AND distinct (no shared time-slot confound).
- Pacc per-session order = random.Random(session_idx).shuffle(FIXTURES) per
  spec line 143. seed_idx in the CSV equals session_idx (1..30).

CSV columns are stable; the harness (Session A) reads them positionally.
The trial_idx column is dense 0..N-1 to make resume-by-index trivial.

CLI:
  exec-mode-generate-order.py --output-dir <dir>
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from pathlib import Path

FIXTURES: tuple[str, ...] = ("F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "Fa")
SEEDS_PER_FIXTURE = 30
PACC_SESSIONS = 30
PACC_POSITIONS = 10

MASTER_SEED = 42
_MODE_OFFSET = {"D": 0, "Pfresh": 1, "S": 2}


def _flat_pairs() -> list[tuple[str, int]]:
    return [(f, s) for f in FIXTURES for s in range(SEEDS_PER_FIXTURE)]


def _write_csv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def write_flat_order(mode: str, out: Path) -> None:
    """Write run_order_{D|Pfresh|S}.csv."""
    if mode not in _MODE_OFFSET:
        raise ValueError(f"flat mode must be one of {sorted(_MODE_OFFSET)}, got {mode!r}")
    pairs = _flat_pairs()
    random.Random(MASTER_SEED + _MODE_OFFSET[mode]).shuffle(pairs)
    rows = [[idx, fixture, seed] for idx, (fixture, seed) in enumerate(pairs)]
    _write_csv(out, ["trial_idx", "fixture_id", "seed_idx"], rows)


def write_pacc_order(out: Path) -> None:
    """Write run_order_Pacc.csv (30 sessions × 10 fixtures, balanced positions on average)."""
    rows: list[list[object]] = []
    trial_idx = 0
    for session_idx in range(1, PACC_SESSIONS + 1):
        order = list(FIXTURES)
        random.Random(session_idx).shuffle(order)
        for position, fixture in enumerate(order, start=1):
            rows.append([trial_idx, session_idx, position, fixture, session_idx])
            trial_idx += 1
    _write_csv(
        out,
        ["trial_idx", "session_idx", "position_in_chain", "fixture_id", "seed_idx"],
        rows,
    )


def write_all(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for mode in ("D", "Pfresh", "S"):
        write_flat_order(mode, output_dir / f"run_order_{mode}.csv")
    write_pacc_order(output_dir / "run_order_Pacc.csv")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--output-dir", required=True, type=Path,
                   help="Directory to write run_order_*.csv into (created if missing).")
    args = p.parse_args(argv)
    write_all(args.output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
