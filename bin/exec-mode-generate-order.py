#!/usr/bin/env python3
"""Generate pre-registered run orders for the exec-mode comparison experiment.

Phase 3 (T14): produced 4 CSVs (D / Pfresh / S flat-shuffle + Pacc per-session)
under a single output dir. Phase 4 extends to 9 CSVs per the trial-driver
wiring spec `docs/superpowers/specs/2026-04-26-phase4-trial-driver-wiring.md`
§4 — pre-reg tag `exec-mode-v4-replication-preregistered-20260426`.

CSV outputs (Phase 4):

  Replication arms (10 fixtures × 20 seeds = 200 trials each):
    run_order_D.csv
    run_order_Pfresh.csv
    run_order_S.csv
    run_order_Pacc.csv          (20 sessions × 10 positions)

  Preuse arms (10 fixtures × 10 seeds = 100 trials each):
    run_order_Preuse-clear.csv
    run_order_Preuse-substitute-compact-C1.csv
    run_order_Preuse-substitute-compact-C2.csv
    run_order_Preuse-substitute-compact-C3.csv
    run_order_Preuse-substitute-compact-C4.csv

Total Phase 4 trials: 800 + 500 = 1,300 (matches pre-reg tag annotation).

Determinism (spec §4.3):
- D / Pfresh / S use a master seed derived as MASTER_SEED + mode_offset so the
  three orders are reproducible AND distinct (no shared time-slot confound).
  Phase 4 takes the FIRST 20 seeds per fixture (was: first 10 in Phase 3).
- Pacc + Preuse arms per-session order = random.Random(session_idx).shuffle(FIXTURES)
  per spec §4.3 — Preuse arms use the same per-session shuffle as Pacc so that
  sessions 1..10 of every Preuse arm visit fixtures in the same order as
  sessions 1..10 of Pacc (intentional + pre-registered: per-arm fixture-ordering
  variance would confound arm comparison).

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

# Phase 5 holdout fixtures (spec §4.2 user-approved option β set).
# Track #329 E27 — `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-01-phase5-holdout-design.md`.
FIXTURES_PHASE5: tuple[str, ...] = ("H1", "H2", "H3", "H10", "H5")

# Phase 4 seed/session counts (spec §4.3).
SEEDS_PER_FIXTURE_REPLICATION = 20
SEEDS_PER_FIXTURE_PREUSE = 10  # not used for flat-shuffle; per-session arms use PREUSE_SESSIONS
PACC_SESSIONS_REPLICATION = 20
PREUSE_SESSIONS = 10
PACC_POSITIONS = 10  # unchanged from Phase 3
PREUSE_POSITIONS = 10  # matches PACC_POSITIONS

# Phase 5 holdout seed/session counts (spec §2.1 trial budget).
# 5 fixtures × 6 modes × 10 seeds = 300 trials. Chain modes: 10 sessions ×
# 5 positions/session — each fixture visited once per session.
SEEDS_PER_FIXTURE_PHASE5 = 10
PHASE5_SESSIONS = 10
PHASE5_POSITIONS = len(FIXTURES_PHASE5)  # 5

MASTER_SEED = 42
# Phase 3 offsets preserved verbatim (spec §4.3): Pacc + Preuse arms use
# session_idx as their RNG key, so they are intentionally absent here.
_MODE_OFFSET = {"D": 0, "Pfresh": 1, "S": 2}

_PER_SESSION_HEADER = ["trial_idx", "session_idx", "position_in_chain", "fixture_id", "seed_idx"]
_FLAT_HEADER = ["trial_idx", "fixture_id", "seed_idx"]

# Preuse-substitute-compact cuts (spec §2.2 cut map; INV-5 hardcoded values).
# `revised` cut = 30 tokens per cascade-(b) sub-ADR
# (`docs/adr/2026-05-01-substitute-compact-revised-cut.md` §4, commit f50295c).
# Listed last so existing C1..C4 ordering is preserved (CSV filenames stable).
PREUSE_SUBSTITUTE_COMPACT_CUTS: tuple[str, ...] = ("C1", "C2", "C3", "C4", "revised")


def _flat_pairs(seeds_per_fixture: int,
                fixtures: tuple[str, ...] = FIXTURES) -> list[tuple[str, int]]:
    return [(f, s) for f in fixtures for s in range(seeds_per_fixture)]


def _write_csv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def write_flat_order(mode: str, out: Path,
                     seeds_per_fixture: int = SEEDS_PER_FIXTURE_REPLICATION,
                     fixtures: tuple[str, ...] = FIXTURES) -> None:
    """Write run_order_{D|Pfresh|S}.csv (flat shuffle keyed by MASTER_SEED + mode_offset)."""
    if mode not in _MODE_OFFSET:
        raise ValueError(f"flat mode must be one of {sorted(_MODE_OFFSET)}, got {mode!r}")
    pairs = _flat_pairs(seeds_per_fixture, fixtures=fixtures)
    random.Random(MASTER_SEED + _MODE_OFFSET[mode]).shuffle(pairs)
    rows = [[idx, fixture, seed] for idx, (fixture, seed) in enumerate(pairs)]
    _write_csv(out, _FLAT_HEADER, rows)


def _per_session_rows(num_sessions: int,
                      fixtures: tuple[str, ...] = FIXTURES) -> list[list[object]]:
    """Per-session shuffle keyed by session_idx (Pacc + all Preuse arms).

    Spec §4.3: sessions 1..10 of every per-session arm visit fixtures in the
    same order — guarantees fixture-ordering variance does not confound
    cross-arm comparison.
    """
    rows: list[list[object]] = []
    trial_idx = 0
    for session_idx in range(1, num_sessions + 1):
        order = list(fixtures)
        random.Random(session_idx).shuffle(order)
        for position, fixture in enumerate(order, start=1):
            rows.append([trial_idx, session_idx, position, fixture, session_idx])
            trial_idx += 1
    return rows


def write_pacc_order(out: Path) -> None:
    """Write run_order_Pacc.csv (20 sessions × 10 positions = 200 trials)."""
    rows = _per_session_rows(num_sessions=PACC_SESSIONS_REPLICATION)
    _write_csv(out, _PER_SESSION_HEADER, rows)


def write_preuse_clear_order(out: Path) -> None:
    """Write run_order_Preuse-clear.csv (10 sessions × 10 positions = 100 trials)."""
    rows = _per_session_rows(num_sessions=PREUSE_SESSIONS)
    _write_csv(out, _PER_SESSION_HEADER, rows)


def write_preuse_substitute_compact_order(out: Path, _cut_id: str) -> None:
    """Write run_order_Preuse-substitute-compact-{Cn}.csv.

    The cut_id is recorded only in the filename; the CSV body is identical to
    Preuse-clear (same per-session shuffle, same seed = session_idx). The cut
    parameter is consumed by the trial driver via the --mode flag, not by
    the CSV.
    """
    rows = _per_session_rows(num_sessions=PREUSE_SESSIONS)
    _write_csv(out, _PER_SESSION_HEADER, rows)


def write_all(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    # Phase 3 modes (replication scope: 20 seeds, 4 modes — spec §4.2 row D/Pfresh/S).
    for mode in ("D", "Pfresh", "S"):
        write_flat_order(mode, output_dir / f"run_order_{mode}.csv")
    write_pacc_order(output_dir / "run_order_Pacc.csv")
    # Phase 4 Preuse arms (10 sessions, 5 modes — spec §4.2 row Preuse-*).
    write_preuse_clear_order(output_dir / "run_order_Preuse-clear.csv")
    for cut_id in PREUSE_SUBSTITUTE_COMPACT_CUTS:
        write_preuse_substitute_compact_order(
            output_dir / f"run_order_Preuse-substitute-compact-{cut_id}.csv",
            cut_id,
        )


# Phase 5 holdout mode set (6 modes — spec §3.1 default 6-mode set).
PHASE5_MODES: tuple[str, ...] = (
    "D", "Pfresh", "S", "Pacc",
    "Preuse-clear", "Preuse-substitute-compact-revised",
)


def write_all_phase5(output_dir: Path) -> None:
    """Write Phase 5 holdout 6-CSV set (5 fixtures × 6 modes × 10 seeds = 300 trials).

    Spec: ~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-01-phase5-holdout-design.md §2.1.
    Tag: exec-mode-v5-holdout-preregistered-20260501.

    Layout:
      - D / Pfresh / S: flat shuffle of (H1,H2,H3,H10,H5) × seeds 0..9 = 50 trials each.
        Keyed by MASTER_SEED + _MODE_OFFSET[mode] — orders are reproducible AND
        distinct across the 3 modes.
      - Pacc / Preuse-clear / Preuse-substitute-compact-revised: 10 sessions ×
        5 positions/session = 50 trials each. Per-session shuffle keyed by
        session_idx — sessions 1..10 of every chain arm visit fixtures in the
        same order (same guarantee as Phase 4).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    for mode in ("D", "Pfresh", "S"):
        write_flat_order(
            mode,
            output_dir / f"run_order_{mode}.csv",
            seeds_per_fixture=SEEDS_PER_FIXTURE_PHASE5,
            fixtures=FIXTURES_PHASE5,
        )
    chain_rows = _per_session_rows(
        num_sessions=PHASE5_SESSIONS, fixtures=FIXTURES_PHASE5,
    )
    for mode in ("Pacc", "Preuse-clear", "Preuse-substitute-compact-revised"):
        _write_csv(
            output_dir / f"run_order_{mode}.csv",
            _PER_SESSION_HEADER, chain_rows,
        )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--output-dir", required=True, type=Path,
                   help="Directory to write run_order_*.csv into (created if missing).")
    p.add_argument("--phase", choices=("4", "5"), default="4",
                   help="Trial-set generation: 4 = Phase 4+5-cuts (10 CSVs, 1400 trials, "
                        "F2..Fa fixtures); 5 = Phase 5 holdout (6 CSVs, 300 trials, "
                        "H1/H2/H3/H10/H5 fixtures + 6-mode set per spec §3.1).")
    args = p.parse_args(argv)
    if args.phase == "5":
        write_all_phase5(args.output_dir)
    else:
        write_all(args.output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
